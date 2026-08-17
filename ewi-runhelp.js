/* EWI Run-Help — shared "New here? Running it is easy" panel for every product page.
   Zero dependencies. Self-contained. Theme-aware (respects [data-theme] + prefers-color-scheme).
   Injects a small "Run locally" button that opens an accessible modal with:
     • the easy, no-typing steps,
     • a "Prefer to type a command?" block with a one-click Copy (macOS/Linux + Windows),
     • common fixes.
   Accessibility: focus trap, Esc to close, aria roles, reduced-motion aware, WCAG 2.2 target sizes. */
(function () {
  "use strict";
  if (window.__ewiRunHelp) return;
  window.__ewiRunHelp = true;

  var MAC_CMD =
    'd="$(find "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents" "$HOME" -maxdepth 3 -type d -name EWI-Suite 2>/dev/null | head -n1)"; ' +
    '[ -n "$d" ] && bash "$d/Start EWI Suite (Mac).command" || ' +
    'echo "Could not find the EWI-Suite folder - unzip ewi-suite.zip first."';

  var LINUX_CMD =
    'd="$(find "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents" "$HOME" -maxdepth 3 -type d -name EWI-Suite 2>/dev/null | head -n1)"; ' +
    '[ -n "$d" ] && bash "$d/Start EWI Suite (Linux).sh" || ' +
    'echo "Could not find the EWI-Suite folder - unzip ewi-suite.zip first."';

  var WIN_CMD =
    '$d = Get-ChildItem "$HOME\\Downloads","$HOME\\Desktop","$HOME\\Documents" ' +
    '-Recurse -Depth 3 -Directory -Filter EWI-Suite -ErrorAction SilentlyContinue | ' +
    'Select-Object -First 1; if ($d) { & "$($d.FullName)\\Start EWI Suite (Windows).bat" } ' +
    'else { "Could not find the EWI-Suite folder - unzip ewi-suite.zip first." }';

  var CMD = { mac: MAC_CMD, linux: LINUX_CMD, win: WIN_CMD };
  var LAUNCHER = { mac: "Start EWI Suite (Mac).command", linux: "Start EWI Suite (Linux).sh", win: "Start EWI Suite (Windows).bat" };

  function isDark() {
    var t = document.documentElement.getAttribute("data-theme");
    if (t === "dark") return true;
    if (t === "light") return false;
    try {
      var bg = getComputedStyle(document.body).backgroundColor || "";
      var m = bg.match(/\d+(\.\d+)?/g);
      if (m && m.length >= 3)
        return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) < 128;
    } catch (e) {}
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var lastFocus = null;
  var currentOS = /Win/i.test(navigator.platform || navigator.userAgent) ? "win"
    : (/Mac/i.test(navigator.platform || navigator.userAgent) ? "mac" : "linux");

  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  function injectCSS() {
    var dark = isDark();
    var s = el("style", { id: "ewi-rh-css" });
    s.textContent =
      "#ewi-rh-open{position:fixed;top:7px;right:58px;z-index:99998;display:inline-flex;align-items:center;gap:7px;" +
      "height:34px;padding:0 14px;border-radius:100px;border:1px solid " + (dark ? "#3a3a3c" : "#d2d2d7") + ";" +
      "background:" + (dark ? "rgba(28,28,30,.92)" : "rgba(255,255,255,.92)") + ";backdrop-filter:saturate(180%) blur(20px);" +
      "-webkit-backdrop-filter:saturate(180%) blur(20px);color:" + (dark ? "#f5f5f7" : "#1d1d1f") + ";font-weight:600;" +
      "font-size:12.5px;cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;" +
      "box-shadow:0 6px 22px rgba(0,0,0,.16)}" +
      "#ewi-rh-open:hover{background:" + (dark ? "#3a3a3c" : "#f5f5f7") + "}" +
      "#ewi-rh-open .d{width:16px;height:16px;border-radius:50%;background:linear-gradient(135deg,#ff375f,#ff8aa3);" +
      "display:inline-flex;align-items:center;justify-content:center;color:#2a0410;font-size:9px;font-weight:800}" +
      "#ewi-rh-ov{position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,.44);display:none;align-items:center;justify-content:center;padding:18px}" +
      "#ewi-rh-ov.open{display:flex}" +
      "#ewi-rh-modal{width:min(560px,94vw);max-height:88vh;overflow:auto;border-radius:20px;" +
      "background:" + (dark ? "#141416" : "#ffffff") + ";color:" + (dark ? "#f5f5f7" : "#1d1d1f") + ";" +
      "border:1px solid " + (dark ? "#2a2a2e" : "#e6e6eb") + ";box-shadow:0 24px 70px rgba(0,0,0,.4);" +
      "font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Arial,sans-serif;" +
      (reduce ? "" : "transform:translateY(8px) scale(.98);opacity:0;transition:transform .22s cubic-bezier(.2,.7,.2,1),opacity .22s") + "}" +
      "#ewi-rh-ov.open #ewi-rh-modal{transform:none;opacity:1}" +
      "#ewi-rh-modal .hd{display:flex;align-items:center;gap:11px;padding:18px 18px 6px}" +
      "#ewi-rh-modal .hd .m{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#ff375f,#ff8aa3);" +
      "display:grid;place-items:center;color:#2a0410;font-weight:800;font-size:13px}" +
      "#ewi-rh-modal h2{margin:0;font-size:17px;letter-spacing:-.01em}" +
      "#ewi-rh-modal .sub{color:" + (dark ? "#98989d" : "#6e6e73") + ";font-size:12.5px;margin:2px 18px 0;line-height:1.5}" +
      "#ewi-rh-modal .bd{padding:12px 18px 18px}" +
      "#ewi-rh-modal h3{font-size:12px;letter-spacing:.4px;text-transform:uppercase;color:" + (dark ? "#98989d" : "#6e6e73") + ";margin:16px 0 8px}" +
      "#ewi-rh-modal ol{margin:0;padding-left:20px;line-height:1.65;font-size:13.5px}" +
      "#ewi-rh-modal ol li{margin:4px 0}" +
      "#ewi-rh-modal .note{font-size:12px;color:" + (dark ? "#98989d" : "#6e6e73") + ";line-height:1.55;margin-top:8px}" +
      "#ewi-rh-tabs{display:inline-flex;gap:5px;background:" + (dark ? "#1d1d20" : "#f1f1f4") + ";padding:4px;border-radius:11px;margin-bottom:10px}" +
      "#ewi-rh-tabs button{border:none;background:transparent;color:inherit;font:inherit;font-size:12.5px;font-weight:700;" +
      "padding:6px 14px;border-radius:8px;cursor:pointer;min-height:32px}" +
      "#ewi-rh-tabs button.on{background:" + (dark ? "#3a3a3c" : "#ffffff") + ";box-shadow:0 1px 3px rgba(0,0,0,.12)}" +
      "#ewi-rh-cmd{position:relative;background:" + (dark ? "#0b0b0d" : "#0c0d10") + ";color:#e7ecf3;border-radius:12px;" +
      "padding:13px 14px;font-family:'SF Mono',ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.55;" +
      "white-space:pre-wrap;word-break:break-word;border:1px solid " + (dark ? "#26262b" : "#1c1d22") + "}" +
      "#ewi-rh-copy{margin-top:9px;display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 14px;border-radius:9px;" +
      "border:none;background:linear-gradient(135deg,#ff375f,#e11d48);color:#fff;font:inherit;font-weight:700;font-size:12.5px;cursor:pointer}" +
      "#ewi-rh-copy:hover{filter:brightness(1.06)}" +
      "#ewi-rh-modal details{margin-top:10px;border-top:1px solid " + (dark ? "#26262b" : "#ececf1") + ";padding-top:8px}" +
      "#ewi-rh-modal summary{cursor:pointer;font-size:13px;font-weight:600;list-style:none}" +
      "#ewi-rh-modal summary::-webkit-details-marker{display:none}" +
      "#ewi-rh-modal details ul{margin:8px 0 0;padding-left:18px;font-size:12.5px;line-height:1.6;color:" + (dark ? "#c7c7cc" : "#3a3a3e") + "}" +
      "#ewi-rh-modal details ul li{margin:5px 0}" +
      "#ewi-rh-x{position:absolute;top:14px;right:14px;width:30px;height:30px;border-radius:8px;border:none;cursor:pointer;" +
      "background:" + (dark ? "#26262b" : "#f1f1f4") + ";color:inherit;font-size:16px;line-height:1;display:grid;place-items:center}" +
      "#ewi-rh-x:hover{background:" + (dark ? "#3a3a3c" : "#e4e4ea") + "}" +
      "#ewi-rh-modal code{background:" + (dark ? "#26262b" : "#f1f1f4") + ";padding:1px 5px;border-radius:5px;font-size:11.5px}" +
      "#ewi-rh-modal a{color:#ff6b8a}" +
      "#ewi-rh-open:focus-visible,#ewi-rh-copy:focus-visible,#ewi-rh-x:focus-visible,#ewi-rh-tabs button:focus-visible{outline:2px solid #7cc0ff;outline-offset:2px}" +
      // Responsive: tablets / small laptops tighten the pill; phones collapse the
      // "Run locally" wordmark to an icon-only circle so the header controls
      // never overlap. placeInHeader() re-reads the live (collapsed) width and
      // keeps the Light/Dark button seated just to its left on every resize.
      "@media (max-width:900px){#ewi-rh-open{padding:0 11px;font-size:11.5px;gap:6px}}" +
      "@media (max-width:560px){#ewi-rh-open{font-size:0;gap:0;width:34px;padding:0;justify-content:center}#ewi-rh-open .d{font-size:9px}#ewi-rh-modal{width:min(560px,96vw)}}";
    document.head.appendChild(s);
  }

  // ---- Header placement ---------------------------------------------------
  // Seat "Run locally" in the shared 34px header lane: just to the RIGHT of the
  // theme (Light/Dark) button and just to the LEFT of the app-switcher. We read
  // the switcher's live geometry and push the theme button leftward to make
  // room, so the order reads  [Light/Dark] [Run locally] [switcher]  with no
  // overlap — robust to script load order, theme-label width changes, and
  // viewport resize. Falls back gracefully if either control is absent.
  function placeInHeader() {
    var btn = document.getElementById("ewi-rh-open");
    if (!btn) return;
    var GAP = 10;
    var sw = document.getElementById("ewi-sw"); // app switcher (rightmost control)
    var rlRight;
    if (sw) {
      var r = sw.getBoundingClientRect();
      var swGap = Math.max(8, Math.round(window.innerWidth - r.right));
      rlRight = swGap + Math.round(r.width) + GAP; // sit just left of the switcher
    } else {
      rlRight = 14; // no switcher on this page → pin to the corner
    }
    btn.style.left = "auto";
    btn.style.bottom = "auto";
    btn.style.top = "7px";
    btn.style.right = rlRight + "px";
    // Push the theme button to sit just to the LEFT of "Run locally".
    var theme = document.getElementById("ewiThemeBtn");
    if (theme) {
      var rlW = Math.round(btn.getBoundingClientRect().width) || btn.offsetWidth || 128;
      theme.style.right = (rlRight + rlW + GAP) + "px";
    }
  }

  function schedulePlacement() {
    placeInHeader();
    // The theme button and switcher are injected by their own scripts and may
    // appear AFTER this deferred script runs. Re-place the moment either is
    // inserted so there is no visible jump, then disconnect once both exist.
    if (!schedulePlacement._obs && window.MutationObserver) {
      var obs = new MutationObserver(function () { placeInHeader(); });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      schedulePlacement._obs = obs;
      var ticks = 0;
      var iv = setInterval(function () {
        placeInHeader();
        var ready = document.getElementById("ewi-sw") && document.getElementById("ewiThemeBtn");
        if (ready || ticks++ > 40) { obs.disconnect(); clearInterval(iv); }
      }, 100);
    }
    if (!schedulePlacement._bound) {
      schedulePlacement._bound = true;
      window.addEventListener("resize", placeInHeader);
      window.addEventListener("load", placeInHeader);
    }
  }

  function cmdFor(os) { return CMD[os] || MAC_CMD; }
  function termHint(os) {
    if (os === "win") return "To open PowerShell: press <b>Win</b>, type <code>PowerShell</code>, press Enter.";
    if (os === "linux") return "Open your terminal, paste it, and press Enter.";
    return "To open Terminal: press <b>Cmd + Space</b>, type <code>Terminal</code>, press Enter.";
  }
  function launcherName(os) { return LAUNCHER[os] || LAUNCHER.mac; }

  var ov, modal, cmdBox, copyBtn, termNote, launchStep;

  function renderOS(os) {
    currentOS = os;
    ["mac", "linux", "win"].forEach(function (k) {
      var t = document.getElementById("ewi-rh-tab-" + k);
      var on = k === os;
      t.classList.toggle("on", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    cmdBox.textContent = cmdFor(os);
    termNote.innerHTML = termHint(os);
    launchStep.innerHTML = "Open it and double-click the launcher for your computer — <b>" + esc(launcherName(os)) + "</b>.";
    copyBtn.textContent = "Copy launch command";
  }

  function build() {
    injectCSS();

    var btn = el("button", { id: "ewi-rh-open", type: "button", "aria-haspopup": "dialog",
      title: "How to run the EWI Suite on your own computer" },
      '<span class="d" aria-hidden="true">▶</span>Run locally');
    btn.addEventListener("click", open);
    document.body.appendChild(btn);

    ov = el("div", { id: "ewi-rh-ov" });
    modal = el("div", { id: "ewi-rh-modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "ewi-rh-title" });
    modal.innerHTML =
      '<button id="ewi-rh-x" type="button" aria-label="Close">✕</button>' +
      '<div class="hd"><div class="m" aria-hidden="true">EW</div><h2 id="ewi-rh-title">New here? Running it is easy</h2></div>' +
      '<p class="sub">Everything runs on your own computer — nothing is uploaded. You just need ' +
      '<b>Python 3</b> (a free, one-time install from <a href="https://www.python.org/downloads/" target="_blank" rel="noopener">python.org</a>).</p>' +
      '<div class="bd">' +
        '<h3>The easy way — no typing</h3>' +
        '<ol>' +
          '<li>Unzip the download. You get a folder called <b>EWI-Suite</b>.</li>' +
          '<li id="ewi-rh-launch">Open it and double-click the launcher for your computer.</li>' +
          '<li>A small menu opens. Type a number, press Return — your browser opens the app. Press <code>Ctrl + C</code> to stop it.</li>' +
        '</ol>' +
        '<p class="note">On macOS, the very first time, right-click (or Control-click) the launcher and choose <b>Open → Open</b> — macOS asks once for files from the internet.</p>' +
        '<h3>Prefer to type a command?</h3>' +
        '<div id="ewi-rh-tabs" role="tablist" aria-label="Operating system">' +
          '<button id="ewi-rh-tab-mac" role="tab" type="button">macOS</button>' +
          '<button id="ewi-rh-tab-linux" role="tab" type="button">Linux</button>' +
          '<button id="ewi-rh-tab-win" role="tab" type="button">Windows</button>' +
        '</div>' +
        '<div id="ewi-rh-cmd" aria-label="Launch command"></div>' +
        '<button id="ewi-rh-copy" type="button">Copy launch command</button>' +
        '<p class="note">A web page can’t open your terminal for you — that’s a browser safety rule, not a bug — so you paste it yourself. <span id="ewi-rh-term"></span></p>' +
        '<details><summary>Something went wrong? Common fixes</summary><ul>' +
          '<li><b>“no such file or directory”</b> — you’re not inside the EWI-Suite folder. Use the double-click launcher, or first run <code>cd ~/Downloads/EWI-Suite</code>.</li>' +
          '<li><b>“number expected” / “unknown sort specifier”</b> — you pasted a note line that starts with <code>#</code>. Those are comments, not commands. Paste only the real command.</li>' +
          '<li><b>“command not found: yourname@YourMac”</b> — you copied your terminal’s prompt (text ending in <code>%</code> or <code>$</code>) along with the command. Copy just the command.</li>' +
          '<li><b>“python3: command not found”</b> — install Python 3 from <a href="https://www.python.org/downloads/" target="_blank" rel="noopener">python.org/downloads</a> (Windows: tick “Add python.exe to PATH”), then try again.</li>' +
          '<li><b>Page won’t load / “Address already in use”</b> — that app is already running in another window. Close it, or pick a different app from the menu.</li>' +
        '</ul></details>' +
      '</div>';
    ov.appendChild(modal);
    document.body.appendChild(ov);

    cmdBox = document.getElementById("ewi-rh-cmd");
    copyBtn = document.getElementById("ewi-rh-copy");
    termNote = document.getElementById("ewi-rh-term");
    launchStep = document.getElementById("ewi-rh-launch");

    document.getElementById("ewi-rh-tab-mac").addEventListener("click", function () { renderOS("mac"); });
    document.getElementById("ewi-rh-tab-linux").addEventListener("click", function () { renderOS("linux"); });
    document.getElementById("ewi-rh-tab-win").addEventListener("click", function () { renderOS("win"); });
    document.getElementById("ewi-rh-x").addEventListener("click", close);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    copyBtn.addEventListener("click", function () {
      var txt = cmdFor(currentOS);
      var done = function () { copyBtn.textContent = "✓ Copied — paste in your terminal"; setTimeout(function () { copyBtn.textContent = "Copy launch command"; }, 2400); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { legacyCopy(txt); done(); });
      else { legacyCopy(txt); done(); }
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && ov.classList.contains("open")) close(); });

    renderOS(currentOS);
    schedulePlacement();
  }

  function legacyCopy(txt) {
    var ta = el("textarea"); ta.value = txt; ta.style.position = "fixed"; ta.style.left = "-9999px";
    document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta);
  }

  function focusables() {
    return modal.querySelectorAll('button, [href], input, summary, [tabindex]:not([tabindex="-1"])');
  }
  function open() {
    lastFocus = document.activeElement;
    ov.classList.add("open");
    document.getElementById("ewi-rh-x").focus();
    document.addEventListener("focus", trap, true);
  }
  function close() {
    ov.classList.remove("open");
    document.removeEventListener("focus", trap, true);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function trap(e) {
    if (!ov.classList.contains("open")) return;
    if (modal.contains(e.target)) return;
    e.stopPropagation();
    var f = focusables(); if (f.length) f[0].focus();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
