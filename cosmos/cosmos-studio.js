/* =============================================================================
   EWI COSMOS — 3D Studio
   A WebGL cinematic + scene-building layer that sits on top of the 2D gravity
   sandbox. Everything runs on-device: Three.js is vendored locally (./vendor),
   nothing is fetched at runtime, no data leaves the page.

   Capabilities
   ------------
   • Real-ephemeris solar system — planet positions from J2000 Keplerian
     elements (Standish/JPL), true axial tilt + spin, orbit paths.
   • A curated calendar of real events — total solar/lunar eclipses, major
     meteor-shower peaks, and notable asteroid close approaches — that snap the
     date and align the geometry so you can watch them unfold.
   • Two cameras — Explore (orbit / pan / zoom by mouse, touch, keyboard, or
     gamepad) and Cinematic (an auto-directed replay camera à la a sports
     replay), switchable at any time.
   • A 3D "receiver" playroom — import .obj / .glTF / .glb models, images,
     MP4/WebM video, and MP3/WAV audio, then move / rotate / scale them in space
     with a Blender-style gizmo. Video renders as a texture; audio is positional.
   • A lightweight scene builder — add primitives, reorder, delete, and
     save / load the whole scene as JSON (localStorage + file export).

   Dependencies (vendored, offline):
     ./vendor/three.module.js               (import map: "three")
     ./vendor/addons/OrbitControls.js
     ./vendor/addons/TransformControls.js
     ./vendor/addons/OBJLoader.js
     ./vendor/addons/MTLLoader.js
     ./vendor/addons/GLTFLoader.js
     ./vendor/utils/BufferGeometryUtils.js  (pulled in by GLTFLoader)
   ============================================================================= */

import * as THREE from 'three';
import { OrbitControls }    from './vendor/addons/OrbitControls.js';
import { TransformControls } from './vendor/addons/TransformControls.js';
import { OBJLoader }        from './vendor/addons/OBJLoader.js';
import { MTLLoader }        from './vendor/addons/MTLLoader.js';
import { GLTFLoader }       from './vendor/addons/GLTFLoader.js';

/* ---------------------------------------------------------------------------
   0.  Constants + real astronomical data
   ------------------------------------------------------------------------- */
const DEG = Math.PI / 180;
const J2000 = 2451545.0;                 // Julian date of 2000-01-01 12:00 TT
const DAY_MS = 86400000;

// J2000 Keplerian elements + centennial rates (Standish, valid ~1800–2050).
// [ a(AU), e, I(deg), L(deg), longPeri(deg), longNode(deg) ] and per-century rates.
const PLANETS = [
  { key:'mercury', name:'Mercury', color:0x9c8b7a, size:0.18, tilt:0.03,  rot:58.6,
    el:[0.38709927,0.20563593,7.00497902,252.25032350,77.45779628,48.33076593],
    rate:[0.00000037,0.00001906,-0.00594749,149472.67411175,0.16047689,-0.12534081] },
  { key:'venus',   name:'Venus',   color:0xe8c08a, size:0.30, tilt:177.4, rot:-243,
    el:[0.72333566,0.00677672,3.39467605,181.97909950,131.60246718,76.67984255],
    rate:[0.00000390,-0.00004107,-0.00078890,58517.81538729,0.00268329,-0.27769418] },
  { key:'earth',   name:'Earth',   color:0x3f7fd0, size:0.32, tilt:23.44, rot:1,
    el:[1.00000261,0.01671123,-0.00001531,100.46457166,102.93768193,0.0],
    rate:[0.00000562,-0.00004392,-0.01294668,35999.37244981,0.32327364,0.0], moon:true },
  { key:'mars',    name:'Mars',    color:0xc1543a, size:0.24, tilt:25.19, rot:1.03,
    el:[1.52371034,0.09339410,1.84969142,-4.55343205,-23.94362959,49.55953891],
    rate:[0.00001847,0.00007882,-0.00813131,19140.30268499,0.44441088,-0.29257343] },
  { key:'jupiter', name:'Jupiter', color:0xd8b48a, size:1.05, tilt:3.13,  rot:0.41,
    el:[5.20288700,0.04838624,1.30439695,34.39644051,14.72847983,100.47390909],
    rate:[-0.00011607,-0.00013253,-0.00183714,3034.74612775,0.21252668,0.20469106] },
  { key:'saturn',  name:'Saturn',  color:0xe0c59a, size:0.92, tilt:26.73, rot:0.45, ring:true,
    el:[9.53667594,0.05386179,2.48599187,49.95424423,92.59887831,113.66242448],
    rate:[-0.00125060,-0.00050991,0.00193609,1222.49362201,-0.41897216,-0.28867794] },
  { key:'uranus',  name:'Uranus',  color:0x9fe0e8, size:0.62, tilt:97.77, rot:-0.72,
    el:[19.18916464,0.04725744,0.77263783,313.23810451,170.95427630,74.01692503],
    rate:[-0.00196176,-0.00004397,-0.00242939,428.48202785,0.40805281,0.04240589] },
  { key:'neptune', name:'Neptune', color:0x4f6fd6, size:0.60, tilt:28.32, rot:0.67,
    el:[30.06992276,0.00859048,1.77004347,-55.12002969,44.96476227,131.78422574],
    rate:[0.00026291,0.00005105,0.00035372,218.45945325,-0.32241464,-0.00508664] },
];

// Curated real events (dates are UTC calendar days; types drive the visuals).
const EVENTS = [
  { date:'2024-04-08', name:'Total solar eclipse — North America', type:'solar',  note:'Path swept Mexico → USA → Canada. ~4m28s totality.' },
  { date:'2025-09-07', name:'Total lunar eclipse — “Blood Moon”',   type:'lunar',  note:'Visible across Asia, Africa, Europe, Oceania.' },
  { date:'2026-02-17', name:'Annular solar eclipse — Antarctica',   type:'solar',  note:'Ring of fire over the Southern Ocean.' },
  { date:'2026-03-03', name:'Total lunar eclipse',                   type:'lunar',  note:'Visible from the Pacific, Americas, and East Asia.' },
  { date:'2026-08-12', name:'Total solar eclipse — Arctic & Iberia', type:'solar', note:'Greenland, Iceland, and Spain. First European totality since 1999.' },
  { date:'2027-08-02', name:'Total solar eclipse — “Eclipse of the century”', type:'solar', note:'Up to 6m23s over Egypt, Saudi Arabia, and North Africa.' },
  { date:'2028-07-22', name:'Total solar eclipse — Australia & NZ',  type:'solar',  note:'Crosses Sydney; ~5m of totality.' },
  { date:'2029-04-13', name:'Asteroid 99942 Apophis — close approach', type:'asteroid', note:'Passes ~31,600 km from Earth, inside geostationary orbit.' },
  { date:'2026-01-03', name:'Quadrantids meteor shower — peak',      type:'meteor', radiant:'Boötes',  note:'Sharp peak; up to ~120 meteors/hr.' },
  { date:'2026-08-12', name:'Perseids meteor shower — peak',         type:'meteor', radiant:'Perseus', note:'Reliable summer shower; ~100 meteors/hr.' },
  { date:'2026-10-21', name:'Orionids meteor shower — peak',         type:'meteor', radiant:'Orion',   note:'Debris from Halley’s Comet; ~20 meteors/hr.' },
  { date:'2026-11-17', name:'Leonids meteor shower — peak',          type:'meteor', radiant:'Leo',     note:'Fast meteors; occasional storms.' },
  { date:'2026-12-14', name:'Geminids meteor shower — peak',         type:'meteor', radiant:'Gemini',  note:'Best annual shower; up to ~150 meteors/hr.' },
];

