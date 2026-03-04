import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { runMigrations, db } from "../src/db.ts";
import { hashPassword, verifyPassword } from "../src/auth.ts";

describe("Aiktivist App", () => {
  beforeAll(() => {
    runMigrations();
  });

  afterAll(() => {
    db.query("DELETE FROM users").run();
    db.query("DELETE FROM sessions").run();
    db.query("DELETE FROM conversations").run();
    db.query("DELETE FROM messages").run();
  });

  test("Password hashing works", async () => {
    const pwd = "my_secure_password";
    const hash = await hashPassword(pwd);
    expect(hash).not.toBe(pwd);
    const isValid = await verifyPassword(pwd, hash);
    expect(isValid).toBe(true);
  });

  test("User registration and login", async () => {
    const username = "testuser";
    const password = "password123";

    const hash = await hashPassword(password);
    db.query("INSERT INTO users (id, username, password_hash) VALUES (?, ?, ?)").run("u1", username, hash);
    
    const user = db.query("SELECT id, password_hash FROM users WHERE username = ?").get(username) as any;
    expect(user).toBeDefined();
    
    const valid = await verifyPassword(password, user.password_hash);
    expect(valid).toBe(true);
  });

  test("Conversation persistence", () => {
    db.query("INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)").run("c1", "u1", "Test Chat");
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)").run("m1", "c1", "user", "Hello");
    db.query("INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)").run("m2", "c1", "assistant", "Hi there!");

    const convs = db.query("SELECT * FROM conversations WHERE user_id = ?").all("u1");
    expect(convs.length).toBe(1);

    const msgs = db.query("SELECT * FROM messages WHERE conversation_id = ?").all("c1");
    expect(msgs.length).toBe(2);
  });
});
