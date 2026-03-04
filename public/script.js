document.addEventListener("DOMContentLoaded", () => {
    const authView = document.getElementById("auth-view");
    const chatView = document.getElementById("chat-view");
    const emptyView = document.getElementById("empty-view");
    const sidebar = document.getElementById("sidebar");
    
    const loginBtn = document.getElementById("login-btn");
    const registerBtn = document.getElementById("register-btn");
    const logoutBtn = document.getElementById("logout-btn");
    const newChatBtn = document.getElementById("new-chat-btn");
    const chatForm = document.getElementById("chat-form");
    const messageInput = document.getElementById("message-input");
    const chatMessages = document.getElementById("chat-messages");
    const convList = document.getElementById("conversation-list");

    let currentConversationId = null;

    // --- State Management ---
    function checkAuth() {
        fetch("/api/me")
            .then(res => {
                if (res.ok) {
                    showApp();
                } else {
                    showAuth();
                }
            })
            .catch(() => showAuth());
    }

    function showAuth() {
        authView.classList.remove("hidden");
        chatView.classList.add("hidden");
        emptyView.classList.add("hidden");
        sidebar.classList.add("hidden");
    }

    function showApp() {
        authView.classList.add("hidden");
        sidebar.classList.remove("hidden");
        loadConversations().then(() => {
            const pathMatch = window.location.pathname.match(/^\/chat\/(.+)$/);
            if (pathMatch) {
                loadConversation(pathMatch[1], false);
            } else if (currentConversationId) {
                loadConversation(currentConversationId, false);
            } else {
                emptyView.classList.remove("hidden");
                chatView.classList.add("hidden");
            }
        });
    }

    window.addEventListener('popstate', () => {
        const pathMatch = window.location.pathname.match(/^\/chat\/(.+)$/);
        if (pathMatch) {
            loadConversation(pathMatch[1], false);
        } else {
            currentConversationId = null;
            emptyView.classList.remove("hidden");
            chatView.classList.add("hidden");
        }
    });

    // --- Authentication ---
    async function handleAuth(action) {
        const username = document.getElementById("username").value;
        const password = document.getElementById("password").value;
        const errDiv = document.getElementById("auth-error");
        
        try {
            const res = await fetch(`/api/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });
            if (res.ok) {
                errDiv.textContent = "";
                showApp();
            } else {
                const text = await res.text();
                errDiv.textContent = text;
            }
        } catch (e) {
            errDiv.textContent = "Network error";
        }
    }

    loginBtn.addEventListener("click", () => handleAuth("login"));
    registerBtn.addEventListener("click", () => handleAuth("register"));
    logoutBtn.addEventListener("click", () => {
        fetch("/api/logout", { method: "POST" }).then(() => {
            currentConversationId = null;
            showAuth();
        });
    });

    // --- Conversations ---
    async function loadConversations() {
        const res = await fetch("/api/conversations");
        if (!res.ok) return;
        const convs = await res.json();
        
        convList.innerHTML = "";
        convs.forEach(c => {
            const li = document.createElement("li");
            li.className = currentConversationId === c.id ? "active" : "";
            li.innerHTML = `<span>${c.title}</span><button class="delete-btn" data-id="${c.id}">×</button>`;
            
            li.querySelector("span").addEventListener("click", () => {
                loadConversation(c.id);
            });
            li.querySelector(".delete-btn").addEventListener("click", async (e) => {
                e.stopPropagation();
                await fetch(`/api/conversations/${c.id}`, { method: "DELETE" });
                if (currentConversationId === c.id) {
                    currentConversationId = null;
                    emptyView.classList.remove("hidden");
                    chatView.classList.add("hidden");
                }
                loadConversations();
            });
            convList.appendChild(li);
        });
    }

    newChatBtn.addEventListener("click", async () => {
        const res = await fetch("/api/conversations", { method: "POST" });
        if (res.ok) {
            const conv = await res.json();
            loadConversations();
            loadConversation(conv.id);
        }
    });

    // --- Chat & SSE ---
    let eventSource = null;

    async function loadConversation(id, pushState = true) {
        if (pushState && window.location.pathname !== `/chat/${id}`) {
            window.history.pushState({}, "", `/chat/${id}`);
        }

        currentConversationId = id;
        emptyView.classList.add("hidden");
        chatView.classList.remove("hidden");
        
        // Update active class
        document.querySelectorAll("#conversation-list li").forEach(li => {
            li.classList.remove("active");
            if (li.querySelector(".delete-btn").dataset.id === id) {
                li.classList.add("active");
            }
        });

        // Load messages
        const res = await fetch(`/api/conversations/${id}/messages`);
        const messages = res.ok ? await res.json() : [];
        
        chatMessages.innerHTML = "";
        messages.forEach(m => appendMessage(m.role, m.content));
        scrollToBottom();

        // Setup SSE for real-time updates
        if (eventSource) eventSource.close();
        eventSource = new EventSource(`/api/conversations/${id}/events`);
        
        let currentAssistantMessageDiv = null;

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === "message_start") {
                currentAssistantMessageDiv = appendMessage("assistant", "");
            } else if (data.type === "message_chunk") {
                if (currentAssistantMessageDiv) {
                    currentAssistantMessageDiv.textContent += data.chunk;
                    scrollToBottom();
                }
            } else if (data.type === "message_done") {
                currentAssistantMessageDiv = null;
            } else if (data.type === "error") {
                appendMessage("system", `Error: ${data.message}`);
            }
        };
    }

    chatForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentConversationId) return;
        
        const content = messageInput.value.trim();
        if (!content) return;
        
        messageInput.value = "";
        appendMessage("user", content);
        scrollToBottom();

        await fetch(`/api/conversations/${currentConversationId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content })
        });
    });

    messageInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            chatForm.dispatchEvent(new Event("submit"));
        }
    });

    function appendMessage(role, content) {
        const div = document.createElement("div");
        div.className = `message ${role}`;
        div.textContent = content;
        chatMessages.appendChild(div);
        return div;
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Init
    checkAuth();
});