/* ---------------------------------------------------------------------------
   1.  Astronomy — date → heliocentric ecliptic position (AU)
   ------------------------------------------------------------------------- */
function dateToJD(d){ return d.getTime() / DAY_MS + 2440587.5; }
function norm360(x){ x %= 360; return x < 0 ? x + 360 : x; }

function solveKepler(M, e){                 // M in radians → eccentric anomaly
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++){
    const dM = M - (E - e * Math.sin(E));
    E += dM / (1 - e * Math.cos(E));
  }
  return E;
}

// Returns THREE.Vector3 in AU, ecliptic frame (x→vernal equinox, z→ecliptic north).
function heliocentric(p, jd){
  const T = (jd - J2000) / 36525;
  const a = p.el[0] + p.rate[0]*T;
  const e = p.el[1] + p.rate[1]*T;
  const I = (p.el[2] + p.rate[2]*T) * DEG;
  const L = p.el[3] + p.rate[3]*T;
  const wbar = p.el[4] + p.rate[4]*T;      // longitude of perihelion
  const node = (p.el[5] + p.rate[5]*T) * DEG;
  const w = (wbar - (p.el[5] + p.rate[5]*T)) * DEG;   // argument of perihelion
  let M = norm360(L - wbar); if (M > 180) M -= 360;
  const E = solveKepler(M*DEG, e);
  const xo = a*(Math.cos(E) - e);
  const yo = a*Math.sqrt(1 - e*e)*Math.sin(E);
  const cw=Math.cos(w), sw=Math.sin(w), cO=Math.cos(node), sO=Math.sin(node), cI=Math.cos(I), sI=Math.sin(I);
  const x = (cw*cO - sw*sO*cI)*xo + (-sw*cO - cw*sO*cI)*yo;
  const y = (cw*sO + sw*cO*cI)*xo + (-sw*sO + cw*cO*cI)*yo;
  const z = (sw*sI)*xo + (cw*sI)*yo;
  return new THREE.Vector3(x, y, z);       // AU, ecliptic
}

// Radial compression so all orbits are visible; angles (and thus alignments)
// are preserved exactly, so eclipse/opposition geometry still lines up.
const SCENE_K = 6;
function auToScene(v){
  const r = v.length();
  if (r < 1e-9) return new THREE.Vector3();
  const s = (SCENE_K * Math.sqrt(r)) / r;
  // ecliptic (x,y,z) → Three (Y up):  X=x, Y=z, Z=-y
  return new THREE.Vector3(v.x*s, v.z*s, -v.y*s);
}

/* ---------------------------------------------------------------------------
   2.  Studio construction (built lazily on first open)
   ------------------------------------------------------------------------- */
let built = false, open = false;
let renderer, scene, camera, orbit, transform, listener;
let raycaster, pointer = new THREE.Vector2();
let clock;
let root, canvasWrap, objListEl, inspectorEl, eventNoteEl, dateInput, speedInput, playBtn, camBtnExp, camBtnCine;
const planetMeshes = {};                    // key → { group, mesh, spin, orbitLine }
let moon;                                    // { pivot, mesh }
let sun, sunLight;
let asteroidBelt, meteorSys = null;
const imported = [];                         // { id, name, type, object3d, extra }
let selected = null;
let simDate = new Date('2026-08-17T00:00:00Z');
let timeScale = 5;                           // sim days per real second
let playing = true;
let camMode = 'explore';                     // 'explore' | 'cinematic'
let cineT = 0, cineFocusKey = 'earth', cineNextCut = 6;
let gamepadIndex = null;
let idSeq = 1;

