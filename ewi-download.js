/* ===========================================================================
   EWI Suite — shared "Download the app" control.

   Design goals (IP-safe, Ollama-style):
   - The suite's engines are DISTRIBUTED AS A SIGNED, PACKAGED ARTIFACT
     (an installer / binary / release asset) — never as source. Set the single
     DOWNLOAD_URL below to that artifact (a .dmg / .pkg / .zip direct link) or
     to the official Releases page. No proprietary code is ever exposed by this
     page, because this page only *links* to the packaged download.
   - "It's all the same files": the whole suite ships in ONE bundle, so once a
     visitor has downloaded it from ANY product, the button is hidden on every
     other product (state is shared per-origin via localStorage) and replaced
     with a quiet "you already have it" note.

   To wire a real one-click download later, point DOWNLOAD_URL at a direct file
   (e.g. https://github.com/EngineeredWithIfe/EWI-Suite/releases/latest/download/EWI-Suite.dmg)
   and this script will trigger a genuine file download automatically.
   =========================================================================== */
(function () {
  "use strict";

  // --- Single source of truth: where the packaged (non-source) app lives. ---
  var DOWNLOAD_URL = "https://github.com/EngineeredWithIfe/EWI-Suite/releases";
  var STORAGE_KEY = "ewi-suite-downloaded"; // shared across all products (same origin)

  // A direct file link (has a file extension) => real download; else open page.
  var IS_DIRECT_FILE = /\.(dmg|pkg|zip|tar\.gz|tgz|exe|msi|appimage)(\?|#|$)/i.test(DOWNLOAD_URL);

  function injectStyles() {
    if (document.getElementById("ewi-dl-styles")) return;
    var s = document.createElement("style");
    s.id = "ewi-dl-styles";
    s.textContent =
      ".ewi-dl-wrap{margin:24px 0 2px;text-align:center}" +
      ".ewi-dl{appearance:none;border:0;cursor:pointer;font:inherit;font-weight:600;" +
      "font-size:15px;color:#fff;background:var(--blue,#0071e3);padding:12px 22px;" +
      "border-radius:12px;display:inline-flex;align-items:center;gap:9px;" +
      "box-shadow:0 1px 2px rgba(0,0,0,.12);transition:transform .15s ease,filter .15s ease}" +
      ".ewi-dl:hover{filter:brightness(1.07);transform:translateY(-1px)}" +
      ".ewi-dl:active{transform:translateY(0)}" +
      ".ewi-dl:focus-visible{outline:2px solid var(--blue,#0071e3);outline-offset:3px}" +
      ".ewi-dl svg{width:16px;height:16px;flex:none}" +
      ".ewi-dl-sub{margin:9px 0 0;font-size:12.5px;color:var(--sub,#6e6e73)}" +
      ".ewi-dl-note{margin:20px 0 2px;font-size:13.5px;color:var(--sub,#6e6e73);text-align:center}" +
      ".ewi-dl-note b{color:#1a9d4b}";
    document.head.appendChild(s);
  }

  function alreadyHave() {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch (e) { return false; }
  }
  function markHave() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch (e) {}
  }

  function haveNote() {
    var p = document.createElement("p");
    p.className = "ewi-dl-note";
    p.innerHTML =
      "<b>\u2713</b> You already have the EWI Suite files \u2014 just run the command below to launch this engine.";
    return p;
  }

  function triggerDownload() {
    if (IS_DIRECT_FILE) {
      var a = document.createElement("a");
      a.href = DOWNLOAD_URL;
      a.download = ""; // hint the browser to download rather than navigate
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      window.open(DOWNLOAD_URL, "_blank", "noopener");
    }
  }

  function build() {
    var card = document.querySelector(".card");
    if (!card) return; // only render on launcher pages that have a card

    injectStyles();

    // Already downloaded on a previous product? Show the quiet note instead.
    if (alreadyHave()) {
      var det = card.querySelector("details");
      var note = haveNote();
      if (det) card.insertBefore(note, det); else card.appendChild(note);
      return;
    }

    var wrap = document.createElement("div");
    wrap.className = "ewi-dl-wrap";
    wrap.innerHTML =
      '<button class="ewi-dl" type="button" aria-label="Download the EWI Suite app">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M12 3v12"/><path d="m7 12 5 5 5-5"/><path d="M5 21h14"/></svg>' +
      "Download the EWI Suite app</button>" +
      '<p class="ewi-dl-sub">One signed download installs the engines for every EWI product \u00b7 no source exposed</p>';

    var btn = wrap.querySelector(".ewi-dl");
    btn.addEventListener("click", function () {
      triggerDownload();
      markHave();
      var note = haveNote();
      if (wrap.parentNode) wrap.parentNode.replaceChild(note, wrap);
    });

    // Place it just above the "Run the engine" disclosure.
    var details = card.querySelector("details");
    if (details) card.insertBefore(wrap, details);
    else {
      var p = card.querySelector("p");
      if (p && p.nextSibling) card.insertBefore(wrap, p.nextSibling);
      else card.appendChild(wrap);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
