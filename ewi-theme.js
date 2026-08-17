/* ============================================================
   EWI Theme — one Apple-esque Light/Dark switch for the suite.
   • Sets <html data-theme> before first paint (no colour flash).
   • Remembers the choice in localStorage under one shared key,
     so a preference set on any product carries across all of them.
   • Falls back to the operating-system setting when nothing is saved.
   • Injects a small toggle in the top header lane (beside the app
     switcher) so it lives in the header on every product page — no
     page markup has to change. Pages with their own toggle can set
     window.EWI_THEME_NO_BUTTON = true before this script loads.
   ============================================================ */
(function () {
  "use strict";
  var root = document.documentElement;
  var KEY = "ewi-theme";
  var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function preferred() {
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (_) {}
    if (saved === "light" || saved === "dark") return saved;
    return (mq && mq.matches) ? "dark" : "light";
  }
  function setMode(mode) {
    root.setAttribute("data-theme", mode);
    var lbl = document.getElementById("ewiThemeLabel");
    if (lbl) lbl.textContent = mode === "dark" ? "Dark" : "Light";
  }

  // Apply immediately (documentElement exists during head parsing).
  setMode(preferred());

  function build() {
    if (window.EWI_THEME_NO_BUTTON) return;
    if (!document.body || document.getElementById("ewiThemeBtn")) return;
    var b = document.createElement("button");
    b.id = "ewiThemeBtn";
    b.type = "button";
    b.setAttribute("aria-label", "Toggle light or dark mode");
    b.innerHTML = '<span class="ewi-tdot"></span><span id="ewiThemeLabel"></span>';
    // Live in the top header lane, just left of the app-switcher button
    // (the switcher's button sits at right:14px and is 34px wide).
    b.style.cssText = [
      "position:fixed", "top:7px", "right:58px", "z-index:99999",
      "display:inline-flex", "align-items:center", "gap:7px",
      "height:34px", "padding:0 14px", "border-radius:100px",
      "border:1px solid rgba(128,128,128,.42)",
      "background:rgba(127,127,140,.16)", "-webkit-backdrop-filter:blur(12px)",
      "backdrop-filter:blur(12px)", "color:inherit",
      'font:13px/1 -apple-system,BlinkMacSystemFont,"SF Pro Text",Helvetica,Arial,sans-serif',
      "font-weight:600", "cursor:pointer", "transition:background .2s ease"
    ].join(";");
    function tint(on) { b.style.background = on ? "rgba(127,127,140,.28)" : "rgba(127,127,140,.16)"; }
    b.addEventListener("mouseenter", function () { tint(true); });
    b.addEventListener("mouseleave", function () { tint(false); });
    b.addEventListener("focus", function () { tint(true); });
    b.addEventListener("blur", function () { tint(false); });
    var dot = b.querySelector(".ewi-tdot");
    dot.style.cssText = "width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,#7ec8ff,#ffffff);box-shadow:0 0 0 1px rgba(126,200,255,.5)";
    b.addEventListener("click", function () {
      var next = (root.getAttribute("data-theme") === "dark") ? "light" : "dark";
      try { localStorage.setItem(KEY, next); } catch (_) {}
      setMode(next);
    });
    document.body.appendChild(b);
    setMode(root.getAttribute("data-theme") || preferred());
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();

  if (mq && mq.addEventListener) mq.addEventListener("change", function () {
    var saved = null; try { saved = localStorage.getItem(KEY); } catch (_) {}
    if (saved !== "light" && saved !== "dark") setMode(mq.matches ? "dark" : "light");
  });
})();