/* ---- styling ---- */
function injectCSS(){
  if (document.getElementById('studio-css')) return;
  const s = document.createElement('style'); s.id = 'studio-css';
  s.textContent = `
  #studioRoot{position:fixed;inset:0;z-index:9000;display:none;background:#05060d;color:#e8ecf6;
    font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow:hidden}
  #studioRoot.on{display:block}
  #studioRoot canvas{display:block;touch-action:none}
  .st-bar{position:absolute;top:0;left:0;right:0;height:52px;display:flex;align-items:center;gap:8px;
    padding:0 12px;background:linear-gradient(180deg,rgba(10,12,22,.92),rgba(10,12,22,.55));
    backdrop-filter:blur(10px);border-bottom:1px solid rgba(255,255,255,.08);z-index:5}
  .st-bar .brand{display:flex;align-items:center;gap:8px;font-weight:800;letter-spacing:-.01em}
  .st-bar .brand .m{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(180deg,#7c5cff,#5a3fd6);color:#fff;font-size:15px}
  .st-bar .grow{flex:1}
  .st-btn{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#e8ecf6;
    height:34px;padding:0 12px;border-radius:9px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap;
    display:inline-flex;align-items:center;gap:6px;transition:background .15s,border-color .15s}
  .st-btn:hover{background:rgba(124,92,255,.16);border-color:rgba(124,92,255,.5)}
  .st-btn.on{background:linear-gradient(180deg,#7c5cff,#5a3fd6);border-color:transparent;color:#fff}
  .st-btn.ghost{background:transparent}
  .st-seg{display:flex;border:1px solid rgba(255,255,255,.14);border-radius:9px;overflow:hidden}
  .st-seg .st-btn{border:0;border-radius:0;height:32px}
  .st-panel{position:absolute;top:64px;bottom:64px;width:250px;background:rgba(12,14,24,.82);
    backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.08);border-radius:14px;
    display:flex;flex-direction:column;overflow:hidden;z-index:4}
  .st-left{left:12px}.st-right{right:12px}
  .st-panel h4{margin:0;padding:11px 13px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;
    color:#9aa3bd;border-bottom:1px solid rgba(255,255,255,.07)}
  .st-scroll{overflow:auto;padding:8px}
  .st-item{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:9px;cursor:pointer;font-size:12.5px}
  .st-item:hover{background:rgba(255,255,255,.05)}
  .st-item.sel{background:rgba(124,92,255,.2)}
  .st-dot{width:11px;height:11px;border-radius:50%;flex:none}
  .st-item .x{margin-left:auto;opacity:.5;font-size:13px}
  .st-item .x:hover{opacity:1}
  .st-field{padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.06)}
  .st-field label{display:block;font-size:10.5px;color:#9aa3bd;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px}
  .st-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px}
  .st-row3 input{width:100%;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);color:#e8ecf6;
    border-radius:7px;padding:5px 6px;font-size:12px;font-variant-numeric:tabular-nums}
  .st-note{padding:10px 12px;font-size:12px;color:#c6cde0}
  .st-note b{color:#fff}
  .st-menu{position:fixed;z-index:20;min-width:130px;background:rgba(14,16,26,.97);backdrop-filter:blur(12px);
    border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:5px;box-shadow:0 12px 34px rgba(0,0,0,.5);display:flex;flex-direction:column;gap:2px}
  .st-menu button{background:transparent;border:0;color:#e8ecf6;text-align:left;padding:8px 11px;border-radius:7px;font-size:12.5px;cursor:pointer}
  .st-menu button:hover,.st-menu button:focus{background:rgba(124,92,255,.28);outline:none}
  .st-time{position:absolute;left:50%;transform:translateX(-50%);bottom:12px;z-index:4;display:flex;align-items:center;gap:10px;
    background:rgba(12,14,24,.82);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:8px 12px}
  .st-time input[type=date]{background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);color:#e8ecf6;border-radius:8px;padding:5px 7px;font-size:12.5px}
  .st-time input[type=range]{width:120px;accent-color:#7c5cff}
  .st-hint{position:absolute;right:276px;bottom:14px;z-index:4;font-size:11px;color:#8b93ad;max-width:230px;text-align:right;pointer-events:none}
  .st-drop{position:absolute;inset:52px 0 0 0;z-index:8;display:none;align-items:center;justify-content:center;
    background:rgba(90,63,214,.22);border:3px dashed rgba(124,92,255,.7);margin:12px;border-radius:18px;
    font-size:20px;font-weight:800;color:#fff;pointer-events:none}
  #studioRoot.dragging .st-drop{display:flex}
  .st-toast{position:absolute;left:50%;top:66px;transform:translateX(-50%);z-index:9;background:rgba(20,22,34,.95);
    border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 14px;font-size:12.5px;opacity:0;transition:opacity .2s;pointer-events:none}
  .st-toast.show{opacity:1}
  .st-badge{position:absolute;left:50%;transform:translateX(-50%);bottom:64px;z-index:6;background:rgba(124,92,255,.16);border:1px solid rgba(124,92,255,.5);
    border-radius:12px;padding:9px 14px;font-size:12px;max-width:min(440px,86vw);text-align:center;display:none}
  @media (max-width:820px){
    .st-panel{width:44vw;max-width:250px;top:60px;bottom:120px}
    .st-hint{display:none}
    .st-bar{gap:6px;overflow-x:auto}
    .st-bar .st-btn span.lbl{display:none}
  }
  @media (max-width:560px){
    .st-panel{width:calc(100vw - 24px);height:38vh;bottom:auto;top:60px}
    .st-right{display:none}
    .st-time{flex-wrap:wrap;max-width:calc(100vw - 24px);justify-content:center}
  }`;
  document.head.appendChild(s);
}

