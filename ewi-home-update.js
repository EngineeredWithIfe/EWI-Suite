/* ===========================================================================
   EWI Suite — home-page "keep your copy current" control.

   Renders TWO buttons on the EWI home page:
     1) "Update — replace my copy"  — gets the latest bundle and, on browsers
        that support the File System Access API (Chromium: Chrome/Edge/Opera),
        lets the visitor pick their EXISTING ewi-suite.zip and overwrite it in
        place (a genuine replace). On Safari/Firefox — which, by web-security
        design, cannot delete or silently overwrite a user's files — it falls
        back to a normal download named "ewi-suite.zip" (replace when your
        browser asks, or drop it into the same folder).
     2) "Download a fresh copy"     — always saves a NEW, version-stamped file
        (ewi-suite-<version>.zip), so it never collides with an older copy.

   Both requests are cache-busted with the current build version, so a visitor
   who already downloaded an older bundle is guaranteed the newest bytes — the
   fix for "I re-downloaded but the app looks unchanged."

   Honesty note: no web page can reach into a visitor's disk and delete a file
   without their consent — that is a hard browser sandbox guarantee (~100%,
   enforced by every major engine). The File System Access API is the closest
   standards-based path: the USER selects the file and authorizes the write.
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
  var SYNC_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.35-3.82"/><path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.35 3.82"/>' +
    '<path d="M21 3v6h-6"/><path d="M3 21v-6h6"/></svg>';

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

  // True in-place replace where the platform allows it (Chromium). The user
  // picks a file and authorizes the write; if they choose their existing
  // ewi-suite.zip, it is overwritten. Elsewhere we fall back to a download.
  function replaceInPlace(v, btn) {
    var url = bust(ZIP_URL, v);
    if (typeof window.showSaveFilePicker === "function") {
      btn.disabled = true; say("Choose your existing ewi-suite.zip to replace it…");
      var handle;
      window.showSaveFilePicker({
        suggestedName: "ewi-suite.zip",
        types: [{ description: "EWI Suite bundle", accept: { "application/zip": [".zip"] } }]
      }).then(function (h) {
        handle = h; say("Downloading the latest build…");
        return fetch(url, { cache: "no-store" });
      }).then(function (resp) {
        if (!resp || !resp.ok) throw new Error("fetch failed");
        return Promise.all([handle.createWritable(), resp.arrayBuffer()]);
      }).then(function (parts) {
        var writable = parts[0], buf = parts[1];
        say("Writing " + fmtBytes(buf.byteLength) + "…");
        return writable.write(buf).then(function () { return writable.close(); });
      }).then(function () {
        say("✓ Your EWI Suite copy is now up to date. Re-launch the engine to see the changes.");
      }).catch(function (err) {
        if (err && err.name === "AbortError") { say(""); }
        else {
          // Any failure (permission, unsupported write) → safe download fallback.
          anchorDownload(url, "ewi-suite.zip");
          say("Saved the latest ewi-suite.zip — replace your old file (or drop it in the same folder).");
        }
      }).then(function () { btn.disabled = false; });
    } else {
      // Safari / Firefox: cannot overwrite disk files — download with the same
      // name so the browser offers to replace it.
      anchorDownload(url, "ewi-suite.zip");
      say("Saved the latest ewi-suite.zip — when your browser asks, choose Replace (or save it into the same folder as your old copy).");
    }
  }

  function freshCopy(v) {
    var url = bust(ZIP_URL, v);
    var name = "ewi-suite-" + versionTag(v) + ".zip";
    anchorDownload(url, name);
    say("Saved a fresh copy: " + name + " — a brand-new file, safe to keep alongside older ones.");
  }

  function build() {
    injectStyles();
    var sec = document.createElement("section");
    sec.className = "band"; sec.id = "ewi-update";
    sec.innerHTML =
      '<div class="inner">' +
      "<h2>Already have the app? Keep it current.</h2>" +
      "<p>Downloaded an earlier build? If a product looks unchanged after an update, your " +
      "computer is still running the older files. Refresh your copy here — you always get the newest bytes.</p>" +
      '<div class="ewi-updbtns">' +
      '<button class="ewi-updbtn primary" id="ewiUpdReplace" type="button" ' +
      'aria-label="Update and replace my existing EWI Suite copy">' + SYNC_ICON +
      "Update — replace my copy</button>" +
      '<button class="ewi-updbtn" id="ewiUpdFresh" type="button" ' +
      'aria-label="Download a fresh, version-stamped copy of the EWI Suite">' + DL_ICON +
      "Download a fresh copy</button>" +
      "</div>" +
      '<p class="ewi-updmeta" id="ewiUpdMeta" role="status" aria-live="polite"></p>' +
      '<p class="ewi-updhint">“Replace” overwrites your existing file in place on Chrome, Edge and Opera; ' +
      "on Safari and Firefox it downloads with the same name so you can replace it yourself. " +
      "“Fresh copy” always saves a new, version-stamped file.</p>" +
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

    document.getElementById("ewiUpdReplace").addEventListener("click", function () {
      replaceInPlace(vState, this);
    });
    document.getElementById("ewiUpdFresh").addEventListener("click", function () {
      freshCopy(vState);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else { build(); }
})();
