/* ===========================================================================
   EWI Suite — shared "Download the app" control.

   How the download resolves:
   - LOCAL_ZIP is the REAL, runnable engine bundle (downloads/ewi-suite.zip),
     built by build-ewi-suite-bundle.sh and committed to the repo so GitHub
     Pages serves it to EVERY visitor. The path is resolved relative to this
     script, so it works from any /product/ subpath and on both localhost and
     the public project-pages origin.
   - On click we trigger a genuine file download of the whole suite.
   - "It's all the same files": the whole suite ships in ONE bundle, so once a
     visitor has downloaded it from ANY product, the button is hidden on every
     other product (state is shared per-origin via localStorage) and replaced
     with a quiet "you already have it" note.
   =========================================================================== */
(function () {
  "use strict";

  // Resolve the bundle relative to THIS script (site root), so it works from
  // any /product/ subpath and on both localhost and project-pages origins.
  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || "";
  var LOCAL_ZIP = SCRIPT_SRC
    ? new URL("downloads/ewi-suite.zip", SCRIPT_SRC).href
    : "downloads/ewi-suite.zip";
  var STORAGE_KEY = "ewi-suite-downloaded"; // shared across all products (same origin)

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

  function downloadFile(url) {
    var a = document.createElement("a");
    a.href = url;
    a.download = "ewi-suite.zip"; // hint the browser to download rather than navigate
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    // Remove after a beat: yanking the anchor synchronously can abort the
    // download before the browser has committed to it.
    setTimeout(function () {
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 1500);
  }

  function triggerDownload() {
    // The bundle is committed and served on every host (localhost + public
    // GitHub Pages), so a single relative download works everywhere. Append a
    // cache-buster so a returning visitor always pulls the NEWEST bytes — the
    // fix for "I re-downloaded but the app still looks unchanged."
    var url = LOCAL_ZIP + (LOCAL_ZIP.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now();
    downloadFile(url);
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
      '<p class="ewi-dl-sub">One download \u00b7 every EWI engine \u00b7 runs entirely on your device, nothing in the cloud</p>';

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