/* ---- DOM scaffold ---- */
function buildDOM(){
  injectCSS();
  root = document.createElement('div'); root.id = 'studioRoot';
  root.innerHTML = `
    <div class="st-bar">
      <div class="brand"><span class="m">◈</span> EWI&nbsp;Cosmos <span style="opacity:.6;font-weight:600">· 3D Studio</span></div>
      <div class="st-seg" role="group" aria-label="Camera">
        <button class="st-btn on" id="stExplore" title="Orbit / pan / zoom">🖱 <span class="lbl">Explore</span></button>
        <button class="st-btn" id="stCine" title="Auto-directed cinematic camera">🎬 <span class="lbl">Cinematic</span></button>
      </div>
      <div class="grow"></div>
      <button class="st-btn ghost" id="stAdd" title="Add a primitive">＋ <span class="lbl">Add</span></button>
      <button class="st-btn ghost" id="stImport" title="Import a model, image, video, or audio">⬆ <span class="lbl">Import</span></button>
      <select class="st-btn ghost" id="stEvent" title="Jump to a real astronomical event" style="max-width:210px"></select>
      <button class="st-btn ghost" id="stSave" title="Save scene to this browser">💾 <span class="lbl">Save</span></button>
      <button class="st-btn ghost" id="stExport" title="Export scene as a file">⇩ <span class="lbl">Export</span></button>
      <button class="st-btn" id="stClose" title="Back to the 2D sandbox">✕ <span class="lbl">Close</span></button>
    </div>

    <aside class="st-panel st-left">
      <h4>Scene</h4>
      <div class="st-scroll" id="stObjList"></div>
    </aside>

    <aside class="st-panel st-right">
      <h4>Inspector</h4>
      <div class="st-scroll" id="stInspector"><div class="st-note">Select a body or imported object to inspect and transform it.</div></div>
    </aside>

    <div class="st-badge" id="stBadge"></div>

    <div class="st-time">
      <input type="date" id="stDate" value="2026-08-17" aria-label="Simulation date" />
      <button class="st-btn" id="stPlay" title="Play / pause">⏸</button>
      <input type="range" id="stSpeed" min="0" max="8" step="1" value="3" aria-label="Time speed" />
      <span id="stSpeedLbl" style="font-size:11.5px;color:#9aa3bd;min-width:64px">5 d/s</span>
    </div>

    <div class="st-hint">
      Explore: drag orbit · scroll zoom · right-drag pan · <b>W/E/R</b> move·rotate·scale · <b>F</b> focus · <b>Del</b> remove · gamepad supported
    </div>

    <div class="st-drop">Drop a model, image, video, or audio to place it in 3D</div>
    <div class="st-toast" id="stToast"></div>

    <input type="file" id="stFile" accept=".obj,.gltf,.glb,.mtl,image/*,video/*,audio/*" multiple style="display:none" />
  `;
  document.body.appendChild(root);

  canvasWrap = root;
  objListEl   = root.querySelector('#stObjList');
  inspectorEl = root.querySelector('#stInspector');
  eventNoteEl = root.querySelector('#stBadge');
  dateInput   = root.querySelector('#stDate');
  speedInput  = root.querySelector('#stSpeed');
  playBtn     = root.querySelector('#stPlay');
  camBtnExp   = root.querySelector('#stExplore');
  camBtnCine  = root.querySelector('#stCine');

  // event dropdown
  const sel = root.querySelector('#stEvent');
  sel.innerHTML = '<option value="">Jump to an event…</option>' +
    EVENTS.map((e,i)=>`<option value="${i}">${e.date} · ${e.name}</option>`).join('');
  sel.addEventListener('change', ()=>{ if (sel.value!=='') jumpToEvent(+sel.value); });

  // wiring
  root.querySelector('#stClose').addEventListener('click', close);
  camBtnExp.addEventListener('click', ()=>setCamMode('explore'));
  camBtnCine.addEventListener('click', ()=>setCamMode('cinematic'));
  root.querySelector('#stAdd').addEventListener('click', addPrimitiveMenu);
  root.querySelector('#stImport').addEventListener('click', ()=>root.querySelector('#stFile').click());
  root.querySelector('#stFile').addEventListener('change', e=>{ handleFiles(e.target.files); e.target.value=''; });
  root.querySelector('#stSave').addEventListener('click', saveScene);
  root.querySelector('#stExport').addEventListener('click', exportScene);
  playBtn.addEventListener('click', ()=>{ playing=!playing; playBtn.textContent = playing?'⏸':'▶'; });
  dateInput.addEventListener('change', ()=>{ simDate = new Date(dateInput.value+'T00:00:00Z'); updatePlanets(); });
  const SPD=[0,1,2,5,15,45,120,365,1460];
  speedInput.addEventListener('input', ()=>{ timeScale=SPD[+speedInput.value]; root.querySelector('#stSpeedLbl').textContent = timeScale+' d/s'; });

  // drag + drop
  root.addEventListener('dragover', e=>{ e.preventDefault(); root.classList.add('dragging'); });
  root.addEventListener('dragleave', e=>{ if (e.target===root) root.classList.remove('dragging'); });
  root.addEventListener('drop', e=>{ e.preventDefault(); root.classList.remove('dragging'); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
}

function toast(msg){
  const t = root.querySelector('#stToast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(()=>t.classList.remove('show'), 2200);
}

/* ---------------------------------------------------------------------------
   3.  Three.js scene
   ------------------------------------------------------------------------- */
function buildScene(){
  renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  root.insertBefore(renderer.domElement, root.firstChild);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060d);

  camera = new THREE.PerspectiveCamera(52, 1, 0.02, 6000);
  camera.position.set(0, 26, 52);
  listener = new THREE.AudioListener(); camera.add(listener);

  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true; orbit.dampingFactor = 0.08;
  orbit.maxDistance = 900; orbit.minDistance = 0.5;

  transform = new TransformControls(camera, renderer.domElement);
  transform.addEventListener('dragging-changed', e=>{ orbit.enabled = !e.value; });
  transform.addEventListener('objectChange', syncInspector);
  scene.add(transform);

  raycaster = new THREE.Raycaster();
  clock = new THREE.Clock();

  // lighting
  scene.add(new THREE.AmbientLight(0x223044, 0.6));
  const hemi = new THREE.HemisphereLight(0x8899ff, 0x0a0a12, 0.25); scene.add(hemi);

  // starfield
  scene.add(makeStarfield());

  // Sun
  sun = new THREE.Mesh(
    new THREE.SphereGeometry(3, 48, 48),
    new THREE.MeshBasicMaterial({ color:0xffcf6b })
  );
  sun.name = 'Sun'; scene.add(sun);
  sunLight = new THREE.PointLight(0xfff4d8, 3.2, 0, 0.0); sun.add(sunLight);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(4.4,32,32),
    new THREE.MeshBasicMaterial({ color:0xffb020, transparent:true, opacity:0.14 }));
  sun.add(glow);

  // planets
  for (const p of PLANETS) buildPlanet(p);
  buildAsteroidBelt();

  updatePlanets();
  refreshObjList();
  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keydown', onKey);
}

function makeStarfield(){
  const N = 2600, pos = new Float32Array(N*3), col = new Float32Array(N*3);
  for (let i=0;i<N;i++){
    // uniform on a large sphere
    const u=Math.random()*2-1, th=Math.random()*Math.PI*2, r=Math.sqrt(1-u*u);
    const R = 1400 + Math.random()*600;
    pos[i*3]=R*r*Math.cos(th); pos[i*3+1]=R*u; pos[i*3+2]=R*r*Math.sin(th);
    const w = 0.6 + Math.random()*0.4, warm = Math.random();
    col[i*3]=w; col[i*3+1]=w*(0.9+warm*0.1); col[i*3+2]=w*(0.85+ (1-warm)*0.15);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('color', new THREE.BufferAttribute(col,3));
  return new THREE.Points(g, new THREE.PointsMaterial({ size:2.1, sizeAttenuation:false, vertexColors:true, transparent:true, opacity:0.9 }));
}

function buildPlanet(p){
  const group = new THREE.Group(); group.name = p.name; scene.add(group);
  const mat = new THREE.MeshStandardMaterial({ color:p.color, roughness:0.85, metalness:0.02 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(p.size, 40, 40), mat);
  mesh.userData.planet = p.key; mesh.name = p.name;
  const spin = new THREE.Group(); spin.rotation.z = p.tilt*DEG; spin.add(mesh);
  group.add(spin);

  if (p.ring){
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(p.size*1.35, p.size*2.2, 64),
      new THREE.MeshBasicMaterial({ color:0xd8c69a, side:THREE.DoubleSide, transparent:true, opacity:0.55 })
    );
    ring.rotation.x = Math.PI/2; spin.add(ring);
  }
  // orbit path (sampled over one revolution)
  const line = buildOrbitLine(p);
  scene.add(line);

  planetMeshes[p.key] = { group, mesh, spin, orbitLine:line };

  if (p.moon){
    const pivot = new THREE.Group(); group.add(pivot);
    const mmesh = new THREE.Mesh(new THREE.SphereGeometry(0.09,24,24),
      new THREE.MeshStandardMaterial({ color:0xcfcfcf, roughness:0.95 }));
    mmesh.name = 'Moon'; mmesh.userData.planet = 'moon';
    pivot.add(mmesh);
    moon = { pivot, mesh:mmesh };
  }
}

function buildOrbitLine(p){
  const pts = [], N = 256;
  const jd0 = dateToJD(simDate);
  const periodDays = 365.25 * Math.pow(p.el[0], 1.5);
  for (let i=0;i<=N;i++){
    const jd = jd0 + (i/N)*periodDays;
    pts.push(auToScene(heliocentric(p, jd)));
  }
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color:0x394a6a, transparent:true, opacity:0.28 }));
}

