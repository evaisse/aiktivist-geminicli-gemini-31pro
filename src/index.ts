import { db } from "./db.ts";
import { hashPassword, verifyPassword, createSession, getUserIdFromSession, parseCookies } from "./auth.ts";
import { streamOpenRouter } from "./openrouter.ts";
import { logEvent } from "./events.ts";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// In-memory store for SSE clients per conversation
const clients = new Map<string, Set<any>>();

function broadcastToConversation(conversationId: string, data: any) {
  const convClients = clients.get(conversationId);
  if (convClients) {
    for (const controller of convClients) {
      try {
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      } catch (e) {
        // Handle disconnected client
      }
    }
  }
}

Bun.serve({
  port: process.env.PORT || 3000,
  async fetch(req) {
    const url = new URL(req.url);
    const method = req.method;

    // Static files
    if (!url.pathname.startsWith("/api/")) {
      let path = url.pathname;
      if (path === "/" || !path.includes(".")) {
        path = "/index.html"; // Serve SPA for routes like /chat/123
      }
      
      const fullPath = join(process.cwd(), "public", path);
      try {
        if (statSync(fullPath).isFile()) {
          const content = readFileSync(fullPath);
          const type = path.endsWith(".css") ? "text/css" : path.endsWith(".js") ? "application/javascript" : "text/html";
          return new Response(content, { headers: { "Content-Type": type } });
        }
      } catch (e) {
        // Fallback to index.html for SPA routing if file not found and doesn't look like an asset
        if (!path.includes(".")) {
           try {
               const content = readFileSync(join(process.cwd(), "public", "/index.html"));
               return new Response(content, { headers: { "Content-Type": "text/html" } });
           } catch(err) {}
        }
        return new Response("Not found", { status: 404 });
      }
    }

    // Parse Cookies for Auth
    const cookies = parseCookies(req.headers.get("cookie"));
    const userId = getUserIdFromSession(cookies["session_id"]);

    // --- Auth Routes ---
    if (url.pathname === "/api/register" && method === "POST") {
      const { username, password } = await req.json();
      try {
        const hash = await hashPassword(password);
        const id = crypto.randomUUID();
        db.query(`INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)`).run(id, username, hash);
        const token = createSession(id);
        logEvent("user_registered", { userId: id, username });
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Set-Cookie": `session_id=${token}; HttpOnly; Path=/` }
        });
      } catch (e) {
        return new Response("Username already exists", { status: 400 });
      }
    }

    if (url.pathname === "/api/login" && method === "POST") {
      const { username, password } = await req.json();
      const user = db.query(`SELECT id, password_hash FROM users WHERE username = ?`).get(username) as any;
      if (user && await verifyPassword(password, user.password_hash)) {
        const token = createSession(user.id);
        logEvent("user_logged_in", { userId: user.id });
        return new Response(JSON.stringify({ success: true }), {
          headers: { "Set-Cookie": `session_id=${token}; HttpOnly; Path=/` }
        });
      }
      return new Response("Invalid credentials", { status: 401 });
    }

    if (url.pathname === "/api/logout" && method === "POST") {
      if (cookies["session_id"]) {
        db.query(`DELETE FROM sessions WHERE token = ?`).run(cookies["session_id"]);
      }
      return new Response(JSON.stringify({ success: true }), {
        headers: { "Set-Cookie": `session_id=; HttpOnly; Path=/; Max-Age=0` }
      });
    }

    // Protect all other /api routes
    if (url.pathname.startsWith("/api/")) {
      if (!userId) return new Response("Unauthorized", { status: 401 });

      if (url.pathname === "/api/me" && method === "GET") {
        return new Response(JSON.stringify({ id: userId }));
      }

      if (url.pathname === "/api/conversations" && method === "GET") {
        const convs = db.query(`SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC`).all(userId);
        return new Response(JSON.stringify(convs));
      }

      if (url.pathname === "/api/conversations" && method === "POST") {
        const id = crypto.randomUUID();
        db.query(`INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)`).run(id, userId, "New Session");
        logEvent("conversation_created", { conversationId: id, userId });
        return new Response(JSON.stringify({ id, title: "New Session" }));
      }

      const convMatch = url.pathname.match(/^\/api\/conversations\/([^\/]+)(?:\/(.*))?$/);
      if (convMatch) {
        const convId = convMatch[1];
        const subroute = convMatch[2];
        
        // Verify ownership
        const conv = db.query(`SELECT id FROM conversations WHERE id = ? AND user_id = ?`).get(convId, userId);
        if (!conv) return new Response("Not found or unauthorized", { status: 404 });

        if (!subroute && method === "DELETE") {
          db.query(`DELETE FROM messages WHERE conversation_id = ?`).run(convId);
          db.query(`DELETE FROM conversations WHERE id = ?`).run(convId);
          logEvent("conversation_deleted", { conversationId: convId, userId });
          return new Response(JSON.stringify({ success: true }));
        }

        if (subroute === "messages" && method === "GET") {
          const messages = db.query(`SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(convId);
          return new Response(JSON.stringify(messages));
        }

        // SSE Endpoint
        if (subroute === "events" && method === "GET") {
          return new Response(
            new ReadableStream({
              start(controller) {
                if (!clients.has(convId)) clients.set(convId, new Set());
                clients.get(convId)!.add(controller);
                
                req.signal.addEventListener("abort", () => {
                  clients.get(convId)?.delete(controller);
                  if (clients.get(convId)?.size === 0) clients.delete(convId);
                });
              }
            }),
            {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
              }
            }
          );
        }

        // Post message & Trigger AI
        if (subroute === "messages" && method === "POST") {
          const { content } = await req.json();
          const userMsgId = crypto.randomUUID();
          
          db.query(`INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)`).run(userMsgId, convId, "user", content);
          db.query(`UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(convId);
          logEvent("message_sent", { messageId: userMsgId, conversationId: convId, role: "user", contentLength: content.length });

          // Start AI process asynchronously
          (async () => {
            try {
              const history = db.query(`SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`).all(convId) as {role: string, content: string}[];
              
              broadcastToConversation(convId, { type: "message_start" });
              
              let fullResponse = "";
              await streamOpenRouter(history, (chunk) => {
                fullResponse += chunk;
                broadcastToConversation(convId, { type: "message_chunk", chunk });
              });

              const aiMsgId = crypto.randomUUID();
              db.query(`INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)`).run(aiMsgId, convId, "assistant", fullResponse);
              logEvent("message_received", { messageId: aiMsgId, conversationId: convId, role: "assistant", contentLength: fullResponse.length });
              
              // Generate title if it's the first exchange
              if (history.length === 1) {
                  const title = content.slice(0, 30) + (content.length > 30 ? "..." : "");
                  db.query(`UPDATE conversations SET title = ? WHERE id = ?`).run(title, convId);
              }

              broadcastToConversation(convId, { type: "message_done" });
            } catch (err: any) {
              console.error("AI Error:", err);
              broadcastToConversation(convId, { type: "error", message: err.message });
              logEvent("ai_error", { conversationId: convId, error: err.message });
            }
          })();

          return new Response(JSON.stringify({ success: true }));
        }
      }
    }

    return new Response("Not found", { status: 404 });
  }
});

console.log("Server listening on http://localhost:" + (process.env.PORT || 3000));
