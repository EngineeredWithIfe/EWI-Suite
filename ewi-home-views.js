/* ===========================================================================
   EWI Suite — Home view selector (Grid · List · Radial).

   • Grid   — the classic card grid (unchanged).
   • List   — a vertical list you can reorder by LONG-HOLDING a row, then
              dragging it. Order is saved to this device.
   • Radial — a 16-sector wheel (a regular hexadecagon: 16 equal 22.5° slices).
              Product names stay UPRIGHT in every slice. Drag a slice onto
              another and the wheel flows the others around it — a fluid,
              Apple-esque motion. Order is saved to this device.

   Zero dependencies. Progressive enhancement: if anything is unavailable the
   original grid remains fully usable. Respects prefers-reduced-motion and is
   keyboard + screen-reader friendly (List is the accessible reorder path).
   =========================================================================== */
(function () {
  "use strict";
  if (window.__ewiHomeViews) return; window.__ewiHomeViews = true;

  var GRID = document.getElementById("products");
  if (!GRID) return;

  var ORDER_KEY = "ewi-home-order", VIEW_KEY = "ewi-home-view";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* -------- read products from the existing DOM (single source of truth) ---- */
  var items = [];
  Array.prototype.forEach.call(GRID.querySelectorAll(".tile"), function (t) {
    var h2 = t.querySelector("h2"), k = t.querySelector(".k"), p = t.querySelector("p");
    var name = h2 ? h2.textContent.trim() : "";
    if (!name) return;
    var color = "#0071e3";
    try { color = getComputedStyle(k || t).color || color; } catch (e) {}
    items.push({
      name: name,
      href: t.getAttribute("data-href") || (t.querySelector("a") && t.querySelector("a").getAttribute("href")) || "#",
      target: t.getAttribute("data-target") || "",
      kicker: k ? k.textContent.trim() : "",
      blurb: p ? p.textContent.trim() : "",
      color: color,
      initials: initials(name)
    });
  });
  if (items.length < 2) return;

  function initials(name) {
    var w = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
    if (!w.length) return "EW";
    if (w.length === 1) return w[0].slice(0, 2).replace(/^\w/, function (c) { return c.toUpperCase(); });
    return (w[0][0] + w[1][0]).toUpperCase();
  }

  /* -------- persisted custom order (by product name) ------------------------ */
  function loadOrder() {
    try {
      var saved = JSON.parse(localStorage.getItem(ORDER_KEY) || "null");
      if (!Array.isArray(saved)) return items.slice();
      var byName = {}; items.forEach(function (it) { byName[it.name] = it; });
      var out = [];
      saved.forEach(function (n) { if (byName[n]) { out.push(byName[n]); delete byName[n]; } });
      items.forEach(function (it) { if (byName[it.name]) out.push(it); }); // append any new products
      return out;
    } catch (e) { return items.slice(); }
  }
  function saveOrder(list) {
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(list.map(function (i) { return i.name; }))); } catch (e) {}
  }
  var order = loadOrder();

  function go(it) {
    if (!it || it.href === "#") return;
    if (it.target === "_blank") window.open(it.href, "_blank", "noopener");
    else location.href = it.href;
  }

  /* -------- styles ---------------------------------------------------------- */
  var css = document.createElement("style");
  css.textContent =
    "#ewi-viewbar{display:flex;justify-content:center;margin:0 auto 18px;gap:0}" +
    "#ewi-viewseg{display:inline-flex;gap:4px;background:var(--panel,#f1f1f4);border:1px solid var(--hair,#e6e6eb);" +
    "padding:4px;border-radius:13px}" +
    "#ewi-viewseg button{appearance:none;border:none;background:transparent;color:var(--sub,#6e6e73);font:inherit;" +
    "font-size:13px;font-weight:600;padding:8px 16px;border-radius:9px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;min-height:38px}" +
    "#ewi-viewseg button.on{background:var(--bg,#fff);color:var(--ink,#0b0b0c);box-shadow:0 1px 4px rgba(0,0,0,.12)}" +
    "#ewi-viewseg button:focus-visible{outline:2px solid var(--accent,#0071e3);outline-offset:2px}" +
    "#ewi-viewseg svg{width:15px;height:15px}" +
    /* list */
    ".ewi-list{list-style:none;margin:0 auto;padding:0;max-width:720px;display:flex;flex-direction:column;gap:10px}" +
    ".ewi-row{display:flex;align-items:center;gap:14px;padding:14px 16px;border:1px solid var(--hair,#e6e6eb);" +
    "border-radius:16px;background:var(--panel,#fff);cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:pan-y;" +
    (reduce ? "" : "transition:transform .28s cubic-bezier(.2,.7,.2,1),box-shadow .2s,opacity .2s;") + "position:relative}" +
    ".ewi-row:hover{border-color:var(--accent,#0071e3)}" +
    ".ewi-row.armed{box-shadow:0 0 0 2px var(--accent,#0071e3) inset}" +
    ".ewi-row.dragging{z-index:5;box-shadow:0 16px 40px rgba(0,0,0,.24);cursor:grabbing;opacity:.98;transition:none}" +
    ".ewi-row .grip{width:22px;color:var(--sub,#9a9aa0);flex:none;display:grid;place-items:center;cursor:grab}" +
    ".ewi-row .badge{width:40px;height:40px;border-radius:11px;flex:none;display:grid;place-items:center;color:#fff;font-weight:800;font-size:14px}" +
    ".ewi-row .meta{min-width:0}" +
    ".ewi-row .meta h3{margin:0;font-size:15px;letter-spacing:-.01em}" +
    ".ewi-row .meta p{margin:2px 0 0;font-size:12.5px;color:var(--sub,#6e6e73);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52ch}" +
    ".ewi-row .chev{margin-left:auto;color:var(--sub,#9a9aa0);flex:none}" +
    ".ewi-hint{max-width:720px;margin:10px auto 0;text-align:center;font-size:12px;color:var(--sub,#6e6e73)}" +
    /* radial */
    "#ewi-radialwrap{display:flex;flex-direction:column;align-items:center}" +
    "#ewi-radial{touch-action:none;max-width:100%;height:auto;user-select:none;-webkit-user-select:none}" +
    "#ewi-radial .slice{cursor:grab}" +
    "#ewi-radial .slice.dragging{cursor:grabbing}" +
    "#ewi-radial .slice .wedge{" + (reduce ? "" : "transition:transform .12s ease;") + "}" +
    "#ewi-radial .slot{" + (reduce ? "" : "transition:transform .42s cubic-bezier(.22,.61,.24,1);") + "}" +
    "#ewi-radial .lbl{font:600 13px -apple-system,BlinkMacSystemFont,'SF Pro Text',Helvetica,Arial,sans-serif;fill:#fff;pointer-events:none}" +
    "#ewi-radial .hub{fill:var(--bg,#fff)}" +
    "#ewi-radial .hubtx{font:700 13px -apple-system,BlinkMacSystemFont,'SF Pro Text',Helvetica,Arial,sans-serif;fill:var(--ink,#1d1d1f);text-anchor:middle}" +
    "#ewi-radial .hubsub{font:500 9.5px -apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif;fill:var(--sub,#8a8a90);text-anchor:middle}" +
    "@media (max-width:520px){.ewi-row .meta p{display:none}}";
  document.head.appendChild(css);

  /* -------- view selector bar ---------------------------------------------- */
  var bar = document.createElement("div"); bar.id = "ewi-viewbar";
  bar.innerHTML =
    '<div id="ewi-viewseg" role="tablist" aria-label="Home layout">' +
      '<button data-v="grid" role="tab"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="1" width="6" height="6" rx="1.4"/><rect x="9" y="1" width="6" height="6" rx="1.4"/><rect x="1" y="9" width="6" height="6" rx="1.4"/><rect x="9" y="9" width="6" height="6" rx="1.4"/></svg>Grid</button>' +
      '<button data-v="list" role="tab"><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="2" width="14" height="2.4" rx="1.2"/><rect x="1" y="6.8" width="14" height="2.4" rx="1.2"/><rect x="1" y="11.6" width="14" height="2.4" rx="1.2"/></svg>List</button>' +
      '<button data-v="radial" role="tab"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="8" cy="8" r="6.4"/><path d="M8 1.6V8l4.5 4.5"/></svg>Radial</button>' +
    '</div>';
  GRID.parentNode.insertBefore(bar, GRID);

  var listEl = null, radialWrap = null, hintEl = null, currentView = "grid";

  function setView(v, save) {
    currentView = v;
    Array.prototype.forEach.call(bar.querySelectorAll("button"), function (b) {
      var on = b.getAttribute("data-v") === v;
      b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false");
    });
    GRID.style.display = v === "grid" ? "" : "none";
    if (listEl) listEl.style.display = v === "list" ? "" : "none";
    if (radialWrap) radialWrap.style.display = v === "radial" ? "" : "none";
    if (hintEl) hintEl.style.display = (v === "list" || v === "radial") ? "" : "none";
    if (v === "list") buildList();
    if (v === "radial") buildRadial();
    if (hintEl) hintEl.textContent = v === "list"
      ? "Press and hold a row, then drag to reorder. Your order is saved on this device."
      : (v === "radial" ? "Drag a slice onto another to rearrange the wheel. Your order is saved on this device." : "");
    if (save) { try { localStorage.setItem(VIEW_KEY, v); } catch (e) {} }
  }
  bar.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-v]"); if (b) setView(b.getAttribute("data-v"), true);
  });

  hintEl = document.createElement("div"); hintEl.className = "ewi-hint"; hintEl.setAttribute("aria-live", "polite");
  GRID.parentNode.insertBefore(hintEl, GRID.nextSibling);

  /* ======================= LIST VIEW (long-hold drag) ====================== */
  function buildList() {
    if (!listEl) {
      listEl = document.createElement("ul"); listEl.className = "ewi-list";
      listEl.setAttribute("aria-label", "EWI products — press and hold a row to reorder");
      GRID.parentNode.insertBefore(listEl, GRID.nextSibling);
    }
    renderList();
  }
  var chev = '<svg class="chev" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>';
  var grip = '<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true"><circle cx="4" cy="3" r="1.3"/><circle cx="10" cy="3" r="1.3"/><circle cx="4" cy="7" r="1.3"/><circle cx="10" cy="7" r="1.3"/><circle cx="4" cy="11" r="1.3"/><circle cx="10" cy="11" r="1.3"/></svg>';
  function renderList() {
    listEl.innerHTML = "";
    order.forEach(function (it) {
      var li = document.createElement("li");
      li.className = "ewi-row"; li.setAttribute("data-name", it.name);
      li.setAttribute("tabindex", "0"); li.setAttribute("role", "button");
      li.setAttribute("aria-label", it.name + (it.kicker ? " — " + it.kicker : ""));
      li.innerHTML =
        '<span class="grip" aria-hidden="true">' + grip + "</span>" +
        '<span class="badge" style="background:' + it.color + '">' + it.initials + "</span>" +
        '<span class="meta"><h3>' + escapeHtml(it.name) + "</h3><p>" + escapeHtml(it.blurb || it.kicker) + "</p></span>" +
        chev;
      listEl.appendChild(li);
    });
    wireListDrag();
  }

  function wireListDrag() {
    var holdTimer = null, dragging = null, startY = 0, armed = null, downXY = null, dragMoved = false;

    function siblings() { return Array.prototype.slice.call(listEl.children).filter(function (n) { return n !== dragging; }); }

    listEl.querySelectorAll(".ewi-row").forEach(function (li) {
      li.addEventListener("pointerdown", function (e) {
        if (e.button != null && e.button !== 0) return;
        armed = li; li.classList.add("armed"); downXY = { x: e.clientX, y: e.clientY };
        holdTimer = setTimeout(function () { beginDrag(li, e); }, 300);
      });
      li.addEventListener("pointermove", function (e) {
        // moving before the hold fires = a scroll/tap intent → cancel arming
        if (!dragging && armed === li && downXY && Math.abs(e.clientY - downXY.y) > 10) {
          clearTimeout(holdTimer); li.classList.remove("armed"); armed = null;
        }
      });
      li.addEventListener("pointerup", function () {
        if (armed === li && !dragging) { clearTimeout(holdTimer); li.classList.remove("armed"); go(byName(li)); }
        armed = null;
      });
      li.addEventListener("pointercancel", function () { clearTimeout(holdTimer); li.classList.remove("armed"); armed = null; });
      // keyboard: Enter/Space opens; Alt+Arrows reorder
      li.addEventListener("keydown", function (e) {
        var idx = order.findIndex(function (x) { return x.name === li.getAttribute("data-name"); });
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(order[idx]); return; }
        if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          var j = e.key === "ArrowUp" ? idx - 1 : idx + 1;
          if (j < 0 || j >= order.length) return;
          var m = order.splice(idx, 1)[0]; order.splice(j, 0, m); saveOrder(order); renderList();
          var again = listEl.querySelector('.ewi-row[data-name="' + cssEsc(m.name) + '"]'); if (again) again.focus();
        }
      });
    });

    function byName(li) { var n = li.getAttribute("data-name"); return order.find(function (x) { return x.name === n; }); }

    function beginDrag(li, e) {
      dragging = li; dragMoved = false; li.classList.remove("armed"); li.classList.add("dragging");
      var r = li.getBoundingClientRect(); startY = e.clientY; li.style.width = r.width + "px";
      li.setPointerCapture && li.setPointerCapture(e.pointerId);
      document.body.style.cursor = "grabbing";
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    }

    function onMove(e) {
      if (!dragging) return;
      dragMoved = true;
      dragging.style.transform = "translateY(" + (e.clientY - startY) + "px) scale(1.02)";
      var dc = dragging.getBoundingClientRect(), center = dc.top + dc.height / 2;
      // pick the sibling this row should sit AFTER (last whose midpoint is above center)
      var sibs = siblings(), after = null;
      sibs.forEach(function (sib) {
        var r = sib.getBoundingClientRect();
        if (center > r.top + r.height / 2) after = sib;
      });
      var ref = after ? after.nextSibling : listEl.firstChild;
      if (ref === dragging) return;
      // FLIP: capture sibling positions, move node, animate siblings from old→new
      var pre = {};
      sibs.forEach(function (s) { pre[s.getAttribute("data-name")] = s.getBoundingClientRect().top; });
      var firstTop = dragging.getBoundingClientRect().top;
      listEl.insertBefore(dragging, ref);
      var lastTop = dragging.getBoundingClientRect().top;
      startY += (lastTop - firstTop);                 // keep dragged row under the pointer
      dragging.style.transform = "translateY(" + (e.clientY - startY) + "px) scale(1.02)";
      sibs.forEach(function (s) {
        var was = pre[s.getAttribute("data-name")]; if (was == null) return;
        var now = s.getBoundingClientRect().top, d = was - now;
        if (!d || reduce) return;
        s.style.transition = "none"; s.style.transform = "translateY(" + d + "px)";
        requestAnimationFrame(function () {
          s.style.transition = ""; s.style.transform = "";
        });
      });
    }

    function onUp() {
      window.removeEventListener("pointermove", onMove);
      clearTimeout(holdTimer);
      document.body.style.cursor = "";
      if (dragging) {
        var kept = dragging;
        // sync the order array to the new DOM order
        order = Array.prototype.map.call(listEl.children, function (n) {
          return order.find(function (x) { return x.name === n.getAttribute("data-name"); });
        }).filter(Boolean);
        kept.classList.remove("dragging"); kept.style.transform = ""; kept.style.width = "";
        saveOrder(order);
        if (!dragMoved) go(byName(kept));
      }
      dragging = null;
    }
  }

  /* ========================= RADIAL VIEW (hexadecagon) ===================== */
  var SVGNS = "http://www.w3.org/2000/svg";
  var R = { size: 560, cx: 280, cy: 280, outer: 262, inner: 96, N: 16 };
  var radialEl = null;

  function buildRadial() {
    if (!radialWrap) {
      radialWrap = document.createElement("div"); radialWrap.id = "ewi-radialwrap";
      GRID.parentNode.insertBefore(radialWrap, GRID.nextSibling);
    }
    renderRadial();
  }

  // A wedge centered on the top (pointing up), spanning ±(180/N)°, as a donut sector.
  function topWedgePath() {
    var half = Math.PI / R.N;               // half sector angle
    var a0 = -Math.PI / 2 - half, a1 = -Math.PI / 2 + half;
    var ox0 = R.cx + R.outer * Math.cos(a0), oy0 = R.cy + R.outer * Math.sin(a0);
    var ox1 = R.cx + R.outer * Math.cos(a1), oy1 = R.cy + R.outer * Math.sin(a1);
    var ix1 = R.cx + R.inner * Math.cos(a1), iy1 = R.cy + R.inner * Math.sin(a1);
    var ix0 = R.cx + R.inner * Math.cos(a0), iy0 = R.cy + R.inner * Math.sin(a0);
    return "M" + ox0 + " " + oy0 +
           " A" + R.outer + " " + R.outer + " 0 0 1 " + ox1 + " " + oy1 +
           " L" + ix1 + " " + iy1 +
           " A" + R.inner + " " + R.inner + " 0 0 0 " + ix0 + " " + iy0 + " Z";
  }
  function slotDeg(i) { return i * (360 / R.N); }   // slot 0 = top, clockwise

  function renderRadial() {
    if (!radialEl) {
      radialEl = document.createElementNS(SVGNS, "svg");
      radialEl.setAttribute("id", "ewi-radial");
      radialEl.setAttribute("viewBox", "0 0 " + R.size + " " + R.size);
      radialEl.setAttribute("width", R.size); radialEl.setAttribute("height", R.size);
      radialEl.setAttribute("role", "group");
      radialEl.setAttribute("aria-label", "EWI products wheel — drag a slice to rearrange");
      radialWrap.appendChild(radialEl);
    }
    radialEl.textContent = "";
    var wedge = topWedgePath();
    var labelR = (R.outer + R.inner) / 2 + 6;

    order.forEach(function (it, i) {
      var g = document.createElementNS(SVGNS, "g");
      g.setAttribute("class", "slot slice");
      g.setAttribute("data-name", it.name);
      g.setAttribute("transform", "rotate(" + slotDeg(i) + " " + R.cx + " " + R.cy + ")");
      g.style.cursor = "grab";

      var path = document.createElementNS(SVGNS, "path");
      path.setAttribute("class", "wedge");
      path.setAttribute("d", wedge);
      path.setAttribute("fill", it.color);
      path.setAttribute("stroke", "var(--bg,#fff)");
      path.setAttribute("stroke-width", "3");
      g.appendChild(path);

      // Label: placed at the top mid-band, then COUNTER-rotated so it stays upright.
      var lg = document.createElementNS(SVGNS, "g");
      lg.setAttribute("transform",
        "translate(" + R.cx + " " + (R.cy - labelR) + ") rotate(" + (-slotDeg(i)) + ")");
      var lines = wrapLabel(it.name);
      lines.forEach(function (ln, li2) {
        var tx = document.createElementNS(SVGNS, "text");
        tx.setAttribute("class", "lbl");
        tx.setAttribute("text-anchor", "middle");
        tx.setAttribute("y", (li2 - (lines.length - 1) / 2) * 14);
        tx.textContent = ln;
        lg.appendChild(tx);
      });
      g.appendChild(lg);
      radialEl.appendChild(g);
    });

    // hub
    var hub = document.createElementNS(SVGNS, "circle");
    hub.setAttribute("class", "hub"); hub.setAttribute("cx", R.cx); hub.setAttribute("cy", R.cy);
    hub.setAttribute("r", R.inner - 6); hub.setAttribute("stroke", "var(--hair,#e6e6eb)"); hub.setAttribute("stroke-width", "1.5");
    radialEl.appendChild(hub);
    var ht = document.createElementNS(SVGNS, "text");
    ht.setAttribute("class", "hubtx"); ht.setAttribute("x", R.cx); ht.setAttribute("y", R.cy - 2); ht.textContent = "EWI";
    radialEl.appendChild(ht);
    var hs = document.createElementNS(SVGNS, "text");
    hs.setAttribute("class", "hubsub"); hs.setAttribute("x", R.cx); hs.setAttribute("y", R.cy + 14); hs.textContent = "drag to arrange";
    radialEl.appendChild(hs);

    wireRadialDrag();
  }

  function wrapLabel(name) {
    var parts = name.split(" ").filter(Boolean);
    if (parts.length === 1) return [name];               // single word stays on one line
    if (parts.length === 2) return [parts[0], parts[1]]; // e.g. "EWI Grid" -> EWI / Grid
    return [parts[0], parts.slice(1).join(" ")];         // 3+ words: first, then the rest
  }

  function wireRadialDrag() {
    var dragging = null, dragName = null, startAng = 0, moved = false, downXY = null;

    function angleAt(e) {
      var rect = radialEl.getBoundingClientRect();
      var scale = R.size / rect.width;
      var x = (e.clientX - rect.left) * scale - R.cx;
      var y = (e.clientY - rect.top) * scale - R.cy;
      var deg = Math.atan2(y, x) * 180 / Math.PI + 90; // 0 at top, clockwise
      return (deg % 360 + 360) % 360;
    }
    function slotFromAngle(deg) {
      return ((Math.round(deg / (360 / R.N)) % R.N) + R.N) % R.N;
    }

    Array.prototype.forEach.call(radialEl.querySelectorAll(".slice"), function (g) {
      g.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        dragging = g; dragName = g.getAttribute("data-name"); moved = false;
        downXY = { x: e.clientX, y: e.clientY };
        startAng = angleAt(e);
        g.classList.add("dragging"); g.style.transition = "none";
        var wedge = g.querySelector(".wedge"); if (wedge) wedge.setAttribute("transform-origin", R.cx + "px " + R.cy + "px");
        radialEl.setPointerCapture && radialEl.setPointerCapture(e.pointerId);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp, { once: true });
      });
    });

    function onMove(e) {
      if (!dragging) return;
      var d = Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y);
      if (d > 6) moved = true;
      var deg = angleAt(e);
      // make the dragged slice follow the pointer angle live
      dragging.setAttribute("transform", "rotate(" + deg + " " + R.cx + " " + R.cy + ")");
      var curIdx = order.findIndex(function (x) { return x.name === dragName; });
      var target = slotFromAngle(deg);
      if (target !== curIdx) {
        var m = order.splice(curIdx, 1)[0];
        order.splice(target, 0, m);
        // re-render the OTHERS to their new slots (they transition = liquid flow);
        // keep dragged element under the pointer.
        renderRadialKeepDragging(dragName, deg);
      }
    }
    function renderRadialKeepDragging(name, deg) {
      renderRadial();
      dragging = radialEl.querySelector('.slice[data-name="' + cssEsc(name) + '"]');
      if (dragging) {
        dragging.classList.add("dragging");
        dragging.style.transition = "none";
        dragging.setAttribute("transform", "rotate(" + deg + " " + R.cx + " " + R.cy + ")");
      }
      window.addEventListener("pointermove", onMove);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      var name = dragName, wasMoved = moved;
      if (dragging) { dragging.classList.remove("dragging"); dragging.style.transition = ""; }
      saveOrder(order);
      renderRadial(); // settle dragged slice into its slot with transition
      dragging = null; dragName = null;
      if (!wasMoved) { var it = order.find(function (x) { return x.name === name; }); go(it); }
    }
  }

  /* -------- helpers --------------------------------------------------------- */
  function escapeHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  /* -------- boot ------------------------------------------------------------ */
  var initial = "grid";
  try { initial = localStorage.getItem(VIEW_KEY) || "grid"; } catch (e) {}
  if (initial !== "grid" && initial !== "list" && initial !== "radial") initial = "grid";
  setView(initial, false);
})();