function buildAsteroidBelt(){
  const N = 1400, pos = new Float32Array(N*3);
  for (let i=0;i<N;i++){
    const a = 2.1 + Math.random()*1.1;               // AU, main belt
    const th = Math.random()*Math.PI*2;
    const rS = SCENE_K*Math.sqrt(a);
    const jitter = (Math.random()-0.5)*1.2;
    pos[i*3]   = rS*Math.cos(th);
    pos[i*3+1] = jitter;
    pos[i*3+2] = rS*Math.sin(th);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  asteroidBelt = new THREE.Points(g, new THREE.PointsMaterial({ color:0x8a8577, size:0.9, sizeAttenuation:false, transparent:true, opacity:0.6 }));
  asteroidBelt.name = 'Asteroid belt';
  scene.add(asteroidBelt);
}

/* ---------------------------------------------------------------------------
   4.  Per-frame updates
   ------------------------------------------------------------------------- */
function updatePlanets(){
  const jd = dateToJD(simDate);
  for (const p of PLANETS){
    const rec = planetMeshes[p.key];
    rec.group.position.copy(auToScene(heliocentric(p, jd)));
  }
  updateMoon(jd);
  // date label + any active event badge
  if (dateInput) dateInput.value = simDate.toISOString().slice(0,10);
}

// Simplified geocentric Moon (mean elements) — plausible motion; for curated
// eclipse dates the geometry is snapped so the alignment reads correctly.
function updateMoon(jd){
  if (!moon) return;
  const earthPos = planetMeshes.earth.group.position;
  const sunDir = earthPos.clone().negate().normalize();     // Earth → Sun in scene
  const d = jd - J2000;
  const lon = norm360(218.316 + 13.176396*d) * DEG;          // mean longitude
  const inc = 5.145*DEG, node = norm360(125.045 - 0.052954*d)*DEG;
  const R = 1.05;                                            // scene units from Earth
  // position in ecliptic-ish frame, then into scene (Y up)
  const x = Math.cos(lon), z = Math.sin(lon), y = Math.sin(lon-node)*Math.sin(inc);
  let local = new THREE.Vector3(x, y, z).normalize().multiplyScalar(R);

  const ev = activeEclipse(jd);
  if (ev === 'solar')      local = sunDir.clone().multiplyScalar(R);        // between Earth and Sun
  else if (ev === 'lunar') local = sunDir.clone().multiplyScalar(-R);       // opposite the Sun
  moon.mesh.position.copy(local);
}

function activeEclipse(jd){
  for (const e of EVENTS){
    if (e.type!=='solar' && e.type!=='lunar') continue;
    const ejd = dateToJD(new Date(e.date+'T00:00:00Z'));
    if (Math.abs(jd - ejd) < 0.5) return e.type;
  }
  return null;
}

function tickCinematic(dt){
  cineT += dt; cineNextCut -= dt;
  if (cineNextCut <= 0){
    const keys = ['earth','earth','mars','jupiter','saturn','venus'];
    cineFocusKey = keys[(Math.random()*keys.length)|0];
    cineNextCut = 6 + Math.random()*4;
  }
  const rec = planetMeshes[cineFocusKey]; if (!rec) return;
  const tgt = rec.group.position;
  const radius = 6 + (PLANETS.find(p=>p.key===cineFocusKey)?.size||1)*3;
  const ang = cineT*0.18;
  const desired = new THREE.Vector3(
    tgt.x + Math.cos(ang)*radius,
    tgt.y + 2.4 + Math.sin(cineT*0.5)*1.2,
    tgt.z + Math.sin(ang)*radius
  );
  camera.position.lerp(desired, 1 - Math.pow(0.001, dt));
  orbit.target.lerp(tgt, 1 - Math.pow(0.004, dt));
}

let raf = 0;
function animate(){
  raf = requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());

  if (playing){
    simDate = new Date(simDate.getTime() + timeScale*dt*DAY_MS);
    updatePlanets();
  }
  // planet spin (visual, exaggerated)
  for (const p of PLANETS){
    const rec = planetMeshes[p.key];
    rec.spin.rotation.y += (p.rot!==0 ? (1/p.rot) : 0) * dt * 0.6;
  }
  if (asteroidBelt) asteroidBelt.rotation.y += dt*0.02;
  if (meteorSys) updateMeteors(dt);

  pollGamepad(dt);
  if (camMode==='cinematic') tickCinematic(dt);
  orbit.update();
  renderer.render(scene, camera);
}

function onResize(){
  if (!open) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w/h; camera.updateProjectionMatrix();
}

/* ---------------------------------------------------------------------------
   5.  Events — jump to a real eclipse / shower / asteroid pass
   ------------------------------------------------------------------------- */
function jumpToEvent(i){
  const e = EVENTS[i];
  simDate = new Date(e.date+'T00:00:00Z');
  playing = false; playBtn.textContent = '▶';
  updatePlanets();
  clearMeteors();
  if (e.type==='meteor') startMeteors();
  // badge
  eventNoteEl.style.display='block';
  eventNoteEl.innerHTML = `<b>${e.name}</b><br><span style="color:#c6cde0">${e.note}</span>`;
  // frame the relevant body
  if (e.type==='lunar' || e.type==='solar' || e.type==='asteroid') focusKey('earth');
  else focusKey('earth');
  setCamMode('cinematic');
  toast('Jumped to ' + e.date);
}

/* meteor shower particle system */
function startMeteors(){
  const N = 120;
  const pos = new Float32Array(N*3), vel = [];
  for (let i=0;i<N;i++){
    const px=(Math.random()-0.5)*40, py=8+Math.random()*20, pz=(Math.random()-0.5)*40;
    pos[i*3]=px; pos[i*3+1]=py; pos[i*3+2]=pz;
    vel.push(new THREE.Vector3(-2-Math.random()*3, -3-Math.random()*4, -1+ (Math.random()-0.5)*2));
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  const m = new THREE.PointsMaterial({ color:0xfff2cf, size:2.4, sizeAttenuation:false, transparent:true, opacity:0.95 });
  meteorSys = new THREE.Points(g, m); meteorSys.userData = { vel, life:new Float32Array(N).fill(0) };
  scene.add(meteorSys);
}
function updateMeteors(dt){
  const arr = meteorSys.geometry.attributes.position.array;
  const { vel, life } = meteorSys.userData;
  for (let i=0;i<vel.length;i++){
    life[i]+=dt;
    arr[i*3]+=vel[i].x*dt*4; arr[i*3+1]+=vel[i].y*dt*4; arr[i*3+2]+=vel[i].z*dt*4;
    if (arr[i*3+1] < -12 || life[i] > 3){
      arr[i*3]=(Math.random()-0.5)*40; arr[i*3+1]=8+Math.random()*20; arr[i*3+2]=(Math.random()-0.5)*40; life[i]=0;
    }
  }
  meteorSys.geometry.attributes.position.needsUpdate = true;
}
function clearMeteors(){ if (meteorSys){ scene.remove(meteorSys); meteorSys.geometry.dispose(); meteorSys=null; } }

/* ---------------------------------------------------------------------------
   6.  Camera modes + focus + selection
   ------------------------------------------------------------------------- */
function setCamMode(m){
  camMode = m;
  camBtnExp.classList.toggle('on', m==='explore');
  camBtnCine.classList.toggle('on', m==='cinematic');
  orbit.enabled = (m==='explore');
  if (m==='cinematic'){ transform.detach(); cineNextCut = 0; }
}

function focusKey(key){
  const rec = planetMeshes[key]; if (!rec) return;
  const p = PLANETS.find(x=>x.key===key);
  const r = 5 + (p?p.size:1)*4;
  const tgt = rec.group.position.clone();
  orbit.target.copy(tgt);
  camera.position.set(tgt.x + r, tgt.y + r*0.5, tgt.z + r);
}

function focusObject(o){
  const box = new THREE.Box3().setFromObject(o);
  const c = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() || 2;
  orbit.target.copy(c);
  camera.position.set(c.x + size, c.y + size*0.6, c.z + size);
}

function onPointerDown(e){
  if (transform.dragging) return;
  const r = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left)/r.width)*2 - 1;
  pointer.y = -((e.clientY - r.top)/r.height)*2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const targets = [];
  for (const k in planetMeshes) targets.push(planetMeshes[k].mesh);
  if (moon) targets.push(moon.mesh);
  targets.push(sun);
  for (const im of imported) targets.push(im.object3d);
  const hit = raycaster.intersectObjects(targets, true)[0];
  if (hit){
    let o = hit.object;
    // resolve imported roots
    const im = imported.find(x=> o===x.object3d || o.parent && isDescendant(x.object3d,o));
    if (im){ selectImported(im); }
    else { selectPlanet(o.userData.planet || o.name); }
  }
}
function isDescendant(root,o){ let p=o; while(p){ if(p===root) return true; p=p.parent; } return false; }

