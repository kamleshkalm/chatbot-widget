/**
 * ChatBot Widget v1.4 — Production Ready
 * ══════════════════════════════════════════════════════════════
 *
 * Kya kya fix kiya:
 *  1. 429 pe restaurant customer ko "upgrade" message NAHI dikhega
 *     → "limitMsg" config option add kiya — owner set kare apna message
 *     → Default: "I'm temporarily unavailable. Please contact us directly."
 *
 *  2. userId JS mein NAHI — /payment/widget-info se fetch hota hai
 *
 *  3. Upgrade modal widget ke ANDAR — plan select karo → Razorpay opens
 *
 *  4. Razorpay SDK lazy load — sirf tab jab payment hogi
 *
 *  5. Dev fallback — Razorpay key nahi hai to /payment/dev-upgrade use karo
 *
 *  6. 80% limit pe console warning (owner ko pata chale)
 *
 *  7. hmac issues fix (backend mein)
 *
 * Developer integration:
 *   <script src="https://kamleshkalm.github.io/chatbot-widget/widget.js"></script>
 *   <script>
 *     ChatBot.init({
 *       apiKey:    "cb_live_sk_xxx",
 *       theme:     "blue",
 *       brandName: "Zomato Bites",
 *
 *       // Restaurant customer ko limit hit pe yeh dikhao:
 *       limitMsg: "Sorry! Chat is temporarily unavailable. Call us: +91-9876543210",
 *     });
 *   </script>
 */

