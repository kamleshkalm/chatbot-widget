/**
 * ChatBot Widget v1.0
 * ════════════════════════════════════════════════════════════════
 * Developer integration — paste 2 lines in any website:
 *
 *   <script src="https://cdn.yourchatbot.com/widget.js"></script>
 *   <script>
 *     ChatBot.init({
 *       apiKey:     "cb_live_sk_your_key_here",
 *       theme:      "blue",          // blue | green | purple | dark
 *       position:   "bottom-right",  // bottom-right | bottom-left
 *       welcomeMsg: "Hi! How can I help you?",
 *       brandName:  "Support",
 *       brandLogo:  "https://yoursite.com/logo.png"  // optional
 *     });
 *   </script>
 */

(function (window, document) {
  "use strict";

  // ── Constants ────────────────────────────────────────────────────────────
  var API_BASE   = "http://localhost:5000";
  var WIDGET_VER = "1.0.0";

  // ── Theme presets ────────────────────────────────────────────────────────
  var THEMES = {
    blue:   { primary: "#2563eb", gradient: "linear-gradient(135deg,#2563eb,#4f46e5)" },
    green:  { primary: "#059669", gradient: "linear-gradient(135deg,#059669,#0d9488)" },
    purple: { primary: "#7c3aed", gradient: "linear-gradient(135deg,#7c3aed,#db2777)" },
    dark:   { primary: "#0f172a", gradient: "linear-gradient(135deg,#0f172a,#1e293b)" },
  };

  // ── State ────────────────────────────────────────────────────────────────
  var _config    = {};
  var _sessionId = null;
  var _messages  = [];
  var _isOpen    = false;
  var _isSending = false;
  var _elements  = {};

  // ── Session ID ───────────────────────────────────────────────────────────
  function getOrCreateSessionId() {
    var key = "cb_session_" + _config.apiKey.slice(-8);
    var sid = localStorage.getItem(key);
    if (!sid || !isValidUUID(sid)) {
      sid = generateUUID();
      localStorage.setItem(key, sid);
    }
    return sid;
  }

  function generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function isValidUUID(str) {
    return /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(str);
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  function injectStyles(theme) {
    var t = THEMES[theme] || THEMES.blue;
    var css = [
      "#cb-container*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
      "#cb-container{position:fixed;z-index:2147483647}",
      "#cb-container.pos-br{bottom:24px;right:24px}",
      "#cb-container.pos-bl{bottom:24px;left:24px}",

      /* Bubble button */
      "#cb-bubble{width:58px;height:58px;border-radius:50%;background:" + t.gradient + ";border:none;cursor:pointer;",
      "box-shadow:0 4px 20px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;",
      "transition:transform .2s ease;position:relative;outline:none}",
      "#cb-bubble:hover{transform:scale(1.08)}",
      "#cb-bubble svg{width:26px;height:26px;fill:none;stroke:#fff;stroke-width:2}",
      "#cb-badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;",
      "width:18px;height:18px;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center}",

      /* Window */
      "#cb-window{position:absolute;bottom:70px;width:360px;height:520px;background:#fff;border-radius:16px;",
      "box-shadow:0 20px 60px rgba(0,0,0,.18);display:flex;flex-direction:column;overflow:hidden;",
      "transform:scale(.8) translateY(20px);opacity:0;pointer-events:none;",
      "transition:transform .25s cubic-bezier(.16,1,.3,1),opacity .25s ease}",
      "#cb-window.open{transform:scale(1) translateY(0);opacity:1;pointer-events:all}",
      ".pos-br #cb-window{right:0} .pos-bl #cb-window{left:0}",

      /* Header */
      "#cb-header{background:" + t.gradient + ";padding:14px 16px;display:flex;align-items:center;gap:10px}",
      "#cb-logo{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.2);",
      "display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}",
      "#cb-logo img{width:100%;height:100%;object-fit:cover}",
      "#cb-logo svg{width:20px;height:20px;fill:#fff}",
      "#cb-brand{flex:1} #cb-brand-name{font-size:14px;font-weight:700;color:#fff}",
      "#cb-brand-status{font-size:11px;color:rgba(255,255,255,.7);display:flex;align-items:center;gap:4px}",
      ".cb-status-dot{width:6px;height:6px;border-radius:50%;background:#4ade80}",
      "#cb-close{background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:20px;padding:4px;line-height:1}",
      "#cb-close:hover{color:#fff}",

      /* Messages */
      "#cb-messages{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth}",
      "#cb-messages::-webkit-scrollbar{width:4px}",
      "#cb-messages::-webkit-scrollbar-thumb{background:#e2e8f0;border-radius:4px}",
      ".cb-msg{max-width:80%;padding:10px 14px;border-radius:12px;font-size:13.5px;line-height:1.55;word-break:break-word}",
      ".cb-msg-bot{background:#f1f5f9;color:#0f172a;border-bottom-left-radius:3px;align-self:flex-start}",
      ".cb-msg-user{background:" + t.gradient + ";color:#fff;border-bottom-right-radius:3px;align-self:flex-end}",
      ".cb-msg-time{font-size:10px;color:#94a3b8;margin-top:3px}",
      ".cb-msg-row{display:flex;flex-direction:column}",
      ".cb-msg-row.user{align-items:flex-end}",
      ".cb-msg-row.bot{align-items:flex-start}",

      /* Typing dots */
      ".cb-typing{display:flex;gap:4px;padding:10px 14px;background:#f1f5f9;border-radius:12px;border-bottom-left-radius:3px;align-self:flex-start}",
      ".cb-typing span{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:cb-blink 1.2s infinite}",
      ".cb-typing span:nth-child(2){animation-delay:.2s}",
      ".cb-typing span:nth-child(3){animation-delay:.4s}",
      "@keyframes cb-blink{0%,80%,100%{opacity:.2}40%{opacity:1}}",

      /* Input */
      "#cb-input-area{border-top:1px solid #e2e8f0;padding:10px 12px;display:flex;gap:8px;align-items:flex-end;background:#fafafa}",
      "#cb-input{flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:9px 12px;font-size:13.5px;",
      "outline:none;resize:none;min-height:38px;max-height:100px;line-height:1.5;background:#fff;color:#0f172a}",
      "#cb-input:focus{border-color:" + t.primary + ";box-shadow:0 0 0 3px " + t.primary + "22}",
      "#cb-send{width:36px;height:36px;border-radius:50%;background:" + t.gradient + ";border:none;cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:opacity .2s}",
      "#cb-send:disabled{opacity:.5;cursor:not-allowed}",
      "#cb-send svg{width:16px;height:16px;fill:none;stroke:#fff;stroke-width:2.5}",

      /* Welcome */
      "#cb-welcome{padding:20px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;justify-content:center}",
      "#cb-welcome h3{font-size:16px;font-weight:700;color:#0f172a}",
      "#cb-welcome p{font-size:13px;color:#64748b;line-height:1.6;max-width:260px}",
      ".cb-start-btn{background:" + t.gradient + ";color:#fff;border:none;padding:10px 24px;border-radius:8px;",
      "font-size:14px;font-weight:600;cursor:pointer;margin-top:8px;transition:opacity .2s}",
      ".cb-start-btn:hover{opacity:.9}",
      ".cb-suggestion{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;",
      "font-size:12.5px;color:#475569;cursor:pointer;text-align:left;width:100%;transition:background .15s}",
      ".cb-suggestion:hover{background:#e2e8f0}",
      ".cb-suggestions{display:flex;flex-direction:column;gap:6px;width:100%;margin-top:4px}",

      /* Powered by */
      "#cb-powered{text-align:center;padding:6px;font-size:10px;color:#cbd5e1;border-top:1px solid #f1f5f9}",
      "#cb-powered a{color:#94a3b8;text-decoration:none}",
      "#cb-powered a:hover{color:#64748b}",
    ].join("");

    var style = document.createElement("style");
    style.id  = "cb-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Build DOM ─────────────────────────────────────────────────────────────
  function buildDOM() {
    var pos = _config.position === "bottom-left" ? "pos-bl" : "pos-br";

    var container = document.createElement("div");
    container.id        = "cb-container";
    container.className = pos;

    container.innerHTML = [
      '<div id="cb-window">',
        '<div id="cb-header">',
          '<div id="cb-logo">' + buildLogo() + '</div>',
          '<div id="cb-brand">',
            '<div id="cb-brand-name">' + esc(_config.brandName || "Support") + '</div>',
            '<div id="cb-brand-status"><span class="cb-status-dot"></span>Online</div>',
          '</div>',
          '<button id="cb-close" aria-label="Close chat">&#x2715;</button>',
        '</div>',
        '<div id="cb-messages">',
          buildWelcomeScreen(),
        '</div>',
        '<div id="cb-input-area" style="display:none">',
          '<textarea id="cb-input" placeholder="Type your message…" rows="1"></textarea>',
          '<button id="cb-send" aria-label="Send">',
            '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
          '</button>',
        '</div>',
        (_config.hidePoweredBy ? '' : '<div id="cb-powered">Powered by <a href="https://yourchatbot.com" target="_blank">ChatBot</a></div>'),
      '</div>',

      '<div id="cb-badge">0</div>',
      '<button id="cb-bubble" aria-label="Open chat">',
        '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
      '</button>',
    ].join("");

    document.body.appendChild(container);

    // Cache elements
    _elements = {
      window:   container.querySelector("#cb-window"),
      messages: container.querySelector("#cb-messages"),
      input:    container.querySelector("#cb-input"),
      send:     container.querySelector("#cb-send"),
      inputArea:container.querySelector("#cb-input-area"),
      bubble:   container.querySelector("#cb-bubble"),
      badge:    container.querySelector("#cb-badge"),
      close:    container.querySelector("#cb-close"),
    };
  }

  function buildLogo() {
    if (_config.brandLogo) {
      return '<img src="' + esc(_config.brandLogo) + '" alt="logo">';
    }
    return '<svg viewBox="0 0 24 24" fill="white"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  }

  function buildWelcomeScreen() {
    var suggestions = (_config.suggestions || [
      "What are your services?",
      "How can I contact you?",
      "Tell me about your team",
    ]).slice(0, 3);

    var suggHtml = suggestions.map(function (s) {
      return '<button class="cb-suggestion" data-text="' + esc(s) + '">' + esc(s) + '</button>';
    }).join("");

    return [
      '<div id="cb-welcome">',
        '<h3>👋 ' + esc(_config.welcomeMsg || "Hi! How can I help you?") + '</h3>',
        '<p>Ask me anything about our services, products, or how to get started.</p>',
        '<button class="cb-start-btn" id="cb-start">Start chatting</button>',
        '<div class="cb-suggestions">' + suggHtml + '</div>',
      '</div>',
    ].join("");
  }

  // ── Events ────────────────────────────────────────────────────────────────
  function bindEvents() {
    // Toggle bubble
    _elements.bubble.addEventListener("click", function () {
      toggle();
      resetBadge();
    });

    // Close
    _elements.close.addEventListener("click", function () {
      close();
    });

    // Start button
    _elements.messages.addEventListener("click", function (e) {
      var btn = e.target.closest("#cb-start");
      if (btn) startChat();

      var sug = e.target.closest(".cb-suggestion");
      if (sug) {
        startChat();
        sendMessage(sug.dataset.text);
      }
    });

    // Send button
    _elements.send.addEventListener("click", function () {
      sendFromInput();
    });

    // Enter key
    _elements.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendFromInput();
      }
    });

    // Auto-resize textarea
    _elements.input.addEventListener("input", function () {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 100) + "px";
    });
  }

  // ── Chat logic ────────────────────────────────────────────────────────────
  function startChat() {
    var welcome = _elements.messages.querySelector("#cb-welcome");
    if (welcome) welcome.remove();
    _elements.inputArea.style.display = "flex";

    if (_messages.length === 0) {
      addBotMessage(_config.welcomeMsg || "Hi! How can I help you?");
    }
    _elements.input.focus();
  }

  function sendFromInput() {
    var text = _elements.input.value.trim();
    if (!text || _isSending) return;
    _elements.input.value = "";
    _elements.input.style.height = "auto";
    sendMessage(text);
  }

  function sendMessage(text) {
    if (!text.trim() || _isSending) return;
    startChat();
    addUserMessage(text);
    showTyping();
    _isSending = true;
    _elements.send.disabled = true;

    fetch(API_BASE + "/qdrantapi/search", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + _config.apiKey,
      },
      body: JSON.stringify({
        query:      text,
        session_id: _sessionId,
      }),
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      hideTyping();
      var answer = data?.result?.human_like_answer;

      if (!answer || answer === "0") {
        addBotMessage("I don't have information on that. Please contact our support team.");
      } else {
        addBotMessage(answer);
      }

      if (!_isOpen) incrementBadge();
    })
    .catch(function () {
      hideTyping();
      addBotMessage("Something went wrong. Please try again.");
    })
    .finally(function () {
      _isSending = false;
      _elements.send.disabled = false;
    });
  }

  // ── Message renderers ─────────────────────────────────────────────────────
  function addUserMessage(text) {
    _messages.push({ role: "user", text: text });
    appendMessage("user", text);
    scrollToBottom();
  }

  function addBotMessage(text) {
    _messages.push({ role: "bot", text: text });
    appendMessage("bot", text);
    scrollToBottom();
  }

  function appendMessage(role, text) {
    var time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    var row  = document.createElement("div");
    row.className = "cb-msg-row " + role;
    row.innerHTML = [
      '<div class="cb-msg cb-msg-' + role + '">' + linkify(esc(text)) + '</div>',
      '<div class="cb-msg-time">' + (role === "bot" ? "Bot" : "You") + " · " + time + "</div>",
    ].join("");
    _elements.messages.appendChild(row);
  }

  function showTyping() {
    var el  = document.createElement("div");
    el.className = "cb-typing";
    el.id        = "cb-typing";
    el.innerHTML = "<span></span><span></span><span></span>";
    _elements.messages.appendChild(el);
    scrollToBottom();
  }

  function hideTyping() {
    var el = document.getElementById("cb-typing");
    if (el) el.remove();
  }

  function scrollToBottom() {
    _elements.messages.scrollTop = _elements.messages.scrollHeight;
  }

  // ── Badge ─────────────────────────────────────────────────────────────────
  var _badgeCount = 0;
  function incrementBadge() {
    _badgeCount++;
    _elements.badge.textContent = _badgeCount;
    _elements.badge.style.display = "flex";
  }
  function resetBadge() {
    _badgeCount = 0;
    _elements.badge.style.display = "none";
  }

  // ── Toggle ────────────────────────────────────────────────────────────────
  function toggle() { _isOpen ? close() : open(); }

  function open() {
    _isOpen = true;
    _elements.window.classList.add("open");
    setTimeout(function () { _elements.input.focus(); }, 300);
  }

  function close() {
    _isOpen = false;
    _elements.window.classList.remove("open");
  }

  // ── Utils ─────────────────────────────────────────────────────────────────
  function esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function linkify(text) {
    return text.replace(
      /(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">$1</a>'
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────
  window.ChatBot = {
    /**
     * Initialize the chatbot widget.
     * @param {Object} config
     * @param {string} config.apiKey      - Required. Your cb_live_sk_xxx key
     * @param {string} [config.theme]     - blue | green | purple | dark
     * @param {string} [config.position]  - bottom-right | bottom-left
     * @param {string} [config.welcomeMsg]- Welcome message text
     * @param {string} [config.brandName] - Your company name
     * @param {string} [config.brandLogo] - URL to your logo image
     * @param {Array}  [config.suggestions] - Quick reply suggestions
     * @param {boolean}[config.hidePoweredBy] - Hide "Powered by" footer
     */
    init: function (config) {
      if (!config || !config.apiKey) {
        console.error("[ChatBot] apiKey is required in ChatBot.init({ apiKey: 'cb_live_sk_...' })");
        return;
      }

      _config    = Object.assign({ theme: "blue", position: "bottom-right" }, config);
      _sessionId = getOrCreateSessionId();

      injectStyles(_config.theme);
      buildDOM();
      bindEvents();

      console.log("[ChatBot] Widget v" + WIDGET_VER + " initialized | session: " + _sessionId);
    },

    open:    function () { open(); },
    close:   function () { close(); },
    toggle:  function () { toggle(); },
    send:    function (text) { sendMessage(text); },
    destroy: function () {
      var el = document.getElementById("cb-container");
      if (el) el.remove();
      var st = document.getElementById("cb-styles");
      if (st) st.remove();
    },
  };

})(window, document);