function selectPlanet(key){
  selected = { type:'planet', key };
  transform.detach();
  highlightList(key);
  const p = PLANETS.find(x=>x.key===key);
  const jd = dateToJD(simDate);
  const v = p ? heliocentric(p, jd) : null;
  inspectorEl.innerHTML = `
    <div class="st-note"><b>${p?p.name:(key||'Body')}</b></div>` +
    (p ? `<div class="st-field"><label>Heliocentric distance</label>${v.length().toFixed(3)} AU</div>
    <div class="st-field"><label>Orbital period</label>${(Math.pow(p.el[0],1.5)).toFixed(2)} yr</div>
    <div class="st-field"><label>Axial tilt</label>${p.tilt}°</div>
    <div class="st-field"><label>Semi-major axis</label>${p.el[0]} AU · e=${p.el[1].toFixed(3)}</div>
    <div class="st-note" style="color:#9aa3bd">Position from J2000 Keplerian elements for ${simDate.toISOString().slice(0,10)}.</div>` : '');
}

function selectImported(im){
  selected = { type:'imported', im };
  if (camMode==='explore') transform.attach(im.object3d);
  highlightList(im.id);
  syncInspector();
}

function syncInspector(){
  if (!selected || selected.type!=='imported'){ return; }
  const o = selected.im.object3d;
  inspectorEl.innerHTML = `
    <div class="st-note"><b>${selected.im.name}</b> <span style="color:#9aa3bd">· ${selected.im.type}</span></div>
    <div class="st-field"><label>Position (x y z)</label><div class="st-row3">
      <input data-k="px" value="${o.position.x.toFixed(2)}"><input data-k="py" value="${o.position.y.toFixed(2)}"><input data-k="pz" value="${o.position.z.toFixed(2)}"></div></div>
    <div class="st-field"><label>Rotation° (x y z)</label><div class="st-row3">
      <input data-k="rx" value="${(o.rotation.x/DEG).toFixed(1)}"><input data-k="ry" value="${(o.rotation.y/DEG).toFixed(1)}"><input data-k="rz" value="${(o.rotation.z/DEG).toFixed(1)}"></div></div>
    <div class="st-field"><label>Scale</label><div class="st-row3">
      <input data-k="s" value="${o.scale.x.toFixed(2)}"><span></span><span></span></div></div>
    <div class="st-field" style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="st-btn" data-act="translate">Move (W)</button>
      <button class="st-btn" data-act="rotate">Rotate (E)</button>
      <button class="st-btn" data-act="scale">Scale (R)</button>
    </div>` +
    (selected.im.type==='video' ? `<div class="st-field"><button class="st-btn" data-act="playpause">▶ / ⏸ video</button></div>`:'') +
    (selected.im.type==='audio' ? `<div class="st-field"><button class="st-btn" data-act="playpause">▶ / ⏸ audio</button></div>`:'') +
    `<div class="st-field"><button class="st-btn" data-act="remove" style="color:#ff9a9a">Remove object (Del)</button></div>`;

  inspectorEl.querySelectorAll('input[data-k]').forEach(inp=>{
    inp.addEventListener('change', ()=>applyTransformField(o, inp.dataset.k, parseFloat(inp.value)||0));
  });
  inspectorEl.querySelectorAll('button[data-act]').forEach(b=>{
    b.addEventListener('click', ()=>doAct(b.dataset.act));
  });
}
function applyTransformField(o,k,v){
  if (k==='px') o.position.x=v; else if (k==='py') o.position.y=v; else if (k==='pz') o.position.z=v;
  else if (k==='rx') o.rotation.x=v*DEG; else if (k==='ry') o.rotation.y=v*DEG; else if (k==='rz') o.rotation.z=v*DEG;
  else if (k==='s') o.scale.setScalar(v||0.01);
}
function doAct(act){
  if (!selected || selected.type!=='imported') return;
  const im = selected.im;
  if (act==='translate'||act==='rotate'||act==='scale'){ transform.setMode(act); transform.attach(im.object3d); }
  else if (act==='remove'){ removeImported(im); }
  else if (act==='playpause'){
    if (im.type==='video' && im.extra.video){ im.extra.video.paused ? im.extra.video.play() : im.extra.video.pause(); }
    if (im.type==='audio' && im.extra.audio){ im.extra.audio.isPlaying ? im.extra.audio.pause() : im.extra.audio.play(); }
  }
}

/* ---------------------------------------------------------------------------
   7.  Scene list panel
   ------------------------------------------------------------------------- */
function refreshObjList(){
  const rows = [];
  rows.push(listRow('sun', 'Sun', 0xffcf6b, false));
  for (const p of PLANETS) rows.push(listRow(p.key, p.name, p.color, false));
  for (const im of imported) rows.push(listRow(im.id, im.name, 0x7c5cff, true, im));
  objListEl.innerHTML = rows.join('');
  objListEl.querySelectorAll('.st-item').forEach(el=>{
    el.addEventListener('click', ev=>{
      if (ev.target.classList.contains('x')) return;
      const id = el.dataset.id;
      const im = imported.find(x=>x.id===id);
      if (im){ focusObject(im.object3d); selectImported(im); }
      else if (id==='sun'){ selectPlanet('Sun'); focusKey('mercury'); }
      else { focusKey(id); selectPlanet(id); }
    });
    const x = el.querySelector('.x');
    if (x) x.addEventListener('click', ()=>{ const im=imported.find(i=>i.id===el.dataset.id); if (im) removeImported(im); });
  });
}
function listRow(id,name,color,rm,im){
  const hex = '#'+color.toString(16).padStart(6,'0');
  return `<div class="st-item" data-id="${id}">
    <span class="st-dot" style="background:${hex}"></span><span>${name}</span>${rm?'<span class="x" title="Remove">✕</span>':''}</div>`;
}
function highlightList(id){
  objListEl.querySelectorAll('.st-item').forEach(el=>el.classList.toggle('sel', el.dataset.id===String(id)));
}

/* ---------------------------------------------------------------------------
   8.  Import "receiver" — models, images, video, audio
   ------------------------------------------------------------------------- */
function placePos(){ // a little in front of the orbit target
  return orbit.target.clone();
}
function registerImported(name, type, object3d, extra){
  object3d.userData.importedId = 'imp'+(idSeq);
  const im = { id:'imp'+(idSeq++), name, type, object3d, extra:extra||{} };
  object3d.position.copy(placePos());
  scene.add(object3d);
  imported.push(im);
  refreshObjList();
  selectImported(im);
  focusObject(object3d);
  toast('Added ' + name);
  return im;
}
function normalizeModel(obj, target=4){
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3()).length() || 1;
  const s = target/size; obj.scale.setScalar(s);
  const c = box.getCenter(new THREE.Vector3()).multiplyScalar(s);
  obj.position.sub(c);
}