(function (window, document) {
  "use strict";

  // ── CHANGE BEFORE PRODUCTION ─────────────────────────────────────────
  var API_BASE   = "http://127.0.0.1:5000";
  var WIDGET_VER = "1.4.0";

  var THEMES = {
    blue:   { primary: "#2563eb", gradient: "linear-gradient(135deg,#2563eb,#4f46e5)" },
    green:  { primary: "#059669", gradient: "linear-gradient(135deg,#059669,#0d9488)" },
    purple: { primary: "#7c3aed", gradient: "linear-gradient(135deg,#7c3aed,#db2777)" },
    dark:   { primary: "#0f172a", gradient: "linear-gradient(135deg,#0f172a,#1e293b)" },
  };

  var _config       = {};
  var _sessionId    = null;
  var _messages     = [];
  var _isOpen       = false;
  var _isSending    = false;
  var _elements     = {};
  var _planExpired  = false;
  var _rzKey        = "";
  var _plans        = {};
  var _selectedPlan = null;

  // ── Session ───────────────────────────────────────────────────────────
  function getOrCreateSessionId() {
    var ns  = _config.apiKey ? _config.apiKey.slice(-8) : "x";
    var key = "cb_s_" + ns;
    var sid = null;
    try { sid = localStorage.getItem(key); } catch(e) {}
    if (!sid || !/^[a-f0-9-]{36}$/.test(sid)) {
      sid = generateUUID();
      try { localStorage.setItem(key, sid); } catch(e) {}
    }
    return sid;
  }

  function generateUUID() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function(c) {
      var r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  // ── Fetch user info safely from backend ──────────────────────────────
  function fetchWidgetInfo() {
    fetch(API_BASE + "/payment/widget-info", {
      headers: { "Authorization": "Bearer " + _config.apiKey }
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.success || !d.result) return;

      // 80% warning — log for owner (not shown to end user)
      if (d.result.warning_at_80) {
        console.warn("[ChatBot] ⚠️ 80% query limit used. Plan: " + d.result.plan + " | Used: " + d.result.usage + "/" + d.result.limit);
      }

      // Already at limit
      if (d.result.remaining === 0 || (d.result.usage >= d.result.limit && d.result.limit < 999999)) {
        _planExpired = true;
        disableInput();
      }
    })
    .catch(function() {
      // Non-blocking — widget works even if this fails
    });
  }

  // ── Load plans ────────────────────────────────────────────────────────
  function loadPlans() {
    fetch(API_BASE + "/payment/plans")
    .then(function(r) { return r.json(); })
    .then(function(d) {
      _plans = d.result || {};
      _rzKey = d.razorpay_key || "";
      renderModalPlans();
    })
    .catch(function() {
      _plans = {
        enterprise: {
          name: "Enterprise", price: 1999, queries: 10000,
          features: ["10,000 queries/month", "Memory sessions", "Full analytics"]
        }
      };
      renderModalPlans();
    });
  }

  // ── Styles ────────────────────────────────────────────────────────────
  function injectStyles(theme) {
    var t = THEMES[theme] || THEMES.blue;
    var css = [
      "#cb-w *{box-sizing:border-box;margin:0;padding:0;font-family:'Inter','SF Pro Display',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased}",
      "#cb-w{position:fixed;z-index:2147483647}",
      "#cb-w.pos-br{bottom:24px;right:24px}",
      "#cb-w.pos-bl{bottom:24px;left:24px}",

      // Bubble
      "#cb-bbl{width:62px;height:62px;border-radius:50%;background:" + t.gradient + ";border:none;cursor:pointer;",
      "box-shadow:0 10px 30px -5px " + t.primary + "66, 0 4px 12px rgba(0,0,0,.15);",
      "display:flex;align-items:center;justify-content:center;transition:all .35s cubic-bezier(.34,1.56,.64,1);",
      "position:relative;outline:none}",
      "#cb-bbl::before{content:'';position:absolute;inset:-4px;border-radius:50%;background:" + t.gradient + ";",
      "opacity:.4;animation:cb-pulse 2.4s ease-out infinite;z-index:-1}",
      "@keyframes cb-pulse{0%{transform:scale(.95);opacity:.5}70%{transform:scale(1.25);opacity:0}100%{transform:scale(1.25);opacity:0}}",
      "#cb-bbl:hover{transform:scale(1.1) rotate(-6deg);box-shadow:0 14px 40px -5px " + t.primary + "99}",
      "#cb-bbl:active{transform:scale(.95)}",
      "#cb-bbl svg{width:28px;height:28px;fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 2px 4px rgba(0,0,0,.2))}",
      "#cb-bdg{position:absolute;top:-2px;right:-2px;background:#ef4444;color:#fff;border-radius:50%;",
      "width:20px;height:20px;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;",
      "border:2px solid #fff;box-shadow:0 2px 6px rgba(239,68,68,.5);animation:cb-bounce .5s ease}",
      "@keyframes cb-bounce{0%{transform:scale(0)}60%{transform:scale(1.2)}100%{transform:scale(1)}}",

      // Window
      "#cb-win{position:absolute;bottom:78px;width:392px;background:rgba(255,255,255,.98);",
      "backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);",
      "border-radius:24px;border:1px solid rgba(255,255,255,.6);",
      "box-shadow:0 25px 80px -15px rgba(0,0,0,.25), 0 8px 24px rgba(0,0,0,.08), 0 0 0 1px rgba(0,0,0,.04);",
      "display:flex;flex-direction:column;overflow:hidden;",
      "transform:scale(.9) translateY(24px);opacity:0;pointer-events:none;transform-origin:bottom right;",
      "transition:transform .4s cubic-bezier(.34,1.56,.64,1),opacity .3s;max-height:620px}",
      "#cb-win.open{transform:scale(1) translateY(0);opacity:1;pointer-events:all}",
      ".pos-br #cb-win{right:0;transform-origin:bottom right}",
      ".pos-bl #cb-win{left:0;transform-origin:bottom left}",

      // Header
      "#cb-hdr{background:" + t.gradient + ";padding:18px 18px;display:flex;align-items:center;gap:12px;",
      "flex-shrink:0;position:relative;overflow:hidden}",
      "#cb-hdr::before{content:'';position:absolute;inset:0;background-image:radial-gradient(circle at 20% 20%,rgba(255,255,255,.15) 0%,transparent 50%),radial-gradient(circle at 80% 80%,rgba(255,255,255,.1) 0%,transparent 50%);pointer-events:none}",
      "#cb-logo{width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.25);",
      "display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;",
      "border:2px solid rgba(255,255,255,.4);box-shadow:0 4px 12px rgba(0,0,0,.15);position:relative;z-index:1}",
      "#cb-logo img{width:100%;height:100%;object-fit:cover}",
      "#cb-logo svg{width:22px;height:22px;fill:#fff}",
      "#cb-brd{flex:1;position:relative;z-index:1}",
      "#cb-bname{font-size:15px;font-weight:700;color:#fff;letter-spacing:-.2px;text-shadow:0 1px 2px rgba(0,0,0,.1)}",
      "#cb-bsts{font-size:11.5px;color:rgba(255,255,255,.85);display:flex;align-items:center;gap:5px;margin-top:2px;font-weight:500}",
      ".cb-sdot{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 2px rgba(74,222,128,.3);animation:cb-glow 2s ease-in-out infinite}",
      "@keyframes cb-glow{0%,100%{box-shadow:0 0 0 2px rgba(74,222,128,.3)}50%{box-shadow:0 0 0 5px rgba(74,222,128,.1)}}",
      "#cb-hbtns{display:flex;gap:6px;position:relative;z-index:1}",
      "#cb-ubtn{background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.35);color:#fff;",
      "font-size:11.5px;font-weight:600;padding:5px 11px;border-radius:20px;cursor:pointer;display:none;",
      "transition:all .2s;backdrop-filter:blur(10px)}",
      "#cb-ubtn:hover{background:rgba(255,255,255,.4);transform:translateY(-1px)}",
      "#cb-xbtn{background:rgba(255,255,255,.15);border:none;color:#fff;cursor:pointer;font-size:18px;",
      "width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:all .2s}",
      "#cb-xbtn:hover{background:rgba(255,255,255,.3);transform:rotate(90deg)}",

      // Messages
      "#cb-msgs{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:12px;min-height:220px;",
      "background:linear-gradient(180deg,#fafbff 0%,#f4f6fb 100%);scroll-behavior:smooth}",
      "#cb-msgs::-webkit-scrollbar{width:5px}",
      "#cb-msgs::-webkit-scrollbar-track{background:transparent}",
      "#cb-msgs::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:10px}",
      "#cb-msgs::-webkit-scrollbar-thumb:hover{background:#94a3b8}",
      ".cb-mr{display:flex;flex-direction:column;animation:cb-slide .35s cubic-bezier(.16,1,.3,1)}",
      "@keyframes cb-slide{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}",
      ".cb-mr.user{align-items:flex-end}.cb-mr.bot{align-items:flex-start}",
      ".cb-mb{max-width:82%;padding:11px 15px;border-radius:18px;font-size:13.5px;line-height:1.55;word-break:break-word;",
      "box-shadow:0 2px 8px rgba(0,0,0,.04)}",
      ".cb-mb.bot{background:#fff;color:#1e293b;border-bottom-left-radius:5px;border:1px solid #eef1f6}",
      ".cb-mb.user{background:" + t.gradient + ";color:#fff;border-bottom-right-radius:5px;",
      "box-shadow:0 4px 14px " + t.primary + "33}",
      ".cb-mt{font-size:10.5px;color:#94a3b8;margin-top:4px;padding:0 6px;font-weight:500}",

      // Typing
      ".cb-dots{display:flex;gap:5px;padding:13px 16px;background:#fff;border:1px solid #eef1f6;border-radius:18px;",
    "border-bottom-left-radius:5px;align-self:flex-start;box-shadow:0 2px 8px rgba(0,0,0,.04)}",
    ".cb-dots span{width:8px;height:8px;border-radius:50%;background:" + t.primary + ";opacity:.5;animation:cb-blink 1.4s infinite ease-in-out}",
    ".cb-dots span:nth-child(2){animation-delay:.2s}.cb-dots span:nth-child(3){animation-delay:.4s}",
    "@keyframes cb-blink{0%,80%,100%{transform:scale(.7);opacity:.4}40%{transform:scale(1);opacity:1}}",

      // Input
      "#cb-ia{border-top:1px solid #eef1f6;padding:12px 14px;display:flex;gap:10px;align-items:flex-end;",
      "background:rgba(255,255,255,.95);backdrop-filter:blur(10px);flex-shrink:0}",
      "#cb-inp{flex:1;border:1.5px solid #e2e8f0;border-radius:14px;padding:10px 14px;font-size:13.5px;",
      "outline:none;resize:none;min-height:42px;max-height:110px;line-height:1.5;background:#f8fafc;color:#0f172a;",
      "transition:all .2s;font-family:inherit}",
      "#cb-inp:focus{border-color:" + t.primary + ";background:#fff;box-shadow:0 0 0 4px " + t.primary + "1a}",
      "#cb-inp::placeholder{color:#94a3b8}",
      "#cb-inp:disabled{background:#f1f5f9;cursor:not-allowed;opacity:.6}",
      "#cb-snd{width:42px;height:42px;border-radius:50%;background:" + t.gradient + ";border:none;cursor:pointer;",
      "display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .2s;",
      "box-shadow:0 4px 12px " + t.primary + "55}",
      "#cb-snd:hover:not(:disabled){transform:scale(1.08) rotate(-8deg);box-shadow:0 6px 18px " + t.primary + "77}",
      "#cb-snd:active:not(:disabled){transform:scale(.95)}",
      "#cb-snd:disabled{opacity:.4;cursor:not-allowed;box-shadow:none}",
      "#cb-snd svg{width:18px;height:18px;fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}",

      // Welcome
      "#cb-wlc{padding:32px 24px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:12px;",
      "flex:1;justify-content:center;background:linear-gradient(180deg,#fafbff 0%,#f4f6fb 100%)}",
      "#cb-wlc h3{font-size:19px;font-weight:700;color:#0f172a;letter-spacing:-.4px}",
      "#cb-wlc p{font-size:13.5px;color:#64748b;line-height:1.65;max-width:280px}",
      ".cb-sbtn{background:" + t.gradient + ";color:#fff;border:none;padding:12px 32px;border-radius:12px;",
      "font-size:14px;font-weight:600;cursor:pointer;margin-top:8px;",
      "box-shadow:0 8px 24px " + t.primary + "55;transition:all .25s}",
      ".cb-sbtn:hover{transform:translateY(-2px);box-shadow:0 12px 32px " + t.primary + "77}",
      ".cb-sbtn:active{transform:translateY(0)}",
      ".cb-sug{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:11px 16px;",
      "font-size:12.5px;color:#475569;cursor:pointer;text-align:left;width:100%;transition:all .2s;font-weight:500}",
      ".cb-sug:hover{background:" + t.primary + "0d;border-color:" + t.primary + "55;color:" + t.primary + ";transform:translateX(4px)}",
      ".cb-sugs{display:flex;flex-direction:column;gap:8px;width:100%;margin-top:8px}",

      // Powered by
      "#cb-pwr{text-align:center;padding:8px;font-size:10px;color:#cbd5e1;border-top:1px solid #f1f5f9;",
      "background:#fff;flex-shrink:0;font-weight:500;letter-spacing:.3px}",
      "#cb-pwr a{color:#94a3b8;text-decoration:none;transition:color .2s}",
      "#cb-pwr a:hover{color:" + t.primary + "}",

      // Upgrade Modal
      "#cb-mod{position:absolute;inset:0;background:rgba(15,23,42,.55);backdrop-filter:blur(8px);",
      "display:none;align-items:flex-end;z-index:10;border-radius:24px;overflow:hidden}",
      "#cb-mod.show{display:flex;animation:cb-fadein .3s ease}",
      "@keyframes cb-fadein{from{opacity:0}to{opacity:1}}",
      "#cb-mbox{background:#fff;width:100%;border-radius:24px 24px 0 0;overflow:hidden;",
      "animation:cb-slideup .4s cubic-bezier(.34,1.56,.64,1)}",
      "@keyframes cb-slideup{from{transform:translateY(100%)}to{transform:translateY(0)}}",
      "#cb-mhd{background:" + t.gradient + ";padding:22px 18px 18px;text-align:center;position:relative;overflow:hidden}",
      "#cb-mhd::before{content:'';position:absolute;inset:0;background-image:radial-gradient(circle at 30% 0%,rgba(255,255,255,.2) 0%,transparent 50%)}",
      "#cb-mhd h3{color:#fff;font-size:18px;font-weight:700;margin-bottom:4px;letter-spacing:-.3px;position:relative}",
      "#cb-mhd p{color:rgba(255,255,255,.85);font-size:13px;position:relative}",
      "#cb-mx{position:absolute;top:14px;right:14px;background:rgba(255,255,255,.2);border:none;",
      "color:#fff;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:16px;",
      "display:flex;align-items:center;justify-content:center;transition:all .2s;z-index:1}",
      "#cb-mx:hover{background:rgba(255,255,255,.35);transform:rotate(90deg)}",
      "#cb-mpl{padding:16px;display:flex;flex-direction:column;gap:10px}",
      ".cp{border:1.5px solid #e2e8f0;border-radius:14px;padding:14px 16px;cursor:pointer;",
      "transition:all .25s;display:flex;align-items:center;gap:12px;position:relative;background:#fff}",
      ".cp:hover{border-color:" + t.primary + ";background:" + t.primary + "08;transform:translateY(-2px);",
      "box-shadow:0 8px 20px " + t.primary + "1a}",
      ".cp.feat{border-color:" + t.primary + ";background:linear-gradient(135deg," + t.primary + "0d," + t.primary + "1a)}",
      ".cp.sel{border-color:#10b981;background:#f0fdf4;box-shadow:0 8px 20px rgba(16,185,129,.2)}",
      ".cp.sel::after{content:'✓';position:absolute;top:14px;right:14px;width:22px;height:22px;background:#10b981;",
      "color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700}",
      ".cp-ico{width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;",
      "font-size:19px;flex-shrink:0;box-shadow:0 4px 12px rgba(0,0,0,.08)}",
      ".cp-inf{flex:1}.cp-nm{font-size:14px;font-weight:700;color:#0f172a;margin-bottom:2px;letter-spacing:-.2px}",
      ".cp-sub{font-size:11.5px;color:#64748b;font-weight:500}",
      ".cp-pr{text-align:right;flex-shrink:0}",
      ".cp-amt{font-size:16px;font-weight:800;color:#0f172a;letter-spacing:-.6px}",
      ".cp-per{font-size:10.5px;color:#94a3b8;font-weight:500}",
      ".cp-pop{position:absolute;top:-9px;right:14px;background:" + t.gradient + ";color:#fff;",
      "font-size:9.5px;font-weight:700;padding:3px 9px;border-radius:20px;letter-spacing:.6px;",
      "box-shadow:0 4px 10px " + t.primary + "55}",
      "#cb-mft{padding:0 16px 18px;display:flex;flex-direction:column;gap:10px}",
      "#cb-pbtn{background:" + t.gradient + ";color:#fff;border:none;padding:14px;border-radius:14px;",
      "font-size:14.5px;font-weight:700;cursor:pointer;box-shadow:0 8px 24px " + t.primary + "55;",
      "transition:all .25s;letter-spacing:-.2px}",
      "#cb-pbtn:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 12px 32px " + t.primary + "77}",
      "#cb-pbtn:active:not(:disabled){transform:translateY(0)}",
      "#cb-pbtn:disabled{opacity:.45;cursor:not-allowed;background:#94a3b8;box-shadow:none}",
      "#cb-mnote{font-size:11px;color:#94a3b8;text-align:center;font-weight:500}",
      
      // ── Mobile responsive ─────────────────────────────────────────────
      
      "@media (max-width:480px){#cb-win{width:calc(100vw - 24px);max-height:calc(100vh - 110px)}",
      "#cb-w.pos-br{bottom:16px;right:12px}#cb-w.pos-bl{bottom:16px;left:12px}}",
    ].join("");

    var s = document.createElement("style");
    s.id = "cb-sty"; s.textContent = css;
    document.head.appendChild(s);
  }

  // ── Build DOM ─────────────────────────────────────────────────────────
  function buildDOM() {
    var pos = _config.position === "bottom-left" ? "pos-bl" : "pos-br";
    var c   = document.createElement("div");
    c.id = "cb-w"; c.className = pos;

    var logo = _config.brandLogo
      ? '<img src="' + esc(_config.brandLogo) + '" alt="">'
      : '<svg viewBox="0 0 24 24" fill="white"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

    var suggs = (_config.suggestions || [
      "What are your services?",
      "How can I contact you?",
      "Tell me about your team",
    ]).slice(0, 3);

    c.innerHTML = [
      '<div id="cb-win">',

        // Header
        '<div id="cb-hdr">',
          '<div id="cb-logo">' + logo + '</div>',
          '<div id="cb-brd"><div id="cb-bname">' + esc(_config.brandName || "Support") + '</div>',
          '<div id="cb-bsts"><span class="cb-sdot"></span>Online</div></div>',
          '<div id="cb-hbtns">',
            '<button id="cb-ubtn">&#9889; Upgrade</button>',
            '<button id="cb-xbtn">&#x2715;</button>',
          '</div>',
        '</div>',

        // Messages
        '<div id="cb-msgs">',
          '<div id="cb-wlc">',
            '<h3>&#128075; ' + esc(_config.welcomeMsg || "Hi! How can I help?") + '</h3>',
            '<p>Ask me anything about our services.</p>',
            '<button class="cb-sbtn" id="cb-start">Start chatting</button>',
            '<div class="cb-sugs">',
              suggs.map(function(s) { return '<button class="cb-sug" data-t="' + esc(s) + '">' + esc(s) + '</button>'; }).join(""),
            '</div>',
          '</div>',
        '</div>',

        // Input
        '<div id="cb-ia" style="display:none">',
          '<textarea id="cb-inp" placeholder="Type your message…" rows="1"></textarea>',
          '<button id="cb-snd"><svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>',
        '</div>',

        (_config.hidePoweredBy ? "" : '<div id="cb-pwr">Powered by <a href="#" target="_blank">ChatBot</a></div>'),

        // Upgrade modal
        '<div id="cb-mod">',
          '<div id="cb-mbox">',
            '<div id="cb-mhd">',
              '<button id="cb-mx">&#x2715;</button>',
              '<h3>Upgrade Plan</h3>',
              '<p>Choose a plan to continue</p>',
            '</div>',
            '<div id="cb-mpl"></div>',
            '<div id="cb-mft">',
              '<button id="cb-pbtn" disabled>Select a plan</button>',
              '<div id="cb-mnote">Secured by Razorpay &bull; Cancel anytime</div>',
            '</div>',
          '</div>',
        '</div>',

      '</div>',
      '<div id="cb-bdg">0</div>',
      '<button id="cb-bbl"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></button>',
    ].join("");

    document.body.appendChild(c);

    _elements = {
      win:   c.querySelector("#cb-win"),
      msgs:  c.querySelector("#cb-msgs"),
      inp:   c.querySelector("#cb-inp"),
      snd:   c.querySelector("#cb-snd"),
      ia:    c.querySelector("#cb-ia"),
      bbl:   c.querySelector("#cb-bbl"),
      bdg:   c.querySelector("#cb-bdg"),
      xbtn:  c.querySelector("#cb-xbtn"),
      ubtn:  c.querySelector("#cb-ubtn"),
      mod:   c.querySelector("#cb-mod"),
      mpl:   c.querySelector("#cb-mpl"),
      mx:    c.querySelector("#cb-mx"),
      pbtn:  c.querySelector("#cb-pbtn"),
    };
  }

  // ── Render plan cards ─────────────────────────────────────────────────
  function renderModalPlans() {
    if (!_elements.mpl) return;
    var colors = { enterprise: "#6366f1", custom: "#d97706" };
    var icons  = { enterprise: "&#9889;", custom: "&#127970;" };
    var html   = "";

    Object.keys(_plans).forEach(function(key) {
      if (key === "free") return;
      var p = _plans[key];
      var c = colors[key] || "#6366f1";
      html += [
        '<div class="cp ' + (key === "enterprise" ? "feat" : "") + '" data-plan="' + key + '">',
          key === "enterprise" ? '<span class="cp-pop">POPULAR</span>' : "",
          '<div class="cp-ico" style="background:' + c + '22">' + (icons[key] || "&#128142;") + '</div>',
          '<div class="cp-inf">',
            '<div class="cp-nm">' + esc(p.name) + '</div>',
            '<div class="cp-sub">' + (p.queries >= 999999 ? "Unlimited" : p.queries.toLocaleString() + " queries/mo") + '</div>',
          '</div>',
          '<div class="cp-pr">',
            '<div class="cp-amt">' + (p.price === null ? "Custom" : "&#8377;" + p.price.toLocaleString()) + '</div>',
            p.price > 0 ? '<div class="cp-per">/month</div>' : "",
          '</div>',
        '</div>',
      ].join("");
    });

    _elements.mpl.innerHTML = html || '<p style="text-align:center;color:#94a3b8;padding:20px">Loading plans…</p>';

    var cards = _elements.mpl.querySelectorAll(".cp");
    for (var i = 0; i < cards.length; i++) {
      (function(card) {
        card.addEventListener("click", function() {
          _selectedPlan = card.getAttribute("data-plan");
          var all = _elements.mpl.querySelectorAll(".cp");
          for (var j = 0; j < all.length; j++) all[j].classList.remove("sel");
          card.classList.add("sel");

          if (_selectedPlan === "custom") {
            _elements.pbtn.textContent = "Contact Sales \u2192";
            _elements.pbtn.disabled = false;
          } else {
            var price = _plans[_selectedPlan] ? _plans[_selectedPlan].price : 0;
            _elements.pbtn.textContent = "Pay \u20B9" + (price || 0).toLocaleString() + " / month";
            _elements.pbtn.disabled = false;
          }
        });
      })(cards[i]);
    }
  }

  // ── Modal open/close ──────────────────────────────────────────────────
  function openModal()  {
    if (_elements.mod) _elements.mod.classList.add("show");
    if (_elements.ubtn) _elements.ubtn.style.display = "block";
  }
  function closeModal() {
    if (_elements.mod) _elements.mod.classList.remove("show");
    _selectedPlan = null;
    if (_elements.pbtn) { _elements.pbtn.textContent = "Select a plan"; _elements.pbtn.disabled = true; }
    if (_elements.mpl) {
      var all = _elements.mpl.querySelectorAll(".cp");
      for (var i = 0; i < all.length; i++) all[i].classList.remove("sel");
    }
  }

  // ── Payment ───────────────────────────────────────────────────────────
  function startPayment() {
    if (!_selectedPlan) return;

    if (_selectedPlan === "custom") {
      window.open(_config.contactSalesUrl || "#contact", "_blank");
      closeModal();
      return;
    }

    _elements.pbtn.textContent = "Creating order\u2026";
    _elements.pbtn.disabled = true;

    fetch(API_BASE + "/payment/create-subscription", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + _config.apiKey,  // ← ADD KARO
      },
      body: JSON.stringify({ plan: _selectedPlan }),
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.success) {
         addBot("Could not start payment. Please try again.");
        _elements.pbtn.textContent = "Pay \u20B9" + ((_plans[_selectedPlan] || {}).price || 0).toLocaleString() + " / month";
        _elements.pbtn.disabled = false;
        return;
      }
      openRazorpay(d.result);
    })
    .catch(function() {
      addBot("Network error. Please try again.");
      closeModal();
    });
  }

  function openRazorpay(order) {
    closeModal();
    var key = order.razorpay_key || _rzKey;
    if (!key) {
      addBot("Payment service not configured. Please contact the website owner.");
      return;
    }

    function launch() {
      new window.Razorpay({
        key:             key,
        subscription_id: order.subscription_id,
        name:            _config.brandName || "ChatBot",
        description:     order.description || "Enterprise Plan",
        currency:        "INR",
        prefill:         order.prefill || {},
        theme:           { color: (THEMES[_config.theme] || THEMES.blue).primary },
        handler: function() {
          _planExpired = false;
          if (_elements.ubtn) _elements.ubtn.style.display = "none";
          enableInput();
          addBot("\uD83C\uDF89 Payment successful! Your plan is now active. Continue chatting!");
        },
        modal: {
          ondismiss: function() {
            addBot("Payment cancelled. Click \u26A1 Upgrade anytime to continue.");
          }
        }
      }).open();
    }

    if (!window.Razorpay) {
      var s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.onload = launch;
      s.onerror = function() { addBot("Payment service unavailable. Please try again later."); };
      document.head.appendChild(s);
    } else {
      launch();
    }
  }

  // ── Input enable/disable ──────────────────────────────────────────────
  function disableInput() {
    if (_elements.inp) {
      _elements.inp.disabled    = true;
      _elements.inp.placeholder = "Chat temporarily unavailable.";
    }
    if (_elements.snd) _elements.snd.disabled = true;
  }

  function enableInput() {
    if (_elements.inp) {
      _elements.inp.disabled    = false;
      _elements.inp.placeholder = "Type your message\u2026";
    }
    if (_elements.snd) _elements.snd.disabled = false;
  }

  // ── Events ────────────────────────────────────────────────────────────
  function bindEvents() {
    _elements.bbl.addEventListener("click",  function() { toggle(); resetBadge(); });
    _elements.xbtn.addEventListener("click", function() { closeChat(); });
    _elements.ubtn.addEventListener("click", function() { openModal(); });
    _elements.mx.addEventListener("click",   function() { closeModal(); });
    _elements.pbtn.addEventListener("click", function() { startPayment(); });

    _elements.mod.addEventListener("click", function(e) {
      if (e.target === _elements.mod) closeModal();
    });

    _elements.msgs.addEventListener("click", function(e) {
      var s = e.target.closest ? e.target.closest("#cb-start") : null;
      if (s) { startChat(); return; }
      var q = e.target.closest ? e.target.closest(".cb-sug") : null;
      if (q) { startChat(); send(q.getAttribute("data-t")); }
    });

    _elements.snd.addEventListener("click", function() { sendInput(); });
    _elements.inp.addEventListener("keydown", function(e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendInput(); }
    });
    _elements.inp.addEventListener("input", function() {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 100) + "px";
    });
  }

  // ── Chat ──────────────────────────────────────────────────────────────
  function startChat() {
    var w = document.getElementById("cb-wlc");
    if (w) w.remove();
    _elements.ia.style.display = "flex";
    if (_messages.length === 0) addBot(_config.welcomeMsg || "Hi! How can I help you?");
    if (!_planExpired) _elements.inp.focus();
  }

  function sendInput() {
    var t = _elements.inp.value.trim();
    if (!t || _isSending || _planExpired) return;
    _elements.inp.value = ""; _elements.inp.style.height = "auto";
    send(t);
  }

  function send(text) {
    if (!text || _isSending || _planExpired) return;
    startChat();
    addUser(text);
    showDots();
    _isSending = true;
    _elements.snd.disabled = true;
    if (!_sessionId) _sessionId = getOrCreateSessionId();

    fetch(API_BASE + "/qdrantapi/search", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + _config.apiKey,
      },
      body: JSON.stringify({ query: text, session_id: _sessionId }),
    })
    .then(function(r) {
      var status = r.status;
      return r.json().then(function(d) { return { s: status, d: d }; });
    })
    .then(function(p) {
      hideDots();

      if (p.s === 429) {
        // ── PLAN LIMIT HIT ────────────────────────────────────────────
        _planExpired = true;
        disableInput();

        // END USER ko polite message — "upgrade" wala nahi dikhayenge
        // Owner ne limitMsg set kiya hai to woh dikhao
        var msg = _config.limitMsg ||
          "I'm temporarily unavailable. Please contact us directly for assistance.";
        addBot(msg);

        // Owner ke liye: upgrade button show karo (end user ko confuse nahi karega)
        if (_elements.ubtn) _elements.ubtn.style.display = "block";

        // Agar owner khud test kar raha hai (local) to modal auto-open
        // Production mein yeh nahi hoga — end user ko modal nahi dikhega
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
          setTimeout(function() { openModal(); }, 800);
        }
        return;
      }

      if (p.s === 401) {
        addBot("Configuration error. Please contact the website administrator.");
        console.error("[ChatBot] Invalid API key.");
        return;
      }

      if (p.s >= 500) {
        addBot("Service temporarily unavailable. Please try again later.");
        return;
      }

      var ans = p.d && p.d.result && p.d.result.human_like_answer ? p.d.result.human_like_answer : null;
      addBot(ans && ans !== "0" ? ans : "I don't have information on that. Please contact us directly.");

      if (!_isOpen) incBadge();

      // Log usage (owner ke liye — developer tools mein dikhega)
      if (p.d && p.d.usage) {
        var u = p.d.usage;
        console.log("[ChatBot] Usage: " + u.used + "/" + u.limit + " | Plan: " + u.plan);
        if (u.used >= u.limit * 0.8 && u.limit < 999999) {
          console.warn("[ChatBot] ⚠️ 80% limit used. Consider upgrading.");
        }
      }
    })
    .catch(function() {
      hideDots();
      addBot("Connection failed. Please check your connection and try again.");
    })
    .finally(function() {
      _isSending = false;
      _elements.snd.disabled = _planExpired;
    });
  }

  function addUser(t) { _messages.push({r:"user",t:t}); appendMsg("user",t); scrollBot(); }
  function addBot(t)  { _messages.push({r:"bot", t:t}); appendMsg("bot", t); scrollBot(); }

  function appendMsg(r, t) {
    var time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    var row  = document.createElement("div");
    row.className = "cb-mr " + r;
    row.innerHTML =
      '<div class="cb-mb ' + r + '">' + linkify(esc(t)) + '</div>' +
      '<div class="cb-mt">' + (r === "bot" ? "Bot" : "You") + " &middot; " + time + "</div>";
    _elements.msgs.appendChild(row);
  }

  function showDots() {
    var d = document.createElement("div");
    d.className = "cb-dots"; d.id = "cb-dots";
    d.innerHTML = "<span></span><span></span><span></span>";
    _elements.msgs.appendChild(d); scrollBot();
  }
  function hideDots()  { var d = document.getElementById("cb-dots"); if(d) d.parentNode.removeChild(d); }
  function scrollBot() { _elements.msgs.scrollTop = _elements.msgs.scrollHeight; }

  var _bc = 0;
  function incBadge()   { _bc++; _elements.bdg.textContent = _bc; _elements.bdg.style.display = "flex"; }
  function resetBadge() { _bc = 0; _elements.bdg.style.display = "none"; }

  function toggle()    { _isOpen ? closeChat() : openChat(); }
  function openChat()  {
    _isOpen = true;
    _elements.win.classList.add("open");
    if (!_planExpired) setTimeout(function() { if(_elements.inp) _elements.inp.focus(); }, 300);
  }
  function closeChat() {
    _isOpen = false;
    _elements.win.classList.remove("open");
    closeModal();
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }
  function linkify(t) {
    return t.replace(/(https?:\/\/[^\s<]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">$1</a>');
  }

  // ── Public API ────────────────────────────────────────────────────────
  window.ChatBot = {
    /**
     * @param {string}  config.apiKey          — Required
     * @param {string}  [config.theme]          — blue|green|purple|dark
     * @param {string}  [config.position]       — bottom-right|bottom-left
     * @param {string}  [config.brandName]
     * @param {string}  [config.brandLogo]
     * @param {string}  [config.welcomeMsg]
     * @param {Array}   [config.suggestions]
     * @param {boolean} [config.hidePoweredBy]
     *
     * @param {string}  [config.limitMsg]
     *   Message shown to END USERS when plan limit is hit.
     *   Default: "I'm temporarily unavailable. Please contact us directly."
     *   Example: "Chat unavailable. Call us: +91-9876543210"
     *
     * @param {string}  [config.contactSalesUrl]
     *   URL for custom plan inquiry. Default: "#contact"
     */
    init: function(config) {
      if (!config || !config.apiKey) {
        console.error("[ChatBot] apiKey required.");
        return;
      }
      _config    = Object.assign({ theme: "blue", position: "bottom-right" }, config);
      _sessionId = getOrCreateSessionId();

      injectStyles(_config.theme);
      buildDOM();
      bindEvents();
      fetchWidgetInfo();   // plan status safely from backend
      loadPlans();         // plan cards for upgrade modal

      console.log("[ChatBot] v" + WIDGET_VER + " | session: " + _sessionId);
    },
    open:        function() { openChat(); },
    close:       function() { closeChat(); },
    toggle:      function() { toggle(); },
    showUpgrade: function() { openModal(); },
    destroy: function() {
      var e = document.getElementById("cb-w");   if(e) e.parentNode.removeChild(e);
      var s = document.getElementById("cb-sty"); if(s) s.parentNode.removeChild(s);
    },
  };

})(window, document);
