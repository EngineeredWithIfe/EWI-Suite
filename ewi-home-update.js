/* ===========================================================================
   EWI Suite — home-page "keep your copy current" control.

   Renders ONE button on the EWI home page:
     "Download a fresh copy"  — always saves a NEW, version-stamped file
     (ewi-suite-<version>.zip), so it never collides with an older copy.

   The request is cache-busted with the current build version, so a visitor
   who already downloaded an older bundle is guaranteed the newest bytes — the
   fix for "I re-downloaded but the app looks unchanged."

   Honesty note: no web page can reach into a visitor's disk and delete or
   overwrite a file without their consent — that is a hard browser sandbox
   guarantee (~100%, enforced by every major engine). Saving a fresh,
   version-stamped file is the reliable, universally supported path.
   =========================================================================== */
(function () {
  "use strict";
  if (window.__ewiHomeUpdate) return; window.__ewiHomeUpdate = true;

  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || "";
  function root(path) {
    return SCRIPT_SRC ? new URL(path, SCRIPT_SRC).href : path;
  }
  var ZIP_URL = root("downloads/ewi-suite.zip");
  var VERSION_URL = root("downloads/version.json");

  function injectStyles() {
    if (document.getElementById("ewi-upd-styles")) return;
    var s = document.createElement("style");
    s.id = "ewi-upd-styles";
    s.textContent =
      "#ewi-update .ewi-updbtns{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:26px}" +
      ".ewi-updbtn{appearance:none;cursor:pointer;font:inherit;font-weight:600;font-size:15px;" +
      "padding:13px 24px;border-radius:14px;display:inline-flex;align-items:center;gap:10px;" +
      "border:1px solid var(--hair,#d2d2d7);background:var(--bg,#fff);color:var(--ink,#0b0b0c);" +
      "transition:transform .15s ease,filter .15s ease,background .2s ease,border-color .2s ease}" +
      ".ewi-updbtn:hover{transform:translateY(-1px)}" +
      ".ewi-updbtn:active{transform:translateY(0)}" +
      ".ewi-updbtn:focus-visible{outline:2px solid var(--accent,#0071e3);outline-offset:3px}" +
      ".ewi-updbtn.primary{border-color:transparent;color:#fff;background:var(--accent,#0071e3)}" +
      ".ewi-updbtn.primary:hover{filter:brightness(1.07)}" +
      ".ewi-updbtn svg{width:17px;height:17px;flex:none}" +
      ".ewi-updbtn[disabled]{opacity:.6;cursor:progress;transform:none}" +
      "#ewi-update .ewi-updmeta{margin-top:16px;font-size:13px;color:var(--sub,#6e6e73);min-height:1.2em}" +
      "#ewi-update .ewi-updhint{margin-top:6px;font-size:12.5px;color:var(--sub,#6e6e73)}" +
      "@media (prefers-reduced-motion: reduce){.ewi-updbtn{transition:none}}";
    document.head.appendChild(s);
  }

  var DL_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3v12"/><path d="m7 12 5 5 5-5"/><path d="M5 21h14"/></svg>';

  var meta; // status line (aria-live)
  function say(msg) { if (meta) meta.textContent = msg || ""; }

  function fmtBytes(n) {
    if (!n && n !== 0) return "";
    if (n < 1024) return n + " B";
    var kb = n / 1024; if (kb < 1024) return kb.toFixed(0) + " KB";
    return (kb / 1024).toFixed(1) + " MB";
  }

  // Version metadata is optional; the buttons still work without it.
  function loadVersion() {
    return fetch(VERSION_URL, { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }
  function versionTag(v) {
    return (v && v.version) ? String(v.version) : String(Date.now());
  }
  function bust(url, v) {
    return url + (url.indexOf("?") < 0 ? "?" : "&") + "v=" + encodeURIComponent(versionTag(v));
  }

  function anchorDownload(url, filename) {
    var a = document.createElement("a");
    a.href = url; a.download = filename; a.rel = "noopener";
    document.body.appendChild(a); a.click();
    setTimeout(function () { if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
  }

  function freshCopy(v) {
    var url = bust(ZIP_URL, v);
    var name = "ewi-suite-" + versionTag(v) + ".zip";
    anchorDownload(url, name);
    say("Saved a fresh copy: " + name + " — a brand-new file, safe to keep alongside older ones.");
  }

  // --------------------------------------------------------------------------
  // "How to run it" help — the beginner-friendly companion to the download.
  // Most people who download the zip get stuck at the SAME two things: they run
  // a command from the wrong folder ("no such file or directory"), or they paste
  // a note/prompt line into the shell. This card gives them the no-typing path
  // (double-click a launcher) AND a one-line, OS-correct command they can copy.
  // --------------------------------------------------------------------------
  function osKind() {
    var uad = navigator.userAgentData;
    var p = (uad && uad.platform) || navigator.platform || navigator.userAgent || "";
    p = String(p).toLowerCase();
    if (p.indexOf("win") >= 0) return "win";
    if (p.indexOf("mac") >= 0 || p.indexOf("iphone") >= 0 || p.indexOf("ipad") >= 0) return "mac";
    if (p.indexOf("linux") >= 0 || p.indexOf("android") >= 0) return "linux";
    return "mac";
  }

  // One line that finds the unzipped EWI-Suite folder in the usual places and
  // starts the interactive launcher — no manual "cd" required.
  var LAUNCH_CMD = {
    mac:
      'd="$(find "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents" "$HOME" ' +
      '-maxdepth 3 -type d -name EWI-Suite 2>/dev/null | head -n1)"; ' +
      '[ -n "$d" ] && bash "$d/Start EWI Suite (Mac).command" || ' +
      'echo "Could not find the EWI-Suite folder - unzip ewi-suite.zip first."',
    linux:
      'd="$(find "$HOME/Downloads" "$HOME/Desktop" "$HOME/Documents" "$HOME" ' +
      '-maxdepth 3 -type d -name EWI-Suite 2>/dev/null | head -n1)"; ' +
      '[ -n "$d" ] && bash "$d/Start EWI Suite (Linux).sh" || ' +
      'echo "Could not find the EWI-Suite folder - unzip ewi-suite.zip first."',
    win:
      '$d = Get-ChildItem "$HOME\\Downloads","$HOME\\Desktop","$HOME\\Documents" ' +
      '-Recurse -Depth 3 -Directory -Filter EWI-Suite -ErrorAction SilentlyContinue | ' +
      'Select-Object -First 1; if ($d) { & "$($d.FullName)\\Start EWI Suite (Windows).bat" } ' +
      'else { "Could not find the EWI-Suite folder - unzip ewi-suite.zip first." }'
  };
  var TERMINAL_NAME = { mac: "Terminal", linux: "a terminal", win: "PowerShell" };
  var LAUNCHER_FILE = {
    mac: "Start EWI Suite (Mac).command",
    linux: "Start EWI Suite (Linux).sh",
    win: "Start EWI Suite (Windows).bat"
  };

  function injectRunHelpStyles() {
    if (document.getElementById("ewi-run-styles")) return;
    var s = document.createElement("style");
    s.id = "ewi-run-styles";
    s.textContent =
      "#ewi-run .ewi-runsteps{max-width:760px;margin:20px auto 0;text-align:left;padding-left:22px}" +
      "#ewi-run .ewi-runsteps li{margin:10px 0;line-height:1.5}" +
      "#ewi-run code{font:600 13px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;" +
      "background:var(--soft,#f2f2f5);border:1px solid var(--hair,#d2d2d7);border-radius:6px;padding:1px 6px}" +
      "#ewi-run .ewi-cmdrow{display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;margin-top:22px}" +
      "#ewi-run .ewi-cmdbox{flex:1 1 460px;max-width:640px;text-align:left;overflow-x:auto;" +
      "font:600 12.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre;" +
      "background:var(--soft,#f2f2f5);border:1px solid var(--hair,#d2d2d7);border-radius:12px;padding:13px 16px;color:var(--ink,#0b0b0c)}" +
      "#ewi-run .ewi-copybtn{white-space:nowrap}" +
      "#ewi-run .ewi-runnote{max-width:760px;margin:18px auto 0;font-size:13px;color:var(--sub,#6e6e73);text-align:left}" +
      "#ewi-run details{max-width:760px;margin:16px auto 0;text-align:left}" +
      "#ewi-run summary{cursor:pointer;font-weight:600;color:var(--ink,#0b0b0c)}" +
      "#ewi-run details ul{margin:12px 0 0;padding-left:20px}" +
      "#ewi-run details li{margin:9px 0;line-height:1.5;color:var(--sub,#6e6e73)}" +
      "#ewi-run details li b{color:var(--ink,#0b0b0c)}";
    document.head.appendChild(s);
  }

  var COPY_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="11" height="11" rx="2"/>' +
    '<path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", "");
        ta.style.position = "absolute"; ta.style.left = "-9999px";
        document.body.appendChild(ta); ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("copy failed"));
      } catch (e) { reject(e); }
    });
  }

  function buildRunHelp() {
    injectStyles();
    injectRunHelpStyles();
    var os = osKind();
    var cmd = LAUNCH_CMD[os];
    var term = TERMINAL_NAME[os];
    var launcher = LAUNCHER_FILE[os];

    var sec = document.createElement("section");
    sec.className = "band"; sec.id = "ewi-run";
    sec.innerHTML =
      '<div class="inner">' +
      "<h2>New here? Running it is easy.</h2>" +
      "<p>Everything runs on your own computer — nothing is uploaded. You just need " +
      "Python 3 (a free, one-time install from python.org). Then pick either path below.</p>" +

      "<h3 style=\"margin-top:26px\">The easy way — no typing</h3>" +
      '<ol class="ewi-runsteps">' +
      "<li>Unzip the download. You get a folder called <code>EWI-Suite</code>.</li>" +
      "<li>Open it and double-click the launcher for your computer — " +
      "<code>" + launcher + "</code>.</li>" +
      "<li>A small menu opens. Type a number, press Return — your browser opens the app. " +
      "Press <code>Ctrl + C</code> to stop it.</li>" +
      "</ol>" +
      '<p class="ewi-runnote">On <b>macOS</b>, the very first time, right-click (or Control-click) ' +
      "the launcher and choose <b>Open</b> &rarr; <b>Open</b> — macOS asks once for files from the internet.</p>" +

      "<h3 style=\"margin-top:30px\">Prefer to type a command?</h3>" +
      "<p>Copy this, open <b>" + term + "</b>, paste it, and press Return. It finds your " +
      "<code>EWI-Suite</code> folder and starts the menu for you:</p>" +
      '<div class="ewi-cmdrow">' +
      '<div class="ewi-cmdbox" id="ewiRunCmd" tabindex="0" aria-label="Launch command"></div>' +
      '<button class="ewi-updbtn primary ewi-copybtn" id="ewiRunCopy" type="button" ' +
      'aria-label="Copy the launch command">' + COPY_ICON + "Copy launch command</button>" +
      "</div>" +
      '<p class="ewi-updmeta" id="ewiRunMeta" role="status" aria-live="polite"></p>' +
      '<p class="ewi-runnote">A web page can\u2019t open ' + term + " for you — that\u2019s a browser " +
      "safety rule, not a bug — so you paste it yourself. To open " + term + ": " +
      (os === "win"
        ? "press the Start button, type <b>PowerShell</b>, press Enter."
        : os === "mac"
          ? "press <b>Cmd + Space</b>, type <b>Terminal</b>, press Return."
          : "open your <b>Terminal</b> app from the applications menu.") + "</p>" +

      "<details><summary>Something went wrong? Common fixes</summary><ul>" +
      "<li><b>\u201Cno such file or directory\u201D</b> — you\u2019re not inside the " +
      "<code>EWI-Suite</code> folder. Use the double-click launcher, or first run " +
      "<code>cd ~/Downloads/EWI-Suite</code>.</li>" +
      "<li><b>\u201Cnumber expected\u201D / \u201Cunknown sort specifier\u201D</b> — you pasted a " +
      "note line that starts with <code>#</code>. Those are comments, not commands. Paste only the real command.</li>" +
      "<li><b>\u201Ccommand not found: yourname@YourMac\u201D</b> — you copied your terminal\u2019s " +
      "prompt (the text ending in % or $) along with the command. Copy just the command.</li>" +
      "<li><b>\u201Cpython3: command not found\u201D</b> — install Python 3 from " +
      "<b>python.org/downloads</b> (Windows: tick \u201CAdd python.exe to PATH\u201D), then try again.</li>" +
      "<li><b>Page won\u2019t load / \u201CAddress already in use\u201D</b> — that app is already " +
      "running in another window. Close it, or pick a different app from the menu.</li>" +
      "</ul></details>" +
      "</div>";

    var anchor = document.getElementById("ewi-update") || document.getElementById("platforms");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor);
    else document.body.appendChild(sec);

    var box = document.getElementById("ewiRunCmd");
    var rmeta = document.getElementById("ewiRunMeta");
    if (box) box.textContent = cmd;
    document.getElementById("ewiRunCopy").addEventListener("click", function () {
      copyText(cmd).then(function () {
        if (rmeta) rmeta.textContent = "\u2713 Copied. Open " + term + ", paste (" +
          (os === "mac" ? "Cmd" : "Ctrl") + " + V), and press Return.";
      }).catch(function () {
        if (rmeta) rmeta.textContent = "Couldn\u2019t copy automatically — select the command above and copy it manually.";
      });
    });
  }

  function build() {
    injectStyles();
    var sec = document.createElement("section");
    sec.className = "band"; sec.id = "ewi-update";
    sec.innerHTML =
      '<div class="inner">' +
      "<h2>Already have the app? Keep it current.</h2>" +
      "<p>Downloaded an earlier build? If a product looks unchanged after an update, your " +
      "computer is still running the older files. Download the newest copy here — you always get the latest bytes.</p>" +
      '<div class="ewi-updbtns">' +
      '<button class="ewi-updbtn primary" id="ewiUpdFresh" type="button" ' +
      'aria-label="Download a fresh, version-stamped copy of the EWI Suite">' + DL_ICON +
      "Download a fresh copy</button>" +
      "</div>" +
      '<p class="ewi-updmeta" id="ewiUpdMeta" role="status" aria-live="polite"></p>' +
      '<p class="ewi-updhint">Each download is a new, version-stamped file (ewi-suite-&lt;version&gt;.zip), ' +
      "so it never collides with an older copy. Unzip it and it runs alongside — or in place of — your previous one.</p>" +
      "</div>";

    var anchor = document.getElementById("platforms");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor);
    else document.body.appendChild(sec);

    meta = document.getElementById("ewiUpdMeta");
    var vState = null;
    loadVersion().then(function (v) {
      vState = v;
      if (v && (v.version || v.bytes)) {
        var bits = [];
        if (v.version) bits.push("Build " + v.version);
        if (v.bytes) bits.push(fmtBytes(v.bytes));
        say(bits.join(" · "));
      }
    });

    document.getElementById("ewiUpdFresh").addEventListener("click", function () {
      freshCopy(vState);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { build(); buildRunHelp(); });
  } else { build(); buildRunHelp(); }
})();