function handleFiles(files){
  for (const f of files){
    const url = URL.createObjectURL(f);
    const ext = (f.name.split('.').pop()||'').toLowerCase();
    if (ext==='obj') loadOBJ(url, f.name);
    else if (ext==='gltf'||ext==='glb') loadGLTF(url, f.name);
    else if (f.type.startsWith('image/')||['png','jpg','jpeg','webp','gif'].includes(ext)) loadImage(url, f.name);
    else if (f.type.startsWith('video/')||['mp4','webm','mov'].includes(ext)) loadVideo(url, f.name);
    else if (f.type.startsWith('audio/')||['mp3','wav','ogg','m4a'].includes(ext)) loadAudio(url, f.name);
    else toast('Unsupported: '+f.name);
  }
}
function loadOBJ(url,name){
  new OBJLoader().load(url, obj=>{
    obj.traverse(c=>{ if (c.isMesh && (!c.material || !c.material.color)) c.material = new THREE.MeshStandardMaterial({color:0xb9c2d6,roughness:0.7}); });
    normalizeModel(obj); registerImported(name,'model',obj);
  }, undefined, err=>toast('OBJ failed: '+name));
}
function loadGLTF(url,name){
  new GLTFLoader().load(url, g=>{ const obj=g.scene; normalizeModel(obj); registerImported(name,'model',obj); },
    undefined, err=>toast('glTF failed: '+name));
}
function loadImage(url,name){
  new THREE.TextureLoader().load(url, tex=>{
    tex.colorSpace = THREE.SRGBColorSpace;
    const ar = (tex.image.width||1)/(tex.image.height||1);
    const h=4, w=h*ar;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w,h),
      new THREE.MeshBasicMaterial({ map:tex, side:THREE.DoubleSide, transparent:true }));
    registerImported(name,'image',mesh,{ });
  }, undefined, ()=>toast('Image failed: '+name));
}
function loadVideo(url,name){
  const v = document.createElement('video');
  v.src=url; v.crossOrigin='anonymous'; v.loop=true; v.muted=false; v.playsInline=true;
  v.addEventListener('loadedmetadata', ()=>{
    const ar = (v.videoWidth||16)/(v.videoHeight||9), h=4, w=h*ar;
    const tex = new THREE.VideoTexture(v); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w,h),
      new THREE.MeshBasicMaterial({ map:tex, side:THREE.DoubleSide }));
    registerImported(name,'video',mesh,{ video:v });
    v.play().catch(()=>{});
  });
}
function loadAudio(url,name){
  const emitter = new THREE.Mesh(new THREE.SphereGeometry(0.4,20,20),
    new THREE.MeshStandardMaterial({ color:0x7c5cff, emissive:0x3a2a80, roughness:0.5 }));
  const sound = new THREE.PositionalAudio(listener);
  new THREE.AudioLoader().load(url, buf=>{
    sound.setBuffer(buf); sound.setRefDistance(3); sound.setLoop(true); sound.setVolume(1);
    emitter.add(sound); sound.play();
  }, undefined, ()=>toast('Audio failed: '+name));
  registerImported(name,'audio',emitter,{ audio:sound });
}

function removeImported(im){
  transform.detach();
  scene.remove(im.object3d);
  if (im.extra.video){ im.extra.video.pause(); im.extra.video.src=''; }
  if (im.extra.audio){ try{ im.extra.audio.stop(); }catch(e){} }
  im.object3d.traverse(c=>{ if (c.geometry) c.geometry.dispose(); if (c.material){ (Array.isArray(c.material)?c.material:[c.material]).forEach(m=>m.dispose&&m.dispose()); } });
  const i = imported.indexOf(im); if (i>=0) imported.splice(i,1);
  selected = null; refreshObjList();
  inspectorEl.innerHTML = '<div class="st-note">Select a body or imported object to inspect and transform it.</div>';
}

/* ---------------------------------------------------------------------------
   9.  Primitives + scene save / load
   ------------------------------------------------------------------------- */
function addPrimitiveMenu(){
  // Accessible in-Studio popup (prompt() is blocked in sandboxed/embedded contexts).
  const existing = root.querySelector('.st-menu');
  if (existing){ existing.remove(); return; }
  const kinds = ['Cube','Sphere','Plane','Cone','Torus'];
  const anchor = root.querySelector('#stAdd');
  const menu = document.createElement('div');
  menu.className = 'st-menu';
  menu.setAttribute('role','menu');
  menu.setAttribute('aria-label','Add primitive');
  const r = anchor ? anchor.getBoundingClientRect() : { left:80, bottom:52 };
  menu.style.left = Math.round(r.left) + 'px';
  menu.style.top = Math.round(r.bottom + 6) + 'px';
  kinds.forEach((k,i)=>{
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = k; b.setAttribute('role','menuitem');
    b.tabIndex = i===0 ? 0 : -1;
    b.addEventListener('click', ()=>{ addPrimitive(k); menu.remove(); });
    menu.appendChild(b);
  });
  root.appendChild(menu);
  const items = [...menu.querySelectorAll('button')];
  items[0].focus();
  menu.addEventListener('keydown', e=>{
    const i = items.indexOf(document.activeElement);
    if (e.key==='ArrowDown'){ e.preventDefault(); items[(i+1)%items.length].focus(); }
    else if (e.key==='ArrowUp'){ e.preventDefault(); items[(i-1+items.length)%items.length].focus(); }
    else if (e.key==='Escape'){ e.preventDefault(); menu.remove(); anchor && anchor.focus(); }
  });
  const off = ev=>{ if (!menu.contains(ev.target) && ev.target!==anchor){ menu.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(()=>document.addEventListener('pointerdown', off, true), 0);
}
function addPrimitive(kind){
  let geo;
  const c = kind.toLowerCase();
  if (c.startsWith('sph')) geo = new THREE.SphereGeometry(1.2,32,32);
  else if (c.startsWith('pla')) geo = new THREE.PlaneGeometry(3,3);
  else if (c.startsWith('con')) geo = new THREE.ConeGeometry(1.2,2.4,32);
  else if (c.startsWith('tor')) geo = new THREE.TorusGeometry(1.2,0.42,20,48);
  else geo = new THREE.BoxGeometry(2,2,2);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color:0x9fb2d6, roughness:0.55, metalness:0.1 }));
  registerImported(kind, 'primitive', mesh, { primitive:c });
}

