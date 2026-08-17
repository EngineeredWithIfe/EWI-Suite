/* EWI App Switcher — Engineered With Ife (public build)
 * Base-path aware: derives the site root from its own <script src>, so the
 * Home pill and app grid resolve correctly at engineeredwithife.github.io/<repo>/
 * or at any custom domain, with no hard-coded host. Graceful degradation:
 * if this file is unreachable the product renders without the switcher.
 */
(function () {
  if (window.__ewiSwitcher) return; window.__ewiSwitcher = true;

  // Resolve BASE = the directory that holds ewi-switcher.js (the site root).
  function selfSrc() {
    if (document.currentScript && document.currentScript.src) return document.currentScript.src;
    var s = document.getElementsByTagName("script");
    for (var i = s.length - 1; i >= 0; i--)
      if (s[i].src && /ewi-switcher\.js(\?|$)/.test(s[i].src)) return s[i].src;
    return location.href;
  }
  var SELF = selfSrc();
  var BASE = SELF.replace(/[?#].*$/, "").replace(/[^/]*$/, "");   // strip query + filename -> dir
  // Standalone mode: a single engine served on its OWN localhost port (e.g. a
  // downloaded bundle running `python3 serve.py`). Its sibling apps and the
  // suite home don't exist on that port, so links resolve to the public site.
  var STANDALONE = /[?&]standalone=1\b/.test(SELF);
  var PUBLIC_HOME = "https://engineeredwithife.github.io/EWI-Suite/";
  var LINK_BASE = STANDALONE ? PUBLIC_HOME : BASE;
  function u(path) { return LINK_BASE + path; }          // site-relative URL

  var APPS = [
    { name: "EWI Home",       url: u(""),               k: "EW", c: "#1d1d1f" },
    { name: "EWI ClipForge",  url: u("clipforge/"),     k: "Cf", c: "#f56300" },
    { name: "EWI Reel",       url: u("reel/"),          k: "Re", c: "#ff2d78" },
    { name: "EWI Mosaic",      url: u("grid/"),          k: "Gr", c: "#12b886" },
    { name: "EWI Cosmos",     url: u("cosmos/"),        k: "Co", c: "#7c5cff" },
    { name: "EWI Numerica",    url: u("matrix/"),        k: "Mx", c: "#f97316" },
    { name: "EWI Foundry",     url: u("forge/"),         k: "Fo", c: "#e87d0d" },
    { name: "EWI Splice",      url: u("cut/"),           k: "Ct", c: "#00d1c7" },
    { name: "EWI Pulse",       url: u("pulse/"),         k: "Pu", c: "#ff375f" },
    { name: "EWI Decks",       url: u("dj/"),            k: "DJ", c: "#7c3aed" },
    { name: "EWI Statica",     url: u("stat/"),          k: "St", c: "#4c8dff" },
    { name: "EWI Browser Cloud",  url: u("browser-cloud/"), k: "Bc", c: "#0071e3" },
    { name: "EWI Flow Dictation", url: u("flow-dictation/"),k: "Fd", c: "#8a3ffc" },
    { name: "EWI Cortex",      url: u("mind/"),          k: "Mi", c: "#e30000" },
    { name: "EWI Sight",       url: u("lens/"),          k: "Le", c: "#008009" },
    { name: "EWI Tutor",       url: u("scholar/"),       k: "Sc", c: "#0d9488" },
    { name: "NAVLINQ",        url: "https://apps.apple.com/us/app/navlinq/id6769218514", k: "Nv", c: "#008009" }
  ];

  var HOME_URL = u("");
  // Home = the page whose directory equals BASE (root index). A standalone
  // engine is never the home page, so it always shows the Home pill.
  var pageDir = location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  var IS_HOME = STANDALONE ? false : (pageDir === BASE);
  var LANE = 48;

  var bodyBg = "", dark = false;
  try {
    bodyBg = getComputedStyle(document.body).backgroundColor || "";
    var rgb = bodyBg.match(/\d+(\.\d+)?/g);
    if (rgb && rgb.length >= 3)
      dark = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) < 128;
  } catch (e) {}
  var laneBg = dark ? "rgba(18,18,20,.82)" : "rgba(255,255,255,.85)";
  var laneLine = dark ? "#3a3a3c" : "#d2d2d7";
  var ink = dark ? "#f5f5f7" : "#1d1d1f";
  var pillBg = dark ? "rgba(44,44,46,.9)" : "rgba(255,255,255,.9)";
  var pillHover = dark ? "#3a3a3c" : "#f5f5f7";

  var css = document.createElement("style");
  css.textContent =
    (IS_HOME ? "" :
      "#ewi-lane{position:fixed;top:0;left:0;right:0;height:" + LANE + "px;z-index:99990;background:" + laneBg + ";backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid " + laneLine + "}" +
      "body{padding-top:" + LANE + "px !important}") +
    "#ewi-sw{position:fixed;top:7px;right:14px;z-index:99999;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif}" +
    "#ewi-sw-btn{width:34px;height:34px;border-radius:50%;border:1px solid " + laneLine + ";background:" + pillBg + ";cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}" +
    "#ewi-sw-btn:hover{background:" + pillHover + "}" +
    "#ewi-sw-btn svg{display:block}" +
    "#ewi-sw-panel{position:absolute;top:42px;right:0;width:264px;background:rgba(255,255,255,.97);backdrop-filter:saturate(180%) blur(20px);border:1px solid #d2d2d7;border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.14);padding:14px;display:none;grid-template-columns:repeat(3,1fr);gap:6px}" +
    "#ewi-sw-panel.open{display:grid}" +
    "#ewi-sw-panel a{display:flex;flex-direction:column;align-items:center;gap:6px;padding:10px 4px;border-radius:12px;text-decoration:none;color:#1d1d1f;font-size:11.5px;text-align:center;line-height:1.25}" +
    "#ewi-sw-panel a:hover{background:#f5f5f7}" +
    "#ewi-sw-panel .ic{width:34px;height:34px;border-radius:9px;color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;letter-spacing:-.02em}" +
    "#ewi-sw-foot{grid-column:1/-1;text-align:center;font-size:10.5px;color:#6e6e73;padding-top:6px;border-top:1px solid #e8e8ed;margin-top:4px}" +
    "#ewi-home{position:fixed;top:7px;left:14px;z-index:99999;display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 14px 0 10px;border-radius:100px;border:1px solid " + laneLine + ";background:" + pillBg + ";color:" + ink + ";font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;letter-spacing:-.01em}" +
    "#ewi-home:hover{background:" + pillHover + "}" +
    "#ewi-home .hic{width:22px;height:22px;border-radius:6px;background:" + (dark ? "#f5f5f7" : "#1d1d1f") + ";color:" + (dark ? "#1d1d1f" : "#fff") + ";font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;letter-spacing:-.03em}" +
    // Responsive: tablets / small laptops tighten the pill; phones collapse the
    // "EWI Home" wordmark to an icon-only circle so the header controls never
    // overlap on small screens. Positioning of the theme + run-locally controls
    // is recomputed from live widths by ewi-runhelp.js, so this stays in sync.
    "@media (max-width:900px){#ewi-home{font-size:12px;padding:0 11px 0 8px;gap:6px}}" +
    "@media (max-width:560px){#ewi-home{font-size:0;gap:0;width:34px;padding:0;justify-content:center}#ewi-home .hic{font-size:11px}}" +
    "@media (pointer:coarse){#ewi-sw-panel a{padding:12px 4px}}";
  document.head.appendChild(css);

  if (!IS_HOME) {
    var lane = document.createElement("div");
    lane.id = "ewi-lane"; lane.setAttribute("aria-hidden", "true");
    document.body.appendChild(lane);
  }

  function isViewportScroller(el) {
    for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      var o = getComputedStyle(p);
      if (/(auto|scroll|overlay)/.test(o.overflowY + " " + o.overflow)) return false;
    }
    return true;
  }
  if (!IS_HOME) try {
    var all = document.querySelectorAll("body *");
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      if (el.id && el.id.indexOf("ewi-") === 0) continue;
      var st = getComputedStyle(el);
      if (st.position !== "sticky" && st.position !== "fixed") continue;
      var t = parseFloat(st.top);
      if (isNaN(t) || t > 200) continue;
      if (st.position === "sticky" && !isViewportScroller(el)) continue;
      el.style.top = (t + LANE) + "px";
    }
  } catch (e) {}

  var root = document.createElement("div");
  root.id = "ewi-sw";
  var grid = "";
  for (var i = 0; i < APPS.length; i++) {
    var a = APPS[i];
    grid += '<a href="' + a.url + '"' + (/^https?:\/\//.test(a.url) && a.url.indexOf(location.origin) !== 0 ? ' target="_blank" rel="noopener"' : "") + ">" +
            '<span class="ic" style="background:' + a.c + '">' + a.k + "</span>" + a.name + "</a>";
  }
  var dots = "";
  for (var r = 0; r < 3; r++) for (var q = 0; q < 3; q++)
    dots += '<circle cx="' + (4 + q * 6) + '" cy="' + (4 + r * 6) + '" r="1.7" fill="#1d1d1f"/>';
  root.innerHTML =
    '<button id="ewi-sw-btn" aria-label="EWI apps" aria-expanded="false" title="EWI apps">' +
    '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">' + dots + "</svg></button>" +
    '<div id="ewi-sw-panel" role="menu" aria-label="EWI family of apps">' + grid +
    '<div id="ewi-sw-foot">EWI \u2014 Engineered With Ife \u00b7 \u201cIfe\u201d [Yoruba] = \u201cLove\u201d [English]</div></div>';
  document.body.appendChild(root);

  if (!IS_HOME) {
    var home = document.createElement("a");
    home.id = "ewi-home"; home.href = HOME_URL; home.title = "EWI Home";
    home.setAttribute("aria-label", "EWI Home");
    home.innerHTML = '<span class="hic">EW</span>EWI Home';
    document.body.appendChild(home);
  }

  var btn = document.getElementById("ewi-sw-btn"), panel = document.getElementById("ewi-sw-panel");
  btn.addEventListener("click", function (e) {
    e.stopPropagation();
    var open = panel.classList.toggle("open");
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  });
  document.addEventListener("click", function () { panel.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { panel.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); } });
})();