function serializeScene(){
  return {
    date: simDate.toISOString(),
    camera: { p:camera.position.toArray(), t:orbit.target.toArray() },
    objects: imported.filter(im=>im.type==='primitive').map(im=>({
      name:im.name, kind:im.extra.primitive,
      p:im.object3d.position.toArray(), r:[im.object3d.rotation.x,im.object3d.rotation.y,im.object3d.rotation.z],
      s:im.object3d.scale.x, color:im.object3d.material.color.getHex()
    }))
  };
}
function saveScene(){
  try{ localStorage.setItem('ewi-cosmos-studio', JSON.stringify(serializeScene())); toast('Scene saved to this browser'); }
  catch(e){ toast('Save failed'); }
}
function exportScene(){
  const blob = new Blob([JSON.stringify(serializeScene(),null,2)], {type:'application/json'});
  const a = document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='cosmos-scene.json'; a.click();
}
function loadSavedScene(){
  try{
    const raw = localStorage.getItem('ewi-cosmos-studio'); if (!raw) return;
    const d = JSON.parse(raw);
    if (d.date){ simDate = new Date(d.date); updatePlanets(); }
    (d.objects||[]).forEach(o=>{
      addPrimitive(o.kind||'Cube');
      const im = imported[imported.length-1];
      im.object3d.position.fromArray(o.p); im.object3d.rotation.set(o.r[0],o.r[1],o.r[2]); im.object3d.scale.setScalar(o.s);
      if (o.color!=null) im.object3d.material.color.setHex(o.color);
    });
    if (d.camera){ camera.position.fromArray(d.camera.p); orbit.target.fromArray(d.camera.t); }
    transform.detach(); selected=null; refreshObjList();
  }catch(e){}
}

/* ---------------------------------------------------------------------------
   10.  Keyboard + gamepad
   ------------------------------------------------------------------------- */
function onKey(e){
  if (!open) return;
  const k = e.key.toLowerCase();
  if (k==='escape'){ transform.detach(); selected=null; return; }
  if (k==='w'){ transform.setMode('translate'); }
  else if (k==='e'){ transform.setMode('rotate'); }
  else if (k==='r'){ transform.setMode('scale'); }
  else if (k==='f'){ if (selected?.type==='imported') focusObject(selected.im.object3d); else if (selected?.type==='planet') focusKey(selected.key); }
  else if (k==='delete'||k==='backspace'){ if (selected?.type==='imported') removeImported(selected.im); }
  else if (k===' '){ playing=!playing; playBtn.textContent=playing?'⏸':'▶'; e.preventDefault(); }
  else if (k==='c'){ setCamMode(camMode==='cinematic'?'explore':'cinematic'); }
}

window.addEventListener('gamepadconnected', e=>{ gamepadIndex = e.gamepad.index; toast('Controller connected'); });
window.addEventListener('gamepaddisconnected', ()=>{ gamepadIndex = null; });
let padPrev = {};
function pollGamepad(dt){
  if (gamepadIndex==null || !navigator.getGamepads) return;
  const gp = navigator.getGamepads()[gamepadIndex]; if (!gp) return;
  const dz = v => Math.abs(v)<0.12 ? 0 : v;
  const lx=dz(gp.axes[0]||0), ly=dz(gp.axes[1]||0), rx=dz(gp.axes[2]||0), ry=dz(gp.axes[3]||0);
  if (camMode==='explore'){
    // left stick orbits, right stick dollies/pans
    if (lx||ly){
      const off = camera.position.clone().sub(orbit.target);
      const sph = new THREE.Spherical().setFromVector3(off);
      sph.theta -= lx*dt*1.6; sph.phi = Math.max(0.15, Math.min(Math.PI-0.15, sph.phi + ly*dt*1.4));
      camera.position.copy(orbit.target).add(new THREE.Vector3().setFromSpherical(sph));
    }
    if (ry){ const dir = camera.position.clone().sub(orbit.target).multiplyScalar(1 + ry*dt*1.2); camera.position.copy(orbit.target).add(dir); }
    if (rx){ const right = new THREE.Vector3().crossVectors(camera.up, camera.position.clone().sub(orbit.target)).normalize(); orbit.target.addScaledVector(right, rx*dt*8); }
  }
  // buttons: A(0) cinematic toggle, B(1) deselect, LB(4)/RB(5) cycle selection, X(2) play/pause
  const pressed = i => gp.buttons[i] && gp.buttons[i].pressed;
  const edge = i => { const p=pressed(i); const was=padPrev[i]; padPrev[i]=p; return p && !was; };
  if (edge(0)) setCamMode(camMode==='cinematic'?'explore':'cinematic');
  if (edge(1)){ transform.detach(); selected=null; }
  if (edge(2)){ playing=!playing; playBtn.textContent=playing?'⏸':'▶'; }
  if (edge(5)) cycleSelection(1);
  if (edge(4)) cycleSelection(-1);
}
function cycleSelection(dir){
  if (!imported.length){ // cycle planets
    const keys = PLANETS.map(p=>p.key);
    const cur = selected?.type==='planet' ? keys.indexOf(selected.key) : -1;
    const nx = (cur + dir + keys.length)%keys.length; focusKey(keys[nx]); selectPlanet(keys[nx]); return;
  }
  const cur = selected?.type==='imported' ? imported.indexOf(selected.im) : -1;
  const nx = (cur + dir + imported.length)%imported.length;
  focusObject(imported[nx].object3d); selectImported(imported[nx]);
}

/* ---------------------------------------------------------------------------
   11.  Open / close lifecycle
   ------------------------------------------------------------------------- */
function ensureBuilt(){
  if (built) return;
  buildDOM(); buildScene(); loadSavedScene(); built = true;
}
// The suite's fixed header lane (EWI Home pill + app switcher) would sit above
// the Studio's own toolbar. Hide it while the immersive Studio is open — the
// Studio's Close button returns to the 2D app, where the lane reappears.
const SUITE_CHROME = ['ewi-lane','ewi-home','ewi-sw','ewiThemeBtn','ewi-rh-open'];
let chromePrev = {};
function toggleSuiteChrome(hide){
  for (const id of SUITE_CHROME){
    const el = document.getElementById(id);
    if (!el) continue;
    if (hide){ chromePrev[id] = el.style.display; el.style.display = 'none'; }
    else if (id in chromePrev){ el.style.display = chromePrev[id]; }
  }
}
function openStudio(){
  ensureBuilt();
  open = true;
  root.classList.add('on');
  toggleSuiteChrome(true);
  onResize();
  clock.start();
  // resume audio contexts after the user gesture that opened the studio
  if (listener.context.state==='suspended') listener.context.resume().catch(()=>{});
  if (!raf) animate();
  toast('3D Studio — drag to orbit, or press C for cinematic');
}
function close(){
  open = false; root.classList.remove('on');
  toggleSuiteChrome(false);
  cancelAnimationFrame(raf); raf = 0;
  // pause any playing media to save resources
  imported.forEach(im=>{ if (im.extra.video) im.extra.video.pause(); });
}

/* wire the header button from the 2D app */
function wireOpener(){
  const btn = document.getElementById('studioBtn');
  if (btn) btn.addEventListener('click', openStudio);
}
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', wireOpener);
else wireOpener();

// expose a tiny hook for automated validation
window.__cosmosStudio = { open:openStudio, close, heliocentric, auToScene, PLANETS, EVENTS, get imported(){return imported;} };
