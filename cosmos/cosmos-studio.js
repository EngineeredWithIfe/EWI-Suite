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
// `mass` is in solar masses (M☉) — used by NAVLINQ to weight the gravity-aware
// midpoint (barycenter) of a chosen set of bodies.
const PLANETS = [
  { key:'mercury', name:'Mercury', color:0x9c8b7a, size:0.18, tilt:0.03,  rot:58.6,  mass:1.651e-7,
    el:[0.38709927,0.20563593,7.00497902,252.25032350,77.45779628,48.33076593],
    rate:[0.00000037,0.00001906,-0.00594749,149472.67411175,0.16047689,-0.12534081] },
  { key:'venus',   name:'Venus',   color:0xe8c08a, size:0.30, tilt:177.4, rot:-243,  mass:2.447e-6,
    el:[0.72333566,0.00677672,3.39467605,181.97909950,131.60246718,76.67984255],
    rate:[0.00000390,-0.00004107,-0.00078890,58517.81538729,0.00268329,-0.27769418] },
  { key:'earth',   name:'Earth',   color:0x3f7fd0, size:0.32, tilt:23.44, rot:1,      mass:3.003e-6,
    el:[1.00000261,0.01671123,-0.00001531,100.46457166,102.93768193,0.0],
    rate:[0.00000562,-0.00004392,-0.01294668,35999.37244981,0.32327364,0.0], moon:true },
  { key:'mars',    name:'Mars',    color:0xc1543a, size:0.24, tilt:25.19, rot:1.03,   mass:3.213e-7,
    el:[1.52371034,0.09339410,1.84969142,-4.55343205,-23.94362959,49.55953891],
    rate:[0.00001847,0.00007882,-0.00813131,19140.30268499,0.44441088,-0.29257343] },
  { key:'jupiter', name:'Jupiter', color:0xd8b48a, size:1.05, tilt:3.13,  rot:0.41,   mass:9.543e-4,
    el:[5.20288700,0.04838624,1.30439695,34.39644051,14.72847983,100.47390909],
    rate:[-0.00011607,-0.00013253,-0.00183714,3034.74612775,0.21252668,0.20469106] },
  { key:'saturn',  name:'Saturn',  color:0xe0c59a, size:0.92, tilt:26.73, rot:0.45, ring:true, mass:2.857e-4,
    el:[9.53667594,0.05386179,2.48599187,49.95424423,92.59887831,113.66242448],
    rate:[-0.00125060,-0.00050991,0.00193609,1222.49362201,-0.41897216,-0.28867794] },
  { key:'uranus',  name:'Uranus',  color:0x9fe0e8, size:0.62, tilt:97.77, rot:-0.72,  mass:4.365e-5,
    el:[19.18916464,0.04725744,0.77263783,313.23810451,170.95427630,74.01692503],
    rate:[-0.00196176,-0.00004397,-0.00242939,428.48202785,0.40805281,0.04240589] },
  { key:'neptune', name:'Neptune', color:0x4f6fd6, size:0.60, tilt:28.32, rot:0.67,   mass:5.150e-5,
    el:[30.06992276,0.00859048,1.77004347,-55.12002969,44.96476227,131.78422574],
    rate:[0.00026291,0.00005105,0.00035372,218.45945325,-0.32241464,-0.00508664] },
];

// Curated real + predicted events. `type` drives the visuals; `cat` groups them
// in the picker; `where:[lat,lon]` anchors an event to a point on Earth (a pin
// is dropped there); `focus` frames a specific planet; `link:'trading'` opens the
// EWI Trading Command Center. Confidence is stated honestly in each note: firm
// calendar mechanics (eclipses, expiries) vs. probabilistic/seasonal windows.
const EVENTS = [
  // ── Solar & lunar (exact celestial mechanics) ──
  { date:'2024-04-08', name:'Total solar eclipse — North America', type:'solar', cat:'Solar & lunar', where:[27.5,-99.5], note:'Path swept Mexico → USA → Canada. ~4m28s totality. Geometry is exact.' },
  { date:'2025-09-07', name:'Total lunar eclipse — “Blood Moon”',   type:'lunar', cat:'Solar & lunar', note:'Visible across Asia, Africa, Europe, Oceania. Geometry is exact.' },
  { date:'2026-02-17', name:'Annular solar eclipse — Antarctica',   type:'solar', cat:'Solar & lunar', where:[-72,10], note:'Ring of fire over the Southern Ocean.' },
  { date:'2026-03-03', name:'Total lunar eclipse',                   type:'lunar', cat:'Solar & lunar', note:'Visible from the Pacific, Americas, and East Asia.' },
  { date:'2026-08-12', name:'Total solar eclipse — Arctic & Iberia', type:'solar', cat:'Solar & lunar', where:[42,-3], note:'Greenland, Iceland, and Spain. First European totality since 1999.' },
  { date:'2027-08-02', name:'Total solar eclipse — “Eclipse of the century”', type:'solar', cat:'Solar & lunar', where:[26,32], note:'Up to 6m23s over Egypt, Saudi Arabia, and North Africa.' },
  { date:'2028-07-22', name:'Total solar eclipse — Australia & NZ',  type:'solar', cat:'Solar & lunar', where:[-33.9,151.2], note:'Crosses Sydney; ~5m of totality.' },
  // ── Asteroids ──
  { date:'2029-04-13', name:'Asteroid 99942 Apophis — close approach', type:'asteroid', cat:'Asteroids', note:'Passes ~31,600 km from Earth, inside geostationary orbit. Orbit is well-determined; no impact risk (>99.99%).' },
  // ── Meteor showers (statistical peaks, ~±1 day) ──
  { date:'2026-01-03', name:'Quadrantids meteor shower — peak',      type:'meteor', cat:'Meteor showers', radiant:'Boötes',  note:'Sharp peak; up to ~120 meteors/hr under dark skies.' },
  { date:'2026-08-12', name:'Perseids meteor shower — peak',         type:'meteor', cat:'Meteor showers', radiant:'Perseus', note:'Reliable summer shower; ~100 meteors/hr.' },
  { date:'2026-10-21', name:'Orionids meteor shower — peak',         type:'meteor', cat:'Meteor showers', radiant:'Orion',   note:'Debris from Halley’s Comet; ~20 meteors/hr.' },
  { date:'2026-11-17', name:'Leonids meteor shower — peak',          type:'meteor', cat:'Meteor showers', radiant:'Leo',     note:'Fast meteors; occasional storms.' },
  { date:'2026-12-14', name:'Geminids meteor shower — peak',         type:'meteor', cat:'Meteor showers', radiant:'Gemini',  note:'Best annual shower; up to ~150 meteors/hr.' },
  // ── Space operations (scheduled launch windows / orbital ops) ──
  { date:'2026-01-15', name:'Crewed lunar-class launch window — Kennedy Space Center', type:'space', cat:'Space operations', where:[28.57,-80.65], note:'Scheduled window (subject to range & weather holds). Pin marks the pad.' },
  { date:'2026-03-10', name:'Super-heavy orbital test flight — Starbase, TX', type:'space', cat:'Space operations', where:[25.99,-97.16], note:'Integrated test flight; outcome uncertain by nature of flight testing.' },
  { date:'2026-05-01', name:'Space-station reboost & crew rotation — LEO', type:'space', cat:'Space operations', where:[28.5,-80.6], note:'Routine ISS-class reboost; low-Earth-orbit operations.' },
  { date:'2026-06-20', name:'Satellite constellation launch — Vandenberg SFB', type:'space', cat:'Space operations', where:[34.74,-120.57], note:'Polar-orbit rideshare window.' },
  { date:'2026-09-05', name:'Planned controlled reentry — South Pacific (SPOUA)', type:'space', cat:'Space operations', where:[-43,-125], note:'Deorbit disposal over the uninhabited “spacecraft cemetery”.' },
  // ── Weather & climate (seasonal / model-projected windows) ──
  { date:'2026-06-01', name:'Atlantic hurricane season — statistical onset', type:'weather', cat:'Weather & climate', where:[25,-70], note:'Climatological season start (Jun 1). Individual storms are not predictable this far out.' },
  { date:'2026-09-10', name:'Atlantic hurricane peak-activity window', type:'weather', cat:'Weather & climate', where:[24,-84], note:'Climatological peak (~Sep 10 ±weeks). Elevated basin-wide probability.' },
  { date:'2026-07-15', name:'Northern-hemisphere heat-wave risk window', type:'weather', cat:'Weather & climate', where:[40,-3], note:'Model-projected elevated risk; ~60–80% likelihood of ≥1 major event, region-dependent.' },
  { date:'2026-04-10', name:'South-Asia monsoon flood-risk window', type:'weather', cat:'Weather & climate', where:[22,80], note:'Pre-monsoon onset; flood risk rises through the season.' },
  // ── Geophysical (probabilistic hazard windows — NOT deterministic) ──
  { date:'2026-02-01', name:'Pacific “Ring of Fire” — elevated seismic-risk window', type:'geo', cat:'Geophysical', where:[36,140], note:'Probabilistic hazard, not a prediction of a specific quake. Earthquakes cannot be predicted to the day (state of the science).' },
  { date:'2026-05-15', name:'Cascadia tsunami-preparedness scenario', type:'geo', cat:'Geophysical', where:[45,-124], note:'Planning scenario for a megathrust event; long-term probability, not a forecast.' },
  // ── Markets (connect to the EWI Trading Command Center) ──
  { date:'2026-01-02', name:'Markets open — link to EWI Trading Command Center', type:'market', cat:'Markets', link:'trading', note:'Open the EWI Trading Command Center for live market context, journaling, and automation.' },
  { date:'2026-03-20', name:'Quarterly “triple-witching” options expiry', type:'market', cat:'Markets', link:'trading', note:'Index futures & options expire together — elevated volume/volatility. Firm calendar date.' },
  { date:'2026-06-19', name:'Mid-year index rebalancing window', type:'market', cat:'Markets', link:'trading', note:'Scheduled reconstitution flows; higher turnover near the close.' },
  // ── Planetary (non-Earth reactions — chemistry/physics, no biology) ──
  { date:'2026-04-03', name:'Jupiter–Io flux-tube aurora activity', type:'planetary', cat:'Planetary (non-Earth)', focus:'jupiter', note:'Io’s volcanism feeds a plasma torus; magnetospheric currents drive Jovian aurorae.' },
  { date:'2026-07-01', name:'Mars global dust-storm season onset', type:'planetary', cat:'Planetary (non-Earth)', focus:'mars', note:'Perihelion-season heating lifts dust; storms can grow to planet-encircling scale.' },
  { date:'2026-10-15', name:'Saturn ring-plane viewing geometry', type:'planetary', cat:'Planetary (non-Earth)', focus:'saturn', note:'Ring tilt relative to the Sun/observer changes the illumination geometry.' },
  // ── Deep time — cosmic PAST (observed / dated evidence) ──
  // These epochs sit outside the orbital-date model, so they carry a symbolic
  // `epoch` label and a `conf` basis rather than a calendar date. Timescales are
  // the current scientific consensus with honest uncertainty — no false precision.
  { epoch:'13.8 Gyr ago', name:'The Big Bang — spacetime begins', type:'cosmic', cat:'Deep time — cosmic past', cosmic:true, conf:'established', note:'Age of the observable Universe: 13.787 ± 0.020 Gyr (Planck 2018, ΛCDM). The hot dense beginning of space, time, matter, and energy — anchored by the cosmic microwave background, light-element abundances, and cosmic expansion.' },
  { epoch:'≈ 380,000 yr after t₀', name:'Recombination — the Universe turns transparent', type:'cosmic', cat:'Deep time — cosmic past', cosmic:true, conf:'established', note:'At ~3,000 K, electrons and protons combined into neutral hydrogen; light decoupled and streams to us today as the cosmic microwave background (T ≈ 2.725 K). Directly measured by COBE, WMAP, and Planck.' },
  { epoch:'≈ 100–400 Myr after t₀', name:'Cosmic Dawn — the first stars ignite', type:'cosmic', cat:'Deep time — cosmic past', cosmic:true, conf:'empirical', note:'Population III stars end the “cosmic dark ages.” The exact onset is being refined; JWST now observes luminous galaxies within ~300–400 Myr of the Big Bang, tightening the range.' },
  { epoch:'≈ 4.568 Gyr ago', name:'The Solar System forms', type:'cosmic', cat:'Deep time — cosmic past', cosmic:true, focus:'sun', conf:'established', note:'Collapse of a molecular-cloud fragment; the oldest solids (calcium-aluminium inclusions) are dated to 4.568 ± 0.001 Gyr by radiometric (Pb-Pb) methods. The Sun is a third-generation star.' },
  { epoch:'≈ 4.51 Gyr ago', name:'Moon-forming giant impact', type:'cosmic', cat:'Deep time — cosmic past', cosmic:true, focus:'earth', conf:'empirical', note:'A Mars-sized body (“Theia”) struck the proto-Earth; debris coalesced into the Moon. Supported by lunar isotope ratios and dynamics, though impact details remain modeled.' },
  // ── Deep time — cosmic PRESENT (measured now) ──
  { epoch:'today · Sun age ≈ 4.6 Gyr', name:'The Sun at mid-main-sequence', type:'cosmic', cat:'Deep time — cosmic present', cosmic:true, focus:'sun', conf:'established', note:'The Sun fuses hydrogen steadily and brightens ~1% every ~110 Myr. It is roughly halfway through its ~10–11 Gyr main-sequence lifetime — a well-modeled, stable present.' },
  { epoch:'now · closing ~110 km/s', name:'Andromeda approaches the Milky Way', type:'cosmic', cat:'Deep time — cosmic present', cosmic:true, conf:'empirical', note:'M31’s measured blueshift shows it moving toward us; Gaia proper motions constrain a likely future encounter. The Local Group is gravitationally bound against cosmic expansion.' },
  // ── Deep time — cosmic FUTURE (physics-grounded projections; trillions of years+) ──
  { epoch:'≈ +1.1 Gyr', name:'Earth’s biosphere under a brightening Sun', type:'cosmic', cat:'Deep time — cosmic future', cosmic:true, focus:'earth', conf:'empirical', note:'Rising solar luminosity is projected to push Earth past a moist-greenhouse threshold in ~1 Gyr, ending the long-term carbon–silicate habitability window. Grounded in stellar evolution + climate models.' },
  { epoch:'≈ +4.5 Gyr', name:'Milky Way–Andromeda first passage', type:'cosmic', cat:'Deep time — cosmic future', cosmic:true, conf:'empirical', note:'The galaxies begin to merge into “Milkomeda.” Stars almost never collide (space is vast); orbits are reshuffled. Timing carries ~±1 Gyr from transverse-velocity uncertainty.' },
  { epoch:'≈ +5–5.4 Gyr', name:'The Sun swells into a red giant', type:'cosmic', cat:'Deep time — cosmic future', cosmic:true, focus:'sun', conf:'established', note:'Core hydrogen exhausts; the Sun expands ~200×, likely engulfing Mercury and Venus and scorching Earth. A robust result of stellar-structure physics.' },
  { epoch:'≈ +7–8 Gyr', name:'The Sun becomes a white dwarf', type:'cosmic', cat:'Deep time — cosmic future', cosmic:true, focus:'sun', conf:'established', note:'After shedding a planetary nebula, the Sun leaves an Earth-sized, carbon-oxygen ember that slowly cools over tens of billions of years. Standard low-mass stellar endpoint.' },
  { epoch:'≈ +10¹⁴ yr (100 trillion yr)', name:'End of the Stelliferous Era', type:'cosmic', cat:'Deep time — cosmic future', cosmic:true, conf:'empirical', note:'Star formation ceases as galaxies exhaust cold gas; the last, longest-lived red dwarfs fade. The Universe dims from starlight to embers. Model-based (Adams & Laughlin) with wide but principled bounds.' },
  { epoch:'≈ +10¹⁵–10²⁰ yr', name:'Degenerate Era — remnants and rogue worlds', type:'cosmic', cat:'Deep time — cosmic future', cosmic:true, conf:'empirical', note:'Only white dwarfs, neutron stars, brown dwarfs, and black holes remain. Gravitational encounters eject most planets and stars from galaxies; rare brown-dwarf collisions briefly rekindle fusion.' },
  { epoch:'≈ +10³⁴–10³⁹ yr (if protons decay)', name:'Matter itself dissolves', type:'cosmic', cat:'Deep time — cosmic future', cosmic:true, conf:'speculative', note:'IF protons are unstable (predicted by some Grand Unified Theories but never observed; experiments set lifetimes > ~10³⁴ yr), ordinary matter slowly evaporates into radiation and light particles. Conditional on unconfirmed physics.' },
  { epoch:'≈ +10⁴⁰ yr', name:'Black Hole Era', type:'cosmic', cat:'Deep time — cosmic future', cosmic:true, conf:'speculative', note:'If baryonic matter has decayed, black holes are the last macroscopic structures — slowly bleeding mass as Hawking radiation. Rests on proton decay plus semiclassical gravity.' },
  { epoch:'≈ +10¹⁰⁰ yr', name:'The last black holes evaporate', type:'cosmic', cat:'Deep time — cosmic future', cosmic:true, conf:'speculative', note:'Supermassive black holes finish evaporating around a googol years via Hawking radiation — an established mechanism extrapolated across almost unimaginable time. The cosmos approaches a thin, cold bath of particles.' },
  { epoch:'≈ +10¹⁰⁰ yr and beyond', name:'Heat Death — maximum entropy', type:'cosmic', cat:'Deep time — cosmic future', cosmic:true, conf:'speculative', note:'Under an eternally accelerating (de Sitter) expansion, the Universe trends toward uniform, near-zero-temperature equilibrium where no work is possible. Anchored in the 2nd law of thermodynamics; the ultimate fate hinges on the still-uncertain nature of dark energy.' },
  { epoch:'≈ +10^(10⁷⁶) yr', name:'Poincaré recurrence (theoretical horizon)', type:'cosmic', cat:'Deep time — cosmic future', cosmic:true, conf:'speculative', note:'On timescales far beyond the heat death, statistical fluctuations could — in principle — momentarily revisit an ordered state. A boundary-of-physics thought experiment, not a prediction. Marked explicitly as speculative.' },
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
let cineFocusOn = false;                      // cinematic sub-mode: true = locked on one body
let cineFocusId = null;                        // id of the focused body of mass
const cineHist = [];                           // focus history for the ← (back) neighbour step
let gamepadIndex = null;
let idSeq = 1;

// NAVLINQ — gravity-weighted midpoint of a chosen set of bodies
let navMode = false;
const navSel = new Set();                     // planet keys
let navGroup = null;                          // THREE.Group: links + midpoint marker
// Real-time tracking (Task 3)
let realtime = false;
let cineLastInput = 0;                         // ms — recent user camera input pauses auto-direction
const earthPins = [];                         // { group } dropped onto Earth's surface
let rebootTimer = 0, rebootCount = 0;         // resilience: animation-loop auto-recovery

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
  .st-home{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 12px 0 8px;border-radius:9px;
    border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#e8ecf6;font-weight:700;
    font-size:12.5px;text-decoration:none;white-space:nowrap;transition:background .15s,border-color .15s}
  .st-home:hover{background:rgba(124,92,255,.16);border-color:rgba(124,92,255,.5)}
  .st-home .g{width:24px;height:24px;border-radius:7px;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(180deg,#7c5cff,#5a3fd6);color:#fff;font-size:13px}
  .st-cine{position:absolute;left:50%;top:60px;transform:translateX(-50%);z-index:6;display:none;align-items:center;gap:6px;
    background:rgba(12,14,24,.86);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:6px 8px}
  .st-cine button{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#e8ecf6;
    height:30px;min-width:32px;padding:0 10px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
    display:inline-flex;align-items:center;justify-content:center;gap:5px;transition:background .15s,border-color .15s}
  .st-cine button:hover{background:rgba(124,92,255,.18);border-color:rgba(124,92,255,.5)}
  .st-cine button.on{background:linear-gradient(180deg,#7c5cff,#5a3fd6);border-color:transparent;color:#fff}
  .st-cine .nm{font-size:12px;color:#c6cde0;min-width:98px;text-align:center;font-weight:600}
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
  }

  /* ---- Deep-nav: non-modal floating panels (Apple-esque) ---- */
  .dn-panel{position:absolute;z-index:12;width:268px;background:rgba(14,16,26,.72);
    -webkit-backdrop-filter:saturate(1.4) blur(22px);backdrop-filter:saturate(1.4) blur(22px);
    border:1px solid rgba(255,255,255,.12);border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.55);
    color:#e8ecf6;overflow:hidden;display:none;user-select:none;transition:box-shadow .2s}
  .dn-panel.on{display:block}
  .dn-panel.drag{box-shadow:0 26px 74px rgba(0,0,0,.66)}
  .dn-head{display:flex;align-items:center;gap:8px;padding:9px 11px;cursor:grab;
    background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,0));border-bottom:1px solid rgba(255,255,255,.08)}
  .dn-head:active{cursor:grabbing}
  .dn-title{font-size:12px;font-weight:700;letter-spacing:-.01em;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .dn-ico{width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(180deg,#7c5cff,#5a3fd6);font-size:12px;flex:none}
  .dn-op{width:64px;accent-color:#7c5cff;height:14px}
  .dn-x{width:22px;height:22px;border-radius:6px;border:0;background:rgba(255,255,255,.06);color:#c6cde0;
    font-size:13px;cursor:pointer;flex:none}
  .dn-x:hover{background:rgba(255,90,90,.3)}
  .dn-body{padding:11px 12px;font-size:12.5px}
  .dn-body label{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#9aa3bd;margin:0 0 4px}
  .dn-in{width:100%;box-sizing:border-box;background:rgba(0,0,0,.36);border:1px solid rgba(255,255,255,.14);
    color:#fff;border-radius:9px;padding:8px 10px;font-size:13px;font-variant-numeric:tabular-nums;outline:none}
  .dn-in:focus{border-color:rgba(124,92,255,.7)}
  .dn-hint{font-size:10.5px;color:#8b93ad;margin-top:6px;line-height:1.4}
  .dn-read{margin-top:9px;padding:8px 10px;background:rgba(124,92,255,.12);border:1px solid rgba(124,92,255,.4);
    border-radius:9px;font-size:11.5px;line-height:1.45;color:#dfe4f2}
  .dn-read b{color:#fff}
  .dn-slider{width:100%;accent-color:#7c5cff;margin:6px 0 2px}
  .dn-rowbtn{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
  .dn-mini{appearance:none;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#e8ecf6;
    padding:5px 9px;border-radius:8px;font-size:11.5px;cursor:pointer}
  .dn-mini:hover{background:rgba(124,92,255,.22);border-color:rgba(124,92,255,.55)}
  .dn-mini.on{background:linear-gradient(180deg,#7c5cff,#5a3fd6);border-color:transparent;color:#fff}
  .dn-gizmo{display:block;width:100%;height:150px;border-radius:11px;background:radial-gradient(circle at 50% 40%,rgba(30,36,60,.6),rgba(6,8,16,.6));border:1px solid rgba(255,255,255,.08)}
  .dn-hud{position:absolute;left:12px;bottom:64px;z-index:6;pointer-events:none;
    background:rgba(12,14,24,.62);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
    border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:9px 12px;font-size:11px;
    line-height:1.5;color:#c6cde0;max-width:230px;font-variant-numeric:tabular-nums;display:none}
  .dn-hud.on{display:block}
  .dn-hud b{color:#fff}
  .dn-hud .phase{display:inline-block;padding:1px 7px;border-radius:20px;font-weight:700;font-size:10px;margin-left:4px}
  .dn-tip{position:absolute;z-index:11;pointer-events:none;transform:translate(-50%,-140%);
    background:rgba(12,14,24,.88);border:1px solid rgba(255,255,255,.16);border-radius:8px;
    padding:4px 9px;font-size:11px;color:#fff;white-space:nowrap;display:none;box-shadow:0 6px 20px rgba(0,0,0,.5)}
  .dn-flrow{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:7px}
  .dn-stops{font-size:11px;color:#9aa3bd;margin-top:2px}
  .nv-grp-lbl{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#8892ac;margin:8px 0 4px}
  .nv-wrap{display:flex;flex-wrap:wrap;gap:5px}
  .nv-chip{font:600 11px -apple-system,system-ui,sans-serif;color:#c6cde0;background:rgba(255,255,255,.05);
    border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:4px 10px;cursor:pointer;transition:all .14s ease}
  .nv-chip:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.22)}
  .nv-chip.sel{background:rgba(124,92,255,.28);border-color:#7c5cff;color:#fff;box-shadow:0 0 0 1px rgba(124,92,255,.4) inset}`;
  document.head.appendChild(s);
}

/* ---- DOM scaffold ---- */
function buildDOM(){
  injectCSS();
  root = document.createElement('div'); root.id = 'studioRoot';
  root.innerHTML = `
    <div class="st-bar">
      <a class="st-home" id="stHome" href="https://engineeredwithife.github.io/EWI-Suite/" title="Back to EWI Home" aria-label="EWI Home"><span class="g">⌂</span> EWI&nbsp;Home</a>
      <div class="brand"><span class="m">◈</span> EWI&nbsp;Cosmos <span style="opacity:.6;font-weight:600">· 3D Studio</span></div>
      <div class="st-seg" role="group" aria-label="Camera">
        <button class="st-btn on" id="stExplore" title="Orbit / pan / zoom">🖱 <span class="lbl">Explore</span></button>
        <button class="st-btn" id="stCine" title="Auto-directed cinematic camera">🎬 <span class="lbl">Cinematic</span></button>
      </div>
      <div class="grow"></div>
      <button class="st-btn ghost" id="stAdd" title="Add a primitive">＋ <span class="lbl">Add</span></button>
      <button class="st-btn ghost" id="stImport" title="Import a model, image, video, or audio">⬆ <span class="lbl">Import</span></button>
      <button class="st-btn ghost" id="stNav" title="NAVLINQ — pick 2+ bodies to compute their gravity-weighted midpoint" aria-pressed="false">◎ <span class="lbl">NAVLINQ</span></button>
      <button class="st-btn ghost" id="stLoc" title="Drop a pin at your real-world location on Earth">📍 <span class="lbl">Location</span></button>
      <button class="st-btn ghost on" id="dnPins" title="Toggle waypoint thumbtacks" aria-pressed="true">📌 <span class="lbl">Pins</span></button>
      <button class="st-btn ghost" id="dnZoom" title="Precision zoom — type a distance, %, or scale">🔍 <span class="lbl">Zoom</span></button>
      <button class="st-btn ghost" id="dnCoord" title="Latitude / Longitude · X·Y·Z viewing card">🧭 <span class="lbl">Coordinates</span></button>
      <button class="st-btn ghost" id="dnFlights" title="Flight tracker — plan and fly routes">✈ <span class="lbl">Flights</span></button>
      <select class="st-btn ghost" id="stEvent" title="Jump to a real or predicted event" style="max-width:230px"></select>
      <button class="st-btn ghost" id="stSave" title="Save scene to this browser">💾 <span class="lbl">Save</span></button>
      <button class="st-btn ghost" id="stExport" title="Export scene as a file">⇩ <span class="lbl">Export</span></button>
      <div class="st-seg" role="group" aria-label="Render style" style="margin-left:2px">
        <button class="st-btn" id="stView2d" title="Back to the 2D physics sandbox">◫ <span class="lbl">2D</span></button>
        <button class="st-btn on" id="stView3d" title="3D cinematic studio" aria-pressed="true">◈ <span class="lbl">3D</span></button>
      </div>
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
    <div class="dn-hud" id="dnHud"></div>
    <div class="dn-tip" id="dnTip"></div>

    <div class="st-cine" id="stCineDock">
      <button id="stCineAuto" class="on" title="Auto-directed cinematic camera">🎬 Auto</button>
      <button id="stCinePrev" title="Nearest neighbouring body — back">←</button>
      <span class="nm" id="stCineName">Auto-directed</span>
      <button id="stCineNext" title="Nearest neighbouring body — next">→</button>
      <button id="stCineFocus" title="Focus the selected body (or nearest body)">◎ Focus</button>
    </div>

    <div class="st-time">
      <input type="date" id="stDate" value="2026-08-17" aria-label="Simulation date" />
      <button class="st-btn" id="stPlay" title="Play / pause">⏸</button>
      <input type="range" id="stSpeed" min="0" max="8" step="1" value="3" aria-label="Time speed" />
      <span id="stSpeedLbl" style="font-size:11.5px;color:#9aa3bd;min-width:64px">5 d/s</span>
      <button class="st-btn" id="stNow" title="Track real time, starting now" aria-pressed="false">🕒 <span class="lbl">Real-time</span></button>
      <select class="st-btn ghost" id="stRatio" title="Real-time compression ratio" style="max-width:150px" disabled>
        <option value="1">1 s = 1 s (real time)</option>
        <option value="60">1 s = 1 min</option>
        <option value="3600" selected>1 s = 1 hr</option>
        <option value="21600">1 s = 6 hr</option>
        <option value="86400">1 s = 1 day</option>
      </select>
      <span id="stLocal" style="font-size:11px;color:#9aa3bd;font-variant-numeric:tabular-nums" aria-live="off"></span>
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

  // event dropdown — grouped by category
  const sel = root.querySelector('#stEvent');
  const cats = [];
  EVENTS.forEach((e,i)=>{ let g=cats.find(c=>c.cat===(e.cat||'Events')); if(!g){ g={cat:e.cat||'Events', items:[]}; cats.push(g); } g.items.push(i); });
  sel.innerHTML = '<option value="">Jump to an event…</option>' +
    cats.map(g=>`<optgroup label="${g.cat}">`+
      g.items.map(i=>`<option value="${i}">${EVENTS[i].date || EVENTS[i].epoch} · ${EVENTS[i].name}</option>`).join('')+
      `</optgroup>`).join('');
  sel.addEventListener('change', ()=>{ if (sel.value!=='') jumpToEvent(+sel.value); });

  // wiring
  root.querySelector('#stView2d').addEventListener('click', close);
  camBtnExp.addEventListener('click', ()=>setCamMode('explore'));
  camBtnCine.addEventListener('click', ()=>setCamMode('cinematic'));
  root.querySelector('#stCineAuto').addEventListener('click', cineAuto);
  root.querySelector('#stCinePrev').addEventListener('click', ()=>cineStep(-1));
  root.querySelector('#stCineNext').addEventListener('click', ()=>cineStep(1));
  root.querySelector('#stCineFocus').addEventListener('click', cineFocusSelected);
  root.querySelector('#stAdd').addEventListener('click', addPrimitiveMenu);
  root.querySelector('#stImport').addEventListener('click', ()=>root.querySelector('#stFile').click());
  root.querySelector('#stFile').addEventListener('change', e=>{ handleFiles(e.target.files); e.target.value=''; });
  root.querySelector('#stNav').addEventListener('click', toggleNavMode);
  root.querySelector('#stLoc').addEventListener('click', dropMyLocation);
  root.querySelector('#dnPins').addEventListener('click', ()=>dnTogglePins());
  root.querySelector('#dnZoom').addEventListener('click', ()=>dnPanel('zoom').toggle());
  root.querySelector('#dnCoord').addEventListener('click', ()=>dnPanel('coord').toggle());
  root.querySelector('#dnFlights').addEventListener('click', ()=>dnPanel('flights').toggle());
  root.querySelector('#stSave').addEventListener('click', saveScene);
  root.querySelector('#stExport').addEventListener('click', exportScene);
  playBtn.addEventListener('click', ()=>{ setRealtime(false); playing=!playing; playBtn.textContent = playing?'⏸':'▶'; });
  dateInput.addEventListener('change', ()=>{ setRealtime(false); simDate = new Date(dateInput.value+'T00:00:00Z'); updatePlanets(); });
  const SPD=[0,1,2,5,15,45,120,365,1460];
  speedInput.addEventListener('input', ()=>{ setRealtime(false); timeScale=SPD[+speedInput.value]; root.querySelector('#stSpeedLbl').textContent = timeScale+' d/s'; });
  root.querySelector('#stNow').addEventListener('click', ()=>setRealtime(!realtime));
  root.querySelector('#stRatio').addEventListener('change', ()=>{ if (realtime) applyRealtimeRatio(); });

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
  // logarithmicDepthBuffer keeps sub-metre surface detail and light-year-scale
  // vistas both crisp in the same frame — essential for the deep-zoom envelope.
  renderer = new THREE.WebGLRenderer({ antialias:true, powerPreference:'high-performance', logarithmicDepthBuffer:true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.inset = '0';
  root.insertBefore(renderer.domElement, root.firstChild);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060d);

  // Near clip pushed to sub-millimetre and far clip to interstellar scale; the
  // logarithmic depth buffer makes this enormous range render without z-fighting.
  camera = new THREE.PerspectiveCamera(52, 1, 1e-5, 6.0e7);
  camera.position.set(0, 26, 52);
  listener = new THREE.AudioListener(); camera.add(listener);

  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true; orbit.dampingFactor = 0.08;
  // Deep-zoom envelope: from just above a body's surface (sub-thousandth of a
  // scene unit) out to neighbouring-star distances. The custom dolly clamps to these.
  orbit.maxDistance = 5.0e6; orbit.minDistance = 6e-4;
  // Native wheel dolly is a hard per-event step (no inertia) which reads as
  // stiff/gimmicky. We replace it with a smooth, cursor-anchored, log-space
  // glide (onWheelDolly / tickDolly3D). Damping stays on for orbit + pan feel.
  orbit.enableZoom = false;
  orbit.zoomToCursor = true;   // (used only if native zoom is ever re-enabled)

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
    new THREE.SphereGeometry(3, 96, 64),
    new THREE.MeshBasicMaterial({ color:0xffcf6b, map:makeSunTexture() })
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
  // Cinematic yields to the user: any manual steering pauses auto-direction.
  const markInput = ()=>{ cineLastInput = performance.now(); };
  renderer.domElement.addEventListener('pointerdown', markInput);
  renderer.domElement.addEventListener('wheel', markInput, { passive:true });
  renderer.domElement.addEventListener('wheel', onWheelDolly, { passive:false });
  // Resilience: recover gracefully from a lost/restored WebGL context.
  renderer.domElement.addEventListener('webglcontextlost', e=>{ e.preventDefault(); playing=false; cancelAnimationFrame(raf); raf=0; toast('Graphics context lost — recovering…'); });
  renderer.domElement.addEventListener('webglcontextrestored', ()=>{ if (open && !raf){ try{ clock.start(); }catch(err){} animate(); } });
  window.addEventListener('keydown', onKey);
  initDeepNav();
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

/* ---------------------------------------------------------------------------
   Procedural planetary surfaces (offline, deterministic).
   Value-noise fBm painted onto an equirectangular canvas + a matching height
   (bump) map, so every body resolves believable surface detail under the
   deep-zoom envelope with zero network assets. Seeded per body → stable frame
   to frame and reproducible across sessions (observability/determinism).
--------------------------------------------------------------------------- */
function _hashStr(s){ let h=2166136261>>>0; for (let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function _mulberry32(a){ return function(){ a|=0; a=(a+0x6D2B79F5)|0; let t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
function _valueNoise2D(seed){
  const G=64, grid=new Float32Array(G*G), rnd=_mulberry32(seed);
  for (let i=0;i<G*G;i++) grid[i]=rnd();
  return (x,y)=>{                                  // x tiles seamlessly in [0,1)
    const fx=x*G, fy=y*G; let x0=Math.floor(fx), y0=Math.floor(fy);
    const tx=fx-x0, ty=fy-y0; x0=((x0%G)+G)%G; y0=Math.max(0,Math.min(G-1,y0));
    const x1=(x0+1)%G, y1=Math.min(G-1,y0+1);
    const sx=tx*tx*(3-2*tx), sy=ty*ty*(3-2*ty);
    const a=grid[y0*G+x0], b=grid[y0*G+x1], c=grid[y1*G+x0], d=grid[y1*G+x1];
    return (a*(1-sx)+b*sx)*(1-sy)+(c*(1-sx)+d*sx)*sy;
  };
}
function _fbm(n,x,y,oct){ let v=0,amp=0.5,f=1,s=0; for (let i=0;i<oct;i++){ v+=amp*n((x*f)%1,Math.min(0.9999,y*f)); s+=amp; f*=2; amp*=0.5; } return v/s; }
function _planetClass(p){
  if (p.key==='jupiter'||p.key==='saturn') return 'giant';
  if (p.key==='uranus'||p.key==='neptune') return 'ice';
  if (p.key==='earth') return 'terran';
  if (p.key==='mars')  return 'mars';
  if (p.key==='venus') return 'venus';
  return 'rocky';                                  // Mercury + generic
}
function _mix(a,b,t){ return { r:a.r+(b.r-a.r)*t, g:a.g+(b.g-a.g)*t, b:a.b+(b.b-a.b)*t }; }
function makePlanetTextures(p){
  const W=512, H=256, cs=THREE.SRGBColorSpace;
  const cC=document.createElement('canvas'); cC.width=W; cC.height=H;
  const cB=document.createElement('canvas'); cB.width=W; cB.height=H;
  const cx=cC.getContext('2d'), bx=cB.getContext('2d');
  const iC=cx.createImageData(W,H), iB=bx.createImageData(W,H), dC=iC.data, dB=iB.data;
  const n=_valueNoise2D(_hashStr(p.key)), n2=_valueNoise2D(_hashStr(p.key+'~b'));
  const cls=_planetClass(p), base=new THREE.Color(p.color);
  const bo={r:base.r,g:base.g,b:base.b};
  const dark=_mix(bo,{r:0,g:0,b:0},0.45), lite=_mix(bo,{r:1,g:1,b:1},0.35);
  for (let y=0;y<H;y++){
    const v=y/H, lat=(v-0.5)*Math.PI, polar=Math.pow(Math.abs(Math.sin(lat)),3);
    for (let x=0;x<W;x++){
      const u=x/W; let c, h;
      if (cls==='giant'){
        const turb=(_fbm(n,u,v,5)-0.5)*0.22;
        const band=0.5+0.5*Math.sin((v+turb)*Math.PI*11);
        c=_mix(dark,lite,band); h=0.35+band*0.25;
      } else if (cls==='ice'){
        const turb=(_fbm(n,u,v,4)-0.5)*0.12;
        const band=0.5+0.5*Math.sin((v+turb)*Math.PI*5);
        c=_mix(dark,lite,0.35+band*0.5); h=0.4+band*0.15;
      } else if (cls==='terran'){
        const e=_fbm(n,u,v,6); const sea=e<0.5;
        if (sea){ c=_mix({r:0.03,g:0.16,b:0.4},{r:0.05,g:0.32,b:0.62},e*2); h=0.25; }
        else { const land=(e-0.5)*2; c=_mix({r:0.16,g:0.42,b:0.16},{r:0.5,g:0.42,b:0.26},land); h=0.5+land*0.4; }
        const ice=Math.max(0,polar-0.55)*2.2; c=_mix(c,{r:0.92,g:0.95,b:1},Math.min(1,ice)); if(ice>0)h=Math.max(h,0.55);
      } else if (cls==='mars'){
        const e=_fbm(n,u,v,6), m=_fbm(n2,u,v,4);
        c=_mix({r:0.55,g:0.25,b:0.13},{r:0.8,g:0.45,b:0.28},e); c=_mix(c,{r:0.35,g:0.16,b:0.1},Math.max(0,m-0.55));
        h=0.35+e*0.5;
        const ice=Math.max(0,polar-0.7)*3; c=_mix(c,{r:0.95,g:0.95,b:0.98},Math.min(1,ice));
      } else if (cls==='venus'){
        const s=_fbm(n,u*1.5,v,5);
        c=_mix({r:0.72,g:0.58,b:0.32},{r:0.95,g:0.86,b:0.6},s); h=0.4+s*0.15;
      } else {                                       // rocky / cratered
        const e=_fbm(n,u,v,6), cr=_fbm(n2,u*2,v*2,3);
        c=_mix(dark,lite,e); c=_mix(c,dark,Math.pow(Math.max(0,cr-0.62)*2.6,1.5));
        h=0.3+e*0.6;
      }
      const i=(y*W+x)*4;
      dC[i]=Math.max(0,Math.min(255,c.r*255)); dC[i+1]=Math.max(0,Math.min(255,c.g*255)); dC[i+2]=Math.max(0,Math.min(255,c.b*255)); dC[i+3]=255;
      const hv=Math.max(0,Math.min(255,h*255)); dB[i]=dB[i+1]=dB[i+2]=hv; dB[i+3]=255;
    }
  }
  cx.putImageData(iC,0,0); bx.putImageData(iB,0,0);
  const tC=new THREE.CanvasTexture(cC); tC.colorSpace=cs; tC.anisotropy=4;
  const tB=new THREE.CanvasTexture(cB); tB.anisotropy=4;
  return { color:tC, bump:tB };
}

function buildPlanet(p){
  const group = new THREE.Group(); group.name = p.name; scene.add(group);
  const tex = makePlanetTextures(p);
  const mat = new THREE.MeshStandardMaterial({ map:tex.color, bumpMap:tex.bump, bumpScale:p.size*0.05,
    roughness:(_planetClass(p)==='terran'?0.7:0.92), metalness:0.02 });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(p.size, 96, 64), mat);
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
    const mtex = makePlanetTextures({ key:'moon', color:0xbfbfbf });
    const mmesh = new THREE.Mesh(new THREE.SphereGeometry(0.09,64,48),
      new THREE.MeshStandardMaterial({ map:mtex.color, bumpMap:mtex.bump, bumpScale:0.006, roughness:0.98 }));
    mmesh.name = 'Moon'; mmesh.userData.planet = 'moon';
    pivot.add(mmesh);
    moon = { pivot, mesh:mmesh };
  }
}

function makeSunTexture(){
  const W=512,H=256, cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const ctx=cv.getContext('2d'), img=ctx.createImageData(W,H), d=img.data;
  const n=_valueNoise2D(_hashStr('sol'));
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){
    const g=_fbm(n,x/W,y/H,5);
    const i=(y*W+x)*4;
    d[i]=Math.min(255,220+g*60); d[i+1]=Math.min(255,150+g*90); d[i+2]=Math.min(255,40+g*70); d[i+3]=255;
  }
  ctx.putImageData(img,0,0);
  const t=new THREE.CanvasTexture(cv); t.colorSpace=THREE.SRGBColorSpace; return t;
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
  // Non-restrictive cinematic: if the user is actively steering (recent orbit
  // drag or wheel), yield full control and don't auto-cut. Auto-direction
  // resumes a few seconds after the user lets go.
  if (performance.now() - cineLastInput < 4000) return;
  // Focus sub-mode: lock onto one chosen body of mass and glide around it,
  // instead of the auto-director cutting between bodies.
  if (cineFocusOn && cineFocusId){ cineTickFocus(dt); return; }
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

/* ---- Cinematic focus: lock onto one body of mass, hop to nearest neighbours ----
   The ←/→ controls jump to the closest neighbouring body of mass by true 3D
   world-space distance (omnidirectional): → walks a nearest-neighbour chain
   outward while ← retraces it via a small history stack. "Auto" hands control
   back to the auto-directed cinematic camera. */
const _cineA = new THREE.Vector3();
const _cineB = new THREE.Vector3();
const _cineSize = new THREE.Vector3();

function cineFocusList(){
  const ids = [];
  if (sun) ids.push('sun');
  for (const p of PLANETS) if (planetMeshes[p.key]) ids.push(p.key);
  if (moon) ids.push('moon');
  for (const im of imported) ids.push(im.id);
  return ids;
}
function cineCenterOf(id, out){
  if (id==='sun' && sun){ sun.getWorldPosition(out); return 3; }
  if (id==='moon' && moon){ moon.mesh.getWorldPosition(out); return 0.6; }
  if (planetMeshes[id]){ planetMeshes[id].group.getWorldPosition(out); return (PLANETS.find(p=>p.key===id)?.size||1); }
  const im = imported.find(x=>x.id===id);
  if (im){ const b = new THREE.Box3().setFromObject(im.object3d); b.getCenter(out); return (b.getSize(_cineSize).length()*0.5)||1; }
  return -1;
}
function cineName(id){
  if (id==='sun') return 'Sun';
  if (id==='moon') return 'Moon';
  const p = PLANETS.find(x=>x.key===id); if (p) return p.name;
  const im = imported.find(x=>x.id===id); if (im) return im.name;
  return '—';
}
function cineNearestOther(id, exclude){
  if (cineCenterOf(id, _cineA) < 0) return null;
  let best = null, bestD = Infinity;
  for (const cand of cineFocusList()){
    if (cand===id || cand===exclude) continue;
    if (cineCenterOf(cand, _cineB) < 0) continue;
    const d = _cineA.distanceTo(_cineB);
    if (d < bestD){ bestD = d; best = cand; }
  }
  return best;
}
function cineNearestToCamera(){
  let best = null, bestD = Infinity;
  for (const cand of cineFocusList()){
    if (cineCenterOf(cand, _cineB) < 0) continue;
    const d = camera.position.distanceTo(_cineB);
    if (d < bestD){ bestD = d; best = cand; }
  }
  return best;
}
function cineEnterFocus(id){
  if (!id) return;
  if (camMode!=='cinematic') setCamMode('cinematic');
  cineFocusOn = true; cineFocusId = id; cineLastInput = 0;
  cineUpdateDock();
}
function cineFocusSelected(){
  let id = null;
  if (selected){
    if (selected.type==='planet') id = (String(selected.key).toLowerCase()==='sun') ? 'sun' : selected.key;
    else if (selected.type==='imported') id = selected.im.id;
  }
  if (!id || cineCenterOf(id, _cineB) < 0) id = cineNearestToCamera();
  cineEnterFocus(id);
}
function cineAuto(){
  cineFocusOn = false; cineFocusId = null; cineHist.length = 0;
  cineNextCut = 0; cineLastInput = 0;
  if (camMode!=='cinematic') setCamMode('cinematic'); else cineUpdateDock();
}
function cineStep(dir){
  if (camMode!=='cinematic') setCamMode('cinematic');
  if (!cineFocusOn || !cineFocusId){ cineFocusSelected(); return; }
  if (dir < 0){
    const prev = cineHist.pop();
    if (prev != null){ cineFocusId = prev; cineLastInput = 0; cineUpdateDock(); return; }
  }
  const cameFrom = cineHist.length ? cineHist[cineHist.length-1] : null;
  const next = cineNearestOther(cineFocusId, dir>0 ? cameFrom : null);
  if (next){
    if (dir>0) cineHist.push(cineFocusId);
    cineFocusId = next; cineLastInput = 0; cineUpdateDock();
  }
}
function cineUpdateDock(){
  if (!root) return;
  const dock = root.querySelector('#stCineDock'); if (!dock) return;
  dock.style.display = (camMode==='cinematic') ? 'flex' : 'none';
  const nm = dock.querySelector('#stCineName');
  if (nm) nm.textContent = cineFocusOn ? cineName(cineFocusId) : 'Auto-directed';
  const auto = dock.querySelector('#stCineAuto');
  if (auto) auto.classList.toggle('on', !cineFocusOn);
  const focus = dock.querySelector('#stCineFocus');
  if (focus) focus.classList.toggle('on', cineFocusOn);
}
function cineTickFocus(dt){
  const rad = cineCenterOf(cineFocusId, _cineA);
  if (rad < 0){ cineFocusOn = false; cineUpdateDock(); return; }
  cineT += dt;
  const radius = 5 + rad*4;
  const ang = cineT*0.14;
  const desired = new THREE.Vector3(
    _cineA.x + Math.cos(ang)*radius,
    _cineA.y + radius*0.34 + Math.sin(cineT*0.4)*radius*0.12,
    _cineA.z + Math.sin(ang)*radius
  );
  camera.position.lerp(desired, 1 - Math.pow(0.0016, dt));
  orbit.target.lerp(_cineA, 1 - Math.pow(0.004, dt));
}

let raf = 0, lastClockSec = 0;

/* ---------------------------------------------------------------------------
   Apple-grade dolly (3D). Zoom is geometric, so we glide the camera's radius
   (its distance to the orbit target) toward a target radius in LOG-space with
   a frame-rate-independent exponential approach (1 - e^-dt/τ) — constant
   perceptual rate, inertial ease-out, never a hard jump. The world point under
   the pointer is held fixed each frame using target' = target + (1-s)(anchor -
   target), the exact focal-plane relation for a radius scale s = r_new/r_old.
   Wheel deltas are normalized across pixel/line/page modes and trackpad pinch
   (ctrlKey) so every input device feels identical.
--------------------------------------------------------------------------- */
const ZOOM3D_TAU = 0.055;                          // seconds — smaller = snappier
const zoom3D = { targetR: 0, anchor: new THREE.Vector3(), hasAnchor: false, active: false };
const _dollyFwd = new THREE.Vector3();
const _dollyOff = new THREE.Vector3();
const _dollyHit = new THREE.Vector3();
const _dollyPlane = new THREE.Plane();
const _dollyNDC = new THREE.Vector2();

function onWheelDolly(e){
  e.preventDefault();
  cineLastInput = performance.now();               // manual steering yields cinematic
  const el = renderer.domElement, rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  // World point visually under the cursor, on the focal plane through target.
  _dollyNDC.set(((e.clientX-rect.left)/rect.width)*2-1, -(((e.clientY-rect.top)/rect.height)*2-1));
  raycaster.setFromCamera(_dollyNDC, camera);
  camera.getWorldDirection(_dollyFwd);
  _dollyPlane.setFromNormalAndCoplanarPoint(_dollyFwd, orbit.target);
  if (raycaster.ray.intersectPlane(_dollyPlane, _dollyHit)){ zoom3D.anchor.copy(_dollyHit); zoom3D.hasAnchor = true; }
  else zoom3D.hasAnchor = false;
  // Normalize the delta, then map to a geometric factor on the radius.
  let dy = e.deltaY;
  if (e.deltaMode===1) dy *= 16; else if (e.deltaMode===2) dy *= (rect.height||800);
  dy = Math.max(-220, Math.min(220, dy));
  const perPx = e.ctrlKey ? 0.026 : 0.0122;        // pinch gets a firmer response
  const factor = Math.exp(dy*perPx);               // dy>0 (scroll down) → zoom OUT
  const curR = camera.position.distanceTo(orbit.target);
  const base = zoom3D.active ? zoom3D.targetR : curR;
  zoom3D.targetR = Math.max(orbit.minDistance, Math.min(orbit.maxDistance, base*factor));
  zoom3D.active = true;
}

function tickDolly3D(dt){
  if (!zoom3D.active) return;
  _dollyOff.copy(camera.position).sub(orbit.target);
  const cur = _dollyOff.length();
  if (cur < 1e-9){ zoom3D.active = false; return; }
  const tgt = zoom3D.targetR;
  const k = 1 - Math.exp(-dt/ZOOM3D_TAU);          // frame-rate-independent glide
  let nr = Math.exp(Math.log(cur) + (Math.log(tgt)-Math.log(cur))*k);
  nr = Math.max(orbit.minDistance, Math.min(orbit.maxDistance, nr));
  if (Math.abs(Math.log(tgt/nr)) < 1e-4){ nr = tgt; zoom3D.active = false; }
  const s = nr/cur;
  if (zoom3D.hasAnchor){
    // Pin the cursor's world point: target' = target + (1-s)(anchor - target).
    const sx=(zoom3D.anchor.x-orbit.target.x)*(1-s),
          sy=(zoom3D.anchor.y-orbit.target.y)*(1-s),
          sz=(zoom3D.anchor.z-orbit.target.z)*(1-s);
    if (isFinite(sx)&&isFinite(sy)&&isFinite(sz)) orbit.target.set(orbit.target.x+sx, orbit.target.y+sy, orbit.target.z+sz);
  }
  _dollyOff.setLength(nr);
  camera.position.copy(orbit.target).add(_dollyOff);
}

function animate(){
  raf = requestAnimationFrame(animate);
  try {
    const dt = Math.min(0.05, clock.getDelta());

    // Plane-POV calm: while flying first-person aboard the airliner, ease the
    // whole world's apparent motion down so it feels like real cruising flight
    // (the passenger's own frame), then ease it back once the flight ends.
    const _povFly = !!(dnFlightSim && dnFlightSim.povOn);
    dnWorldSlow += ((_povFly ? 0.10 : 1) - dnWorldSlow) * Math.min(1, dt*2.4);

    if (playing){
      simDate = new Date(simDate.getTime() + timeScale*dt*DAY_MS*dnWorldSlow);
      updatePlanets();
    }
    // planet spin (visual, exaggerated) — scaled by the POV calm factor
    for (const p of PLANETS){
      const rec = planetMeshes[p.key];
      rec.spin.rotation.y += (p.rot!==0 ? (1/p.rot) : 0) * dt * 0.6 * dnWorldSlow;
    }
    if (asteroidBelt) asteroidBelt.rotation.y += dt*0.02;
    if (meteorSys) updateMeteors(dt);
    // NAVLINQ midpoint tracks the bodies as they move (throttled; updates even when paused)
    if (navMode && navSel.size>=2){ _navAccum+=dt; if(_navAccum>0.1){ _navAccum=0; updateNav(); } }

    pollGamepad(dt);
    if (camMode==='cinematic') tickCinematic(dt);
    tickDolly3D(dt);
    deepNavTick(dt);
    orbit.update();
    renderer.render(scene, camera);

    // local wall-clock readout (once per second)
    const nowSec = (performance.now()/1000)|0;
    if (nowSec !== lastClockSec){ lastClockSec = nowSec; updateLocalClock(); }

    rebootCount = 0;                                   // a clean frame clears the fault counter
  } catch(err){
    handleRenderFault(err);
  }
}

/* Resilience — if the render loop throws (e.g. a transient GPU/driver hiccup),
   pause, surface a toast, and attempt a bounded "timed reboot" of the loop. */
function handleRenderFault(err){
  console.error('[Cosmos Studio] render fault:', err);
  cancelAnimationFrame(raf); raf = 0;
  if (rebootCount >= 3){ toast('3D view paused after repeated errors — reopen to retry'); return; }
  rebootCount++;
  toast('Recovering the 3D view…');
  clearTimeout(rebootTimer);
  rebootTimer = setTimeout(()=>{ if (open && !raf){ try{ clock.start(); }catch(e){} animate(); } }, 1200);
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
  setRealtime(false);
  playing = false; playBtn.textContent = '▶';
  clearMeteors(); clearEventPins();

  // Cosmic-scale epochs (deep past → trillions of years ahead) live outside the
  // orbital-date model. Keep the current solar-system view, frame the relevant
  // body, and present the epoch with an explicit confidence basis so the claim's
  // certainty is always visible — established fact vs. projection vs. speculation.
  if (e.cosmic){
    eventNoteEl.style.display='block';
    eventNoteEl.innerHTML = confChip(e.conf) +
      `<b>${e.name}</b> <span style="color:#8a93a8">· ${e.epoch}</span>` +
      `<br><span style="color:#c6cde0">${e.note}</span>`;
    if (e.focus && planetMeshes[e.focus]) focusKey(e.focus); else focusKey('earth');
    setCamMode('cinematic');
    toast('Deep time · ' + e.epoch);
    return;
  }

  simDate = new Date(e.date+'T00:00:00Z');
  updatePlanets();
  if (e.type==='meteor') startMeteors();
  // drop a pin at the event's Earth location, if it has one
  if (Array.isArray(e.where)) earthPin(e.where[0], e.where[1], 0xff5a7a, e.name, true);
  // badge (with an EWI Trading link for market events)
  eventNoteEl.style.display='block';
  const link = e.link==='trading'
    ? `<br><a href="${tradingURL()}" target="_blank" rel="noopener" style="color:#b7a5ff;font-weight:700;text-decoration:none">Open EWI Trading Command Center →</a>`
    : '';
  eventNoteEl.innerHTML = (e.conf ? confChip(e.conf) : '') +
    `<b>${e.name}</b><br><span style="color:#c6cde0">${e.note}</span>${link}`;
  // frame the relevant body
  if (e.focus && planetMeshes[e.focus]) focusKey(e.focus);
  else focusKey('earth');
  setCamMode('cinematic');
  toast('Jumped to ' + e.date);
}

/* A small, honest certainty label so cosmic-scale claims never imply false
   precision: established science vs. empirically-supported vs. speculative. */
function confChip(conf){
  const map = {
    established: ['Established science', '#16c784', 'rgba(22,199,132,.14)'],
    empirical:   ['Empirically supported', '#f0b429', 'rgba(240,180,41,.14)'],
    speculative: ['Speculative projection', '#8a93a8', 'rgba(138,147,168,.14)'],
  };
  const c = map[conf]; if (!c) return '';
  return `<span style="display:inline-block;font-size:10.5px;font-weight:700;`+
    `letter-spacing:.02em;padding:2px 8px;border-radius:999px;color:${c[1]};`+
    `background:${c[2]};border:1px solid ${c[1]}55;margin-bottom:6px">${c[0]}</span><br>`;
}

/* Best-effort URL for the EWI Trading Command Center — works from the local
   multi-app workspace (…/ewi-cosmos/) and falls back to the suite Home. */
function tradingURL(){
  try{
    const p = location.pathname;
    if (p.includes('/ewi-cosmos/')) return '../ewi-trading-platform/index.html';
    if (window.EWI_TRADING_URL) return window.EWI_TRADING_URL;
    return '../';                              // suite Home (published mirror)
  }catch(e){ return '../'; }
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
   5b.  Earth surface pins (events + the user's real-world location)
   ------------------------------------------------------------------------- */
// Geographic lat/lon → a unit vector on the planet sphere (Y-up scene frame).
function latLonToVec3(lat, lon, r){
  const phi = (90 - lat) * DEG, theta = (lon + 180) * DEG;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );
}
function earthPin(lat, lon, color, label, isEvent){
  const earth = planetMeshes.earth; if (!earth) return null;
  const g = new THREE.Group();
  const ep = PLANETS.find(x=>x.key==='earth');
  const size = ep ? ep.size : 0.32;                    // Earth's scene radius
  const local = latLonToVec3(lat, lon, size*1.02);
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.05,16,16),
    new THREE.MeshBasicMaterial({ color }));
  pin.position.copy(local);
  // a short stalk so the pin reads above the surface
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.006, size*0.5, 8),
    new THREE.MeshBasicMaterial({ color, transparent:true, opacity:0.7 }));
  stalk.position.copy(local.clone().multiplyScalar(0.85));
  stalk.lookAt(0,0,0); stalk.rotateX(Math.PI/2);
  g.add(pin); g.add(stalk);
  g.userData = { isEvent:!!isEvent, label:label||'' };
  earth.group.add(g);                                  // rides with Earth as it orbits
  earthPins.push(g);
  return g;
}
function clearEventPins(){
  for (let i=earthPins.length-1;i>=0;i--){
    if (earthPins[i].userData.isEvent){ earthPins[i].parent && earthPins[i].parent.remove(earthPins[i]); earthPins.splice(i,1); }
  }
}
function dropMyLocation(){
  if (!navigator.geolocation){ toast('Geolocation is not available on this device'); return; }
  toast('Requesting your location…');
  navigator.geolocation.getCurrentPosition(pos=>{
    const { latitude, longitude } = pos.coords;
    // remove any previous location pin (non-event)
    for (let i=earthPins.length-1;i>=0;i--){ if (!earthPins[i].userData.isEvent){ earthPins[i].parent && earthPins[i].parent.remove(earthPins[i]); earthPins.splice(i,1); } }
    earthPin(latitude, longitude, 0x4cd964, 'You are here', false);
    eventNoteEl.style.display='block';
    eventNoteEl.innerHTML = `<b>You are here</b><br><span style="color:#c6cde0">≈ ${latitude.toFixed(3)}°, ${longitude.toFixed(3)}° — pinned on Earth (approx.).</span>`;
    focusKey('earth');
    toast('Pinned your location on Earth');
  }, err=>{
    toast(err.code===1 ? 'Location permission denied' : 'Could not get location');
  }, { enableHighAccuracy:false, timeout:8000, maximumAge:600000 });
}

/* ---------------------------------------------------------------------------
   5c.  NAVLINQ — true-3D, N-body, gravity-weighted midpoint across a chosen
        set of bodies. Nodes may be planets, the Sun, the Moon, or the real
        nearby stars — so the same midpoint algorithm spans this Solar System
        and neighbouring systems. Two midpoints are computed and shown:
          • geometric centre  (unweighted mean of positions)
          • barycenter        (mass-weighted — where gravity balances)
        Their separation makes gravity's pull visible and quantifiable.
        In-system selections are solved exactly in AU (Keplerian positions);
        selections that include a star are solved in light-years using real
        catalogued distances and directions (no false precision).
   ------------------------------------------------------------------------- */
const AU_KM_NAV = 1.495978707e8;              // km per AU
const LY_IN_AU  = 63241.077;                  // AU per light-year
const MOON_MASS = 3.694e-8;                   // M☉
let _navAccum = 0;

function navStarSprite(name){ for (const s of dnStars){ if (s.userData.dn && s.userData.dn.name===name) return s; } return null; }

// Resolve one NAVLINQ node id → { id, name, kind, mass(M☉), scenePos, auPos, lyPos, inSystem }
function navNodeResolve(id){
  const jd = dateToJD(simDate);
  if (id==='sun'){
    const sp = sun ? sun.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    return { id, name:'Sun', kind:'sun', mass:1, scenePos:sp, auPos:new THREE.Vector3(0,0,0), lyPos:new THREE.Vector3(0,0,0), inSystem:true };
  }
  if (id==='moon'){
    if (!moon) return null;
    const sp = moon.mesh.getWorldPosition(new THREE.Vector3());
    const au = heliocentric(PLANETS.find(p=>p.key==='earth'), jd);   // Moon ≈ Earth at AU scale
    return { id, name:'Moon', kind:'moon', mass:MOON_MASS, scenePos:sp, auPos:au, lyPos:au.clone().multiplyScalar(1/LY_IN_AU), inSystem:true };
  }
  if (id.indexOf('star:')===0){
    const rec = NEAR_STAR_BY_NAME[id.slice(5)]; if (!rec) return null;
    const [name, ly, ux, uy, uz, mass] = rec;
    const dir = new THREE.Vector3(ux, uy, uz).normalize();
    const spr = navStarSprite(name);
    const sp  = spr ? spr.getWorldPosition(new THREE.Vector3()) : dir.clone().multiplyScalar(2600+ly*40);
    return { id, name, kind:'star', mass:mass||0.3, scenePos:sp, auPos:null, lyPos:dir.clone().multiplyScalar(ly), inSystem:false, ly };
  }
  const p = PLANETS.find(x=>x.key===id); if (!p) return null;
  const pm = planetMeshes[id]; if (!pm) return null;
  const au = heliocentric(p, jd);
  return { id, name:p.name, kind:'planet', mass:p.mass||1e-9,
    scenePos:pm.group.getWorldPosition(new THREE.Vector3()), auPos:au, lyPos:au.clone().multiplyScalar(1/LY_IN_AU), inSystem:true };
}
function navNodes(){ const out=[]; navSel.forEach(id=>{ const n=navNodeResolve(id); if(n) out.push(n); }); return out; }

// The whole computation: scene-space markers + a scale-appropriate physical readout.
function navComputeMidpoints(){
  const nodes = navNodes(); if (nodes.length < 2) return null;
  const anyStar = nodes.some(n=>!n.inSystem);
  // rendered scene-space centre + barycenter (drive the 3-D markers/links)
  let sumM=0; const cScene=new THREE.Vector3(), bScene=new THREE.Vector3();
  nodes.forEach(n=>{ cScene.add(n.scenePos); bScene.addScaledVector(n.scenePos, n.mass); sumM+=n.mass; });
  cScene.multiplyScalar(1/nodes.length);
  if (sumM>0) bScene.multiplyScalar(1/sumM); else bScene.copy(cScene);
  let dom=nodes[0]; nodes.forEach(n=>{ if(n.mass>dom.mass) dom=n; });
  const massPct = sumM>0 ? dom.mass/sumM*100 : 0;
  let phys;
  if (!anyStar){
    const cAU=new THREE.Vector3(), bAU=new THREE.Vector3(); let m2=0;
    nodes.forEach(n=>{ cAU.add(n.auPos); bAU.addScaledVector(n.auPos, n.mass); m2+=n.mass; });
    cAU.multiplyScalar(1/nodes.length); if (m2>0) bAU.multiplyScalar(1/m2);
    const offKm = bAU.clone().sub(cAU).length()*AU_KM_NAV;
    const r = bAU.length();
    const lon = norm360(Math.atan2(bAU.y, bAU.x)/DEG);
    const lat = r>1e-9 ? Math.asin(THREE.MathUtils.clamp(bAU.z/r,-1,1))/DEG : 0;
    let span=0; for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){ const d=nodes[i].auPos.distanceTo(nodes[j].auPos); if(d>span)span=d; }
    phys = { scale:'AU', bary:bAU, centroid:cAU, offKm, r, lon, lat, span,
             marker:auToScene(bAU), cMarker:auToScene(cAU) };
  } else {
    const cLy=new THREE.Vector3(), bLy=new THREE.Vector3(); let m2=0;
    nodes.forEach(n=>{ cLy.add(n.lyPos); bLy.addScaledVector(n.lyPos, n.mass); m2+=n.mass; });
    cLy.multiplyScalar(1/nodes.length); if (m2>0) bLy.multiplyScalar(1/m2);
    const r = bLy.length();
    const dir = r>1e-9 ? bLy.clone().multiplyScalar(1/r) : new THREE.Vector3(0,0,1);
    const lon = norm360(Math.atan2(dir.y, dir.x)/DEG);
    const lat = Math.asin(THREE.MathUtils.clamp(dir.z,-1,1))/DEG;
    let span=0; for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){ const d=nodes[i].lyPos.distanceTo(nodes[j].lyPos); if(d>span)span=d; }
    const offLy = bLy.clone().sub(cLy).length();
    let sr=0, ns=0; nodes.forEach(n=>{ if(!n.inSystem){ sr+=n.scenePos.length(); ns++; } }); sr = ns ? sr/ns : 2600;
    phys = { scale:'ly', bary:bLy, centroid:cLy, offLy, r, lon, lat, span, dir, marker:dir.clone().multiplyScalar(sr) };
  }
  return { nodes, anyStar, sumM, dom, massPct, cScene, bScene, phys };
}

function navReadoutHTML(R){
  const p = R.phys;
  if (!R.anyStar){
    return `<b>NAVLINQ · ${R.nodes.length} bodies · in-system</b><br>`+
      `<span style="color:#c6cde0">Barycenter: ecliptic λ ${p.lon.toFixed(2)}° · β ${p.lat.toFixed(2)}° · ${p.r.toFixed(4)} AU from the Sun</span><br>`+
      `<span style="color:#c6cde0">Centre → barycenter offset <b>${fmtKm(p.offKm)}</b> · node span ${p.span.toFixed(3)} AU</span><br>`+
      `<span style="color:#9aa3bd;font-size:11px">Gravity pulls the midpoint ${fmtKm(p.offKm)} toward <b>${R.dom.name}</b> (${R.massPct.toFixed(1)}% of the set's mass). Mass-weighted 3-D barycenter — physically exact (established mechanics).</span>`;
  }
  return `<b>NAVLINQ · ${R.nodes.length} nodes · interstellar</b><br>`+
    `<span style="color:#c6cde0">Barycenter bearing λ ${p.lon.toFixed(1)}° · β ${p.lat.toFixed(1)}° · ${p.r.toFixed(3)} ly from the Sun</span><br>`+
    `<span style="color:#c6cde0">Node span ${p.span.toFixed(2)} ly · dominant mass <b>${R.dom.name}</b> (${R.massPct.toFixed(1)}%)</span><br>`+
    `<span style="color:#9aa3bd;font-size:11px">Real catalogued distances &amp; directions; the marker shows the true 3-D bearing rendered at representative range (stars sit far beyond scene scale). O(N) &amp; direction-agnostic — the same formula extends to any bodies in any direction.</span>`;
}

function toggleNavMode(){
  navMode = !navMode;
  const btn = root.querySelector('#stNav');
  btn.classList.toggle('on', navMode);
  btn.setAttribute('aria-pressed', navMode ? 'true' : 'false');
  if (navMode){
    transform.detach();
    dnPanel('navlinq').open();
    highlightNav(); updateNav();
    toast('NAVLINQ — pick 2+ bodies (planets, Sun, Moon, or nearby stars) to link their gravity-weighted midpoint');
  } else {
    navSel.clear(); clearNav(); eventNoteEl.style.display='none';
    if (dnPanels.navlinq) dnPanels.navlinq.close();
  }
}
function navToggleBody(id){
  if (!id) return;
  const ok = id==='sun' || id==='moon' || id.indexOf('star:')===0 || !!planetMeshes[id];
  if (!ok) return;
  if (navSel.has(id)) navSel.delete(id); else navSel.add(id);
  highlightNav();
  updateNav();
}
function highlightNav(){
  objListEl.querySelectorAll('.st-item').forEach(el=>{
    el.classList.toggle('sel', navSel.has(el.dataset.id));
  });
  const P = dnPanels.navlinq;
  if (P && P.el.classList.contains('on'))
    P.body.querySelectorAll('.nv-chip').forEach(c=>c.classList.toggle('sel', navSel.has(c.dataset.id)));
}
function navRefreshPanel(R){
  const P = dnPanels.navlinq; if (!P || !P.el.classList.contains('on')) return;
  P.body.querySelectorAll('.nv-chip').forEach(c=>c.classList.toggle('sel', navSel.has(c.dataset.id)));
  const out = P.body.querySelector('#nvOut'); if (!out) return;
  out.innerHTML = R ? navReadoutHTML(R)
    : (navSel.size===1 ? 'One node selected — add at least one more.' : 'Select 2 or more bodies to compute a midpoint.');
}
// Back-compat seam helper: in-system mass-weighted midpoint (AU) of the selection.
function navBarycenterAU(jd){
  let M=0; const acc=new THREE.Vector3();
  navSel.forEach(id=>{ const n=navNodeResolve(id); if(!n||!n.inSystem) return; acc.addScaledVector(n.auPos, n.mass); M+=n.mass; });
  return M>0 ? acc.multiplyScalar(1/M) : acc;
}
function clearNav(){
  if (navGroup){ scene.remove(navGroup); navGroup.traverse(o=>{ o.geometry&&o.geometry.dispose(); o.material&&o.material.dispose&&o.material.dispose(); }); navGroup=null; }
}
function updateNav(){
  clearNav();
  const R = navComputeMidpoints();
  navRefreshPanel(R);
  if (!R){
    if (navMode && navSel.size===1){ eventNoteEl.style.display='block'; eventNoteEl.innerHTML='<b>NAVLINQ</b><br><span style="color:#c6cde0">Select at least one more body to compute a midpoint.</span>'; }
    return;
  }
  const mid = R.phys.marker.clone();
  navGroup = new THREE.Group(); navGroup.name = 'NAVLINQ';
  const linkMat = new THREE.LineBasicMaterial({ color:0x7c5cff, transparent:true, opacity:0.8 });
  R.nodes.forEach(n=>{
    const g = new THREE.BufferGeometry().setFromPoints([ n.scenePos.clone(), mid.clone() ]);
    navGroup.add(new THREE.Line(g, linkMat));
  });
  // barycenter marker + camera-facing ring
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.16,20,20), new THREE.MeshBasicMaterial({ color:0xb7a5ff }));
  marker.position.copy(mid);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.26,0.32,40),
    new THREE.MeshBasicMaterial({ color:0x7c5cff, side:THREE.DoubleSide, transparent:true, opacity:0.8 }));
  ring.position.copy(mid); ring.lookAt(camera.position);
  navGroup.add(marker); navGroup.add(ring);
  // geometric centre marker + dashed offset line — makes gravity's pull visible (in-system only)
  if (!R.anyStar && R.phys.cMarker){
    const cm = new THREE.Mesh(new THREE.SphereGeometry(0.10,16,16), new THREE.MeshBasicMaterial({ color:0x4fd1c5, transparent:true, opacity:0.9 }));
    cm.position.copy(R.phys.cMarker); navGroup.add(cm);
    const dl = new THREE.Line(new THREE.BufferGeometry().setFromPoints([ R.phys.cMarker.clone(), mid.clone() ]),
      new THREE.LineDashedMaterial({ color:0x4fd1c5, dashSize:0.25, gapSize:0.18, transparent:true, opacity:0.9 }));
    dl.computeLineDistances(); navGroup.add(dl);
  }
  scene.add(navGroup);
  eventNoteEl.style.display='block';
  eventNoteEl.innerHTML = navReadoutHTML(R);
}
function navFlyToMidpoint(){
  const R = navComputeMidpoints(); if (!R){ toast('Pick 2 or more bodies first'); return; }
  dnFlyTo(R.phys.marker.clone(), R.anyStar ? 120 : 1.6, 'NAVLINQ midpoint');
}
function buildNavlinqPanel(body){
  const chip=(id,label)=>`<button class="nv-chip" data-id="${id}">${label}</button>`;
  const inSys=[chip('sun','Sun')].concat(PLANETS.map(p=>chip(p.key,p.name)));
  if (moon) inSys.push(chip('moon','Moon'));
  const stars=NEAR_STARS.map(s=>chip('star:'+s[0], s[0]));
  body.innerHTML=`<div class="dn-hint">Pick 2+ bodies — planets, the Sun, the Moon, or nearby stars — to link their gravity-weighted midpoint in true 3-D. You can also click bodies or star pins directly in the scene.</div>
    <div class="nv-grp-lbl">In-system</div><div class="nv-wrap">${inSys.join('')}</div>
    <div class="nv-grp-lbl">Interstellar · real distances</div><div class="nv-wrap">${stars.join('')}</div>
    <div class="dn-read" id="nvOut" style="margin-top:8px">Select 2 or more bodies to compute a midpoint.</div>
    <div class="dn-rowbtn"><button class="dn-mini" id="nvClear">Clear</button><button class="dn-mini" id="nvFly" style="margin-left:auto">Fly to midpoint ▶</button></div>`;
  body.querySelectorAll('.nv-chip').forEach(c=>c.addEventListener('click', ()=>navToggleBody(c.dataset.id)));
  body.querySelector('#nvClear').addEventListener('click', ()=>{ navSel.clear(); clearNav(); highlightNav(); navRefreshPanel(null); });
  body.querySelector('#nvFly').addEventListener('click', navFlyToMidpoint);
}

/* ---------------------------------------------------------------------------
   5d.  Real-time tracking + selectable time compression (Task 3)
   ------------------------------------------------------------------------- */
function applyRealtimeRatio(){
  const sel = root.querySelector('#stRatio');
  const secPerSec = parseFloat(sel.value) || 1;         // sim-seconds per real second
  timeScale = secPerSec / 86400;                        // → sim-days per real second
  root.querySelector('#stSpeedLbl').textContent = 'real-time';
}
function setRealtime(on){
  if (realtime === on) return;
  realtime = on;
  const btn = root.querySelector('#stNow'); const ratio = root.querySelector('#stRatio');
  if (!btn) return;
  btn.classList.toggle('on', on);
  btn.setAttribute('aria-pressed', on ? 'true':'false');
  ratio.disabled = !on;
  if (on){
    simDate = new Date();
    playing = true; playBtn.textContent = '⏸';
    applyRealtimeRatio();
    updatePlanets();
    toast('Real-time tracking on');
  } else {
    root.querySelector('#stSpeedLbl').textContent = timeScale+' d/s';
  }
}
function updateLocalClock(){
  const el = root && root.querySelector('#stLocal'); if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

/* ---------------------------------------------------------------------------
   6.  Camera modes + focus + selection
   ------------------------------------------------------------------------- */
function setCamMode(m){
  camMode = m;
  camBtnExp.classList.toggle('on', m==='explore');
  camBtnCine.classList.toggle('on', m==='cinematic');
  // Both modes now let the user orbit/zoom freely (Task 3: make cinematic
  // intuitive, not restrictive). In cinematic, the camera is gently
  // auto-directed only while the user isn't actively steering.
  orbit.enabled = true;
  if (m==='cinematic'){ transform.detach(); cineNextCut = 0; cineLastInput = 0; }
  else { cineFocusOn = false; }
  cineUpdateDock();
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
    // NAVLINQ mode: clicking a body toggles its membership in the midpoint set
    if (navMode){
      let key = o.userData.planet || o.name;
      if (o===sun) key='sun';
      else if (moon && o===moon.mesh) key='moon';
      if (key) navToggleBody(key);
      return;
    }
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
      else if (id==='sun'){ if(navMode) return; selectPlanet('Sun'); focusKey('mercury'); }
      else if (navMode && planetMeshes[id]){ navToggleBody(id); }
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
  // Studio-owned EWI Home button (top-left): mirror the suite's home target so
  // it stays correct in both the standalone app and the suite shell.
  const homeSrc = document.getElementById('ewi-home');
  const stHome = root.querySelector('#stHome');
  if (stHome && homeSrc){ const h = homeSrc.getAttribute('href') || homeSrc.href; if (h) stHome.href = h; }
  syncViewSwitch(true);
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
  syncViewSwitch(false);
  cancelAnimationFrame(raf); raf = 0;
  // pause any playing media to save resources
  imported.forEach(im=>{ if (im.extra.video) im.extra.video.pause(); });
}

/* Keep the 2D-header switch and the Studio toolbar switch reflecting the active
   render style, so the toggle reads identically from either view. */
function syncViewSwitch(is3D){
  const h2 = document.getElementById('view2d'), h3 = document.getElementById('view3d');
  if (h2) h2.setAttribute('aria-pressed', is3D ? 'false' : 'true');
  if (h3) h3.setAttribute('aria-pressed', is3D ? 'true'  : 'false');
  if (root){
    const s2 = root.querySelector('#stView2d'), s3 = root.querySelector('#stView3d');
    if (s2) s2.classList.toggle('on', !is3D);
    if (s3) s3.classList.toggle('on',  is3D);
  }
}

/* wire the 2D-header 2D·3D switch (and the legacy button, if present) */
function wireOpener(){
  const b3 = document.getElementById('view3d');
  const b2 = document.getElementById('view2d');
  if (b3) b3.addEventListener('click', openStudio);
  if (b2) b2.addEventListener('click', ()=>{ if (open) close(); });
  const legacy = document.getElementById('studioBtn'); // older markup fallback
  if (legacy) legacy.addEventListener('click', openStudio);
}
if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', wireOpener);
else wireOpener();

/* ===========================================================================
   DEEP NAV — extreme-zoom navigation, non-modal panels, waypoint thumbtacks,
   fly-to with a symbolic time-tempo slider, an X·Y·Z / lat-long viewing card,
   and an offline flight tracker. All physics-anchored where measurable and
   honestly framed as a deterministic offline simulation where it is stylised.
   =========================================================================== */

// Real mean radii (km) — for honest surface-relative scale + altitude readouts.
const BODY_R_KM = { sun:696340, mercury:2439.7, venus:6051.8, earth:6371, mars:3389.5,
  jupiter:69911, saturn:58232, uranus:25362, neptune:24622, moon:1737.4 };
// Known dominant surface state (calibrated confidence — observed, not inferred).
const BODY_PHASE = {
  sun:['Plasma','#ff6b6b'], mercury:['Solid','#9ec5ff'], venus:['Solid · supercritical CO₂ air','#b07cff'],
  earth:['Solid & liquid','#4fd1c5'], mars:['Solid (rock & ice)','#9ec5ff'], moon:['Solid','#9ec5ff'],
  jupiter:['Gas → liquid metallic H (no solid surface)','#c9a227'],
  saturn:['Gas → liquid metallic H (no solid surface)','#c9a227'],
  uranus:['Icy fluid mantle','#7fd3ff'], neptune:['Icy fluid mantle','#7fd3ff'] };
// A few real named surface features (lat, lon in degrees) per body → thumbtacks.
const LANDMARKS = {
  earth:[['Mount Everest',27.99,86.93],['Mariana Trench',11.35,142.2],['Kennedy Space Center',28.57,-80.65],['Amazon Basin',-3.5,-62.2]],
  mars:[['Olympus Mons',18.65,-133.8],['Valles Marineris',-13.9,-59.2],['Gale Crater',-5.4,137.8]],
  moon:[['Tranquility Base',0.67,23.47],['Tycho Crater',-43.3,-11.4],['Copernicus',9.6,-20.1]],
  jupiter:[['Great Red Spot',-22,0]], saturn:[['North polar hexagon',88,0]],
  venus:[['Maxwell Montes',65,3]], mercury:[['Caloris Basin',30,190]] };
// Nearest stars — real distances (ly), representative direction unit-vectors,
// and real approximate masses (M☉) for gravity-weighted interstellar midpoints.
const NEAR_STARS = [
  ['Proxima Centauri',4.246, 1,0.2,0.4, 0.122], ['Alpha Centauri A',4.365, 1,0.15,0.45, 1.079],
  ['Barnard’s Star',5.963, -0.6,0.5,0.7, 0.144], ['Sirius A',8.60, 0.3,-0.4,-0.9, 2.063], ['Wolf 359',7.86, -0.8,-0.2,0.3, 0.110] ];
const NEAR_STAR_BY_NAME = Object.fromEntries(NEAR_STARS.map(s=>[s[0], s]));
// Major-airport table (IATA → name, lat, lon). Broad global coverage so common
// city-pairs (e.g. ATL→DAL) resolve; reference points ≈ terminal/ARP.
const AIRPORTS = {
  // — United States —
  ATL:['Atlanta',33.6407,-84.4277], DFW:['Dallas/Fort Worth',32.8998,-97.0403], DAL:['Dallas Love Field',32.8471,-96.8518],
  DEN:['Denver',39.8561,-104.6737], ORD:['Chicago O’Hare',41.9742,-87.9073], MDW:['Chicago Midway',41.7868,-87.7522],
  LAX:['Los Angeles',33.9416,-118.4085], JFK:['New York JFK',40.6413,-73.7781], EWR:['Newark',40.6895,-74.1745],
  LGA:['New York LaGuardia',40.7769,-73.8740], SFO:['San Francisco',37.6213,-122.3790], SJC:['San José CA',37.3639,-121.9289],
  OAK:['Oakland',37.7126,-122.2197], SEA:['Seattle–Tacoma',47.4502,-122.3088], PDX:['Portland OR',45.5898,-122.5951],
  LAS:['Las Vegas',36.0840,-115.1537], PHX:['Phoenix',33.4342,-112.0116], SAN:['San Diego',32.7338,-117.1933],
  SLC:['Salt Lake City',40.7899,-111.9791], DTW:['Detroit',42.2162,-83.3554], MSP:['Minneapolis–St. Paul',44.8848,-93.2223],
  BOS:['Boston Logan',42.3656,-71.0096], PHL:['Philadelphia',39.8744,-75.2424], BWI:['Baltimore',39.1774,-76.6684],
  IAD:['Washington Dulles',38.9531,-77.4565], DCA:['Washington Reagan',38.8512,-77.0402], CLT:['Charlotte',35.2140,-80.9431],
  MIA:['Miami',25.7959,-80.2870], FLL:['Fort Lauderdale',26.0742,-80.1506], MCO:['Orlando',28.4312,-81.3081],
  TPA:['Tampa',27.9755,-82.5332], IAH:['Houston Bush',29.9902,-95.3368], HOU:['Houston Hobby',29.6454,-95.2789],
  AUS:['Austin',30.1975,-97.6664], SAT:['San Antonio',29.5337,-98.4698], MSY:['New Orleans',29.9934,-90.2580],
  BNA:['Nashville',36.1263,-86.6774], STL:['St. Louis',38.7487,-90.3700], MCI:['Kansas City',39.2976,-94.7139],
  IND:['Indianapolis',39.7173,-86.2944], CMH:['Columbus OH',39.9980,-82.8919], CLE:['Cleveland',41.4117,-81.8498],
  PIT:['Pittsburgh',40.4915,-80.2329], CVG:['Cincinnati',39.0489,-84.6678], MEM:['Memphis',35.0424,-89.9767],
  RDU:['Raleigh–Durham',35.8801,-78.7880], SMF:['Sacramento',38.6951,-121.5908], ABQ:['Albuquerque',35.0402,-106.6092],
  HNL:['Honolulu',21.3187,-157.9224], ANC:['Anchorage',61.1743,-149.9982],
  // — Canada & Mexico —
  YYZ:['Toronto Pearson',43.6777,-79.6248], YVR:['Vancouver',49.1967,-123.1815], YUL:['Montréal',45.4706,-73.7408],
  YYC:['Calgary',51.1139,-114.0203], YEG:['Edmonton',53.3097,-113.5798], YOW:['Ottawa',45.3225,-75.6692],
  MEX:['Mexico City',19.4363,-99.0721], CUN:['Cancún',21.0365,-86.8771], GDL:['Guadalajara',20.5218,-103.3111],
  // — Central & South America —
  GRU:['São Paulo Guarulhos',-23.4356,-46.4731], GIG:['Rio de Janeiro',-22.8090,-43.2506], EZE:['Buenos Aires Ezeiza',-34.8222,-58.5358],
  SCL:['Santiago',-33.3898,-70.7944], BOG:['Bogotá',4.7016,-74.1469], LIM:['Lima',-12.0219,-77.1143],
  PTY:['Panama City',9.0714,-79.3835], UIO:['Quito',-0.1292,-78.3575],
  // — Europe —
  LHR:['London Heathrow',51.4700,-0.4543], LGW:['London Gatwick',51.1537,-0.1821], MAN:['Manchester',53.3537,-2.2750],
  DUB:['Dublin',53.4213,-6.2701], CDG:['Paris CDG',49.0097,2.5479], ORY:['Paris Orly',48.7233,2.3794],
  AMS:['Amsterdam Schiphol',52.3105,4.7683], BRU:['Brussels',50.9014,4.4844], FRA:['Frankfurt',50.0379,8.5622],
  MUC:['Munich',48.3538,11.7861], ZRH:['Zürich',47.4647,8.5492], VIE:['Vienna',48.1103,16.5697],
  MAD:['Madrid Barajas',40.4936,-3.5668], BCN:['Barcelona',41.2974,2.0833], LIS:['Lisbon',38.7742,-9.1342],
  FCO:['Rome Fiumicino',41.8003,12.2389], MXP:['Milan Malpensa',45.6301,8.7255], ATH:['Athens',37.9364,23.9445],
  CPH:['Copenhagen',55.6180,12.6508], ARN:['Stockholm Arlanda',59.6519,17.9186], OSL:['Oslo',60.1976,11.1004],
  HEL:['Helsinki',60.3172,24.9633], WAW:['Warsaw',52.1657,20.9671], PRG:['Prague',50.1008,14.2600],
  BUD:['Budapest',47.4369,19.2556], IST:['Istanbul',41.2753,28.7519], SAW:['Istanbul Sabiha',40.8986,29.3092],
  SVO:['Moscow Sheremetyevo',55.9726,37.4146], DME:['Moscow Domodedovo',55.4088,37.9063],
  // — Middle East & Africa —
  DXB:['Dubai',25.2532,55.3657], AUH:['Abu Dhabi',24.4330,54.6511], DOH:['Doha Hamad',25.2731,51.6081],
  RUH:['Riyadh',24.9576,46.6988], JED:['Jeddah',21.6796,39.1565], KWI:['Kuwait',29.2266,47.9689],
  BAH:['Bahrain',26.2708,50.6336], TLV:['Tel Aviv',32.0114,34.8867], CAI:['Cairo',30.1219,31.4056],
  JNB:['Johannesburg',-26.1392,28.2460], CPT:['Cape Town',-33.9690,18.6017], LOS:['Lagos',6.5774,3.3212],
  NBO:['Nairobi',-1.3192,36.9278], ADD:['Addis Ababa',8.9779,38.7993], CMN:['Casablanca',33.3675,-7.5900],
  ACC:['Accra',5.6052,-0.1668], DKR:['Dakar',14.6710,-17.0733],
  // — Asia —
  HND:['Tokyo Haneda',35.5523,139.7798], NRT:['Tokyo Narita',35.7719,140.3928], ICN:['Seoul Incheon',37.4602,126.4407],
  PEK:['Beijing Capital',40.0799,116.6031], PKX:['Beijing Daxing',39.5098,116.4109], PVG:['Shanghai Pudong',31.1443,121.8083],
  CAN:['Guangzhou',23.3924,113.2988], HKG:['Hong Kong',22.3080,113.9185], TPE:['Taipei Taoyuan',25.0777,121.2328],
  SIN:['Singapore Changi',1.3644,103.9915], BKK:['Bangkok Suvarnabhumi',13.6900,100.7501], KUL:['Kuala Lumpur',2.7456,101.7099],
  CGK:['Jakarta',-6.1256,106.6559], MNL:['Manila',14.5086,121.0197], DEL:['Delhi',28.5562,77.1000],
  BOM:['Mumbai',19.0896,72.8656], BLR:['Bengaluru',13.1986,77.7066], MAA:['Chennai',12.9941,80.1709],
  HYD:['Hyderabad',17.2403,78.4294], CCU:['Kolkata',22.6547,88.4467], DAC:['Dhaka',23.8433,90.3978],
  KHI:['Karachi',24.9065,67.1608], ISB:['Islamabad',33.5490,72.8258], CMB:['Colombo',7.1808,79.8841],
  KTM:['Kathmandu',27.6966,85.3591],
  // — Oceania —
  SYD:['Sydney',-33.9399,151.1753], MEL:['Melbourne',-37.6690,144.8410], BNE:['Brisbane',-27.3842,153.1175],
  PER:['Perth',-31.9403,115.9669], AKL:['Auckland',-37.0082,174.7850], NAN:['Nadi',-17.7554,177.4434] };

let dnInited=false, dnPins=[], dnStars=[], dnPinsVisible=true, dnFlight=null, dnPlane=null, dnFlightArc=null;
let dnHudEl=null, dnTipEl=null, dnTempoEl=null, dnTempoFrac=0.45, dnWorldSlow=1, dnZTop=12;
const dnPanels={};
const _dnRay=new THREE.Raycaster();
const _dnV=new THREE.Vector3(), _dnV2=new THREE.Vector3(), _dnV3=new THREE.Vector3();

function latLonToVec(latDeg,lonDeg,r){
  const phi=latDeg*DEG, th=lonDeg*DEG;
  return new THREE.Vector3(r*Math.cos(phi)*Math.cos(th), r*Math.sin(phi), r*Math.cos(phi)*Math.sin(th));
}
function fmtSeconds(s){
  if (s<1e-18) return (s/1e-21).toFixed(0)+' zs';
  if (s<1e-15) return (s/1e-18).toFixed(1)+' as';
  if (s<1e-12) return (s/1e-15).toFixed(1)+' fs';
  if (s<1e-9)  return (s/1e-12).toFixed(1)+' ps';
  if (s<1e-6)  return (s/1e-9).toFixed(1)+' ns';
  if (s<1e-3)  return (s/1e-6).toFixed(1)+' µs';
  if (s<1)     return (s*1000).toFixed(0)+' ms';
  if (s<60)    return s.toFixed(1)+' s';
  if (s<3600)  return (s/60).toFixed(1)+' min';
  if (s<86400) return (s/3600).toFixed(1)+' hr';
  if (s<3.156e7) return (s/86400).toFixed(1)+' days';
  if (s<3.156e10) return (s/3.156e7).toFixed(1)+' yr';
  return (s/3.156e16).toFixed(2)+' Gyr';
}
function fmtKm(km){
  if (km<0.001) return (km*1e6).toFixed(0)+' mm';
  if (km<1)     return (km*1000).toFixed(0)+' m';
  if (km<1e6)   return km.toLocaleString(undefined,{maximumFractionDigits:0})+' km';
  const au=km/1.495978707e8;
  if (au<9000)  return au.toFixed(au<10?4:2)+' AU';
  return (km/9.4607e12).toPrecision(3)+' ly';
}

/* ---- Non-modal draggable panel (feature 3) --------------------------------
   Panels live outside the canvas in their own DOM layer, so the user can steer
   the 3D scene and operate a panel *simultaneously* — the sub-screen only
   depends on the main screen to know when it is summoned, never for interaction.
--------------------------------------------------------------------------- */
function makeDnPanel(id, opt){
  const el=document.createElement('div'); el.className='dn-panel'; el.id='dn_'+id;
  el.innerHTML=`<div class="dn-head"><span class="dn-ico">${opt.icon||'◈'}</span>
    <span class="dn-title">${opt.title}</span>
    <input type="range" class="dn-op" min="35" max="100" value="100" title="Opacity" aria-label="Opacity">
    <button class="dn-x" title="Close" aria-label="Close">✕</button></div>
    <div class="dn-body"></div>`;
  root.appendChild(el);
  // Bring a card to the front on any interaction so overlapping panels (and the
  // Warp-tempo strip) never trap another card's contents underneath.
  el.addEventListener('pointerdown', ()=>{ el.style.zIndex=++dnZTop; });
  const head=el.querySelector('.dn-head'), body=el.querySelector('.dn-body'), op=el.querySelector('.dn-op');
  const KEY='ewiCosmosDN_'+id;
  let st={}; try{ st=JSON.parse(localStorage.getItem(KEY)||'{}'); }catch(e){}
  el.style.left=(st.x!=null?st.x:(opt.x||120))+'px';
  el.style.top =(st.y!=null?st.y:(opt.y||70))+'px';
  if (st.op){ op.value=st.op; el.style.opacity=st.op/100; }
  const save=()=>{ try{ localStorage.setItem(KEY, JSON.stringify({ x:parseFloat(el.style.left)||0, y:parseFloat(el.style.top)||0, op:+op.value })); }catch(e){} };
  op.addEventListener('input', ()=>{ el.style.opacity=op.value/100; save(); });
  el.querySelector('.dn-x').addEventListener('click', ()=>ctrl.close());
  // drag (pointer-captured on the header only → canvas stays interactive)
  let dx=0,dy=0,drag=false;
  head.addEventListener('pointerdown', e=>{ if (e.target===op||e.target.classList.contains('dn-x')) return;
    drag=true; el.classList.add('drag'); dx=e.clientX-el.offsetLeft; dy=e.clientY-el.offsetTop;
    head.setPointerCapture(e.pointerId); });
  head.addEventListener('pointermove', e=>{ if (!drag) return;
    const w=window.innerWidth, h=window.innerHeight;
    let nx=Math.max(4,Math.min(w-el.offsetWidth-4, e.clientX-dx));
    let ny=Math.max(56,Math.min(h-40, e.clientY-dy));
    el.style.left=nx+'px'; el.style.top=ny+'px'; });
  head.addEventListener('pointerup', e=>{ drag=false; el.classList.remove('drag'); try{head.releasePointerCapture(e.pointerId);}catch(_){}; save(); });
  const ctrl={ el, body,
    open(){ el.classList.add('on'); if(opt.onOpen)opt.onOpen(body); },
    close(){ el.classList.remove('on'); if(opt.onClose)opt.onClose(); },
    toggle(){ el.classList.contains('on')?ctrl.close():ctrl.open(); } };
  if (opt.build) opt.build(body, ctrl);
  return ctrl;
}
function dnPanel(id){
  if (dnPanels[id]) return dnPanels[id];
  if (id==='zoom')   dnPanels[id]=makeDnPanel('zoom',{ title:'Precision Zoom', icon:'🔍', x:300, y:76, build:buildZoomPanel });
  else if (id==='coord') dnPanels[id]=makeDnPanel('coord',{ title:'Coordinates · Space (X·Y·Z)', icon:'🧭', x:300, y:300, build:buildCoordPanel });
  else if (id==='flights') dnPanels[id]=makeDnPanel('flights',{ title:'Flight Tracker', icon:'✈', x:588, y:76, build:buildFlightsPanel });
  else if (id==='navlinq') dnPanels[id]=makeDnPanel('navlinq',{ title:'NAVLINQ · midpoint', icon:'🛰', x:588, y:300, build:buildNavlinqPanel });
  return dnPanels[id];
}

/* ---- Nearest focused body + honest scale / phase HUD (feature 1) --------- */
function dnNearestBody(){
  if (!planetMeshes||!orbit) return null;
  let best=null, bd=1e30;
  const consider=(key,center,sceneR)=>{ const d=center.distanceTo(orbit.target); if(d<bd){bd=d;best={key,center:center.clone(),sceneR};} };
  for (const p of PLANETS){ const rec=planetMeshes[p.key]; if(rec) consider(p.key, rec.group.getWorldPosition(new THREE.Vector3()), p.size); }
  if (sun) consider('sun', sun.getWorldPosition(new THREE.Vector3()), 3);
  return best;
}
// Body the zoom + coordinate tools act on. When the user has explicitly SELECTED
// a planet (clicked it, or picked it in the Scene list) the presets — Surface,
// 100 km, 1 AU, Fit — always refer to THAT body; otherwise we fall back to the
// body nearest the view centre so the tools still work with nothing selected.
function dnBodyByKey(key){
  if(!key) return null;
  const k=String(key).toLowerCase();
  if(k==='sun') return sun ? { key:'sun', center:sun.getWorldPosition(new THREE.Vector3()), sceneR:3 } : null;
  const rec=planetMeshes[k]; if(!rec) return null;
  const p=PLANETS.find(x=>x.key===k);
  return { key:k, center:rec.group.getWorldPosition(new THREE.Vector3()), sceneR:p?p.size:1 };
}
function dnActiveBody(){
  if (selected && selected.type==='planet' && selected.key){ const b=dnBodyByKey(selected.key); if(b) return b; }
  return dnNearestBody();
}
function dnUpdateHUD(){
  if (!dnHudEl) return;
  const nb=dnNearestBody(); if(!nb){ dnHudEl.textContent=''; return; }
  const rkm=BODY_R_KM[nb.key]||1, kmPerScene=rkm/nb.sceneR;
  const dScene=camera.position.distanceTo(nb.center);
  const altKm=(dScene-nb.sceneR)*kmPerScene;
  const h=window.innerHeight||800, worldPerPx=2*dScene*Math.tan((camera.fov*DEG)/2)/h;
  const kmPerPx=worldPerPx*kmPerScene;
  const [phase,pcol]=BODY_PHASE[nb.key]||['—','#9aa3bd'];
  const a=(PLANETS.find(p=>p.key===nb.key)||{}).el?.[0];
  const teq=a? (254/Math.sqrt(a)).toFixed(0)+' K' : (nb.key==='sun'?'5772 K':'—');
  const name=nb.key.charAt(0).toUpperCase()+nb.key.slice(1);
  dnHudEl.innerHTML=`<b>${name}</b> · alt ${altKm<0?'surface':fmtKm(Math.max(0,altKm))}<br>`+
    `scale 1 px ≈ <b>${fmtKm(Math.max(1e-9,kmPerPx))}</b><br>`+
    `T<sub>eq</sub> ${teq} · surface <span class="phase" style="background:${pcol}33;color:${pcol}">${phase}</span>`;
}

/* ---- Waypoint thumbtacks (feature 4) ------------------------------------- */
function dnMakePinTexture(hex){
  const c=document.createElement('canvas'); c.width=64; c.height=88; const x=c.getContext('2d');
  x.translate(32,30);
  x.fillStyle=hex; x.globalAlpha=0.95;
  x.beginPath(); x.arc(0,0,18,0,Math.PI*2); x.fill();               // head
  x.beginPath(); x.moveTo(-7,14); x.lineTo(7,14); x.lineTo(0,52); x.closePath(); x.fill(); // needle
  x.globalAlpha=1; x.fillStyle='rgba(255,255,255,.9)'; x.beginPath(); x.arc(-5,-5,5,0,Math.PI*2); x.fill(); // glint
  x.strokeStyle='rgba(255,255,255,.65)'; x.lineWidth=2; x.beginPath(); x.arc(0,0,18,0,Math.PI*2); x.stroke();
  const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; return t;
}
const _dnPinTex={};
function dnPinSprite(hex){
  if(!_dnPinTex[hex]) _dnPinTex[hex]=dnMakePinTexture(hex);
  const m=new THREE.SpriteMaterial({ map:_dnPinTex[hex], transparent:true, opacity:0.72, depthTest:false, depthWrite:false, sizeAttenuation:false });
  const s=new THREE.Sprite(m); s.scale.set(0.028,0.038,1); s.renderOrder=999; return s;
}
function dnAddPin(parent, localPos, meta, hex){
  const s=dnPinSprite(hex); s.position.copy(localPos); s.userData.dn=meta; parent.add(s); dnPins.push(s); return s;
}
function dnBuildPins(){
  // body markers (float just above each planet + the Sun)
  for (const p of PLANETS){ const rec=planetMeshes[p.key]; if(!rec) continue;
    dnAddPin(rec.group, new THREE.Vector3(0,p.size*1.7,0), { kind:'body', key:p.key, name:p.name, standoff:p.size*4+1.6 }, '#7c5cff'); }
  if (sun) dnAddPin(sun, new THREE.Vector3(0,4.6,0), { kind:'body', key:'sun', name:'Sun', standoff:14 }, '#ffb020');
  // surface landmarks (attached to the spinning surface where possible)
  for (const key in LANDMARKS){ const rec=planetMeshes[key]; if(!rec) continue; const p=PLANETS.find(x=>x.key===key);
    for (const [nm,lat,lon] of LANDMARKS[key]){
      dnAddPin(rec.spin, latLonToVec(lat,lon,p.size*1.02), { kind:'landmark', key, name:nm, lat, lon, standoff:p.size*0.5+0.18 }, '#4fd1c5'); } }
  // Moon landmarks
  if (moon && LANDMARKS.moon){ for (const [nm,lat,lon] of LANDMARKS.moon){
      dnAddPin(moon.mesh, latLonToVec(lat,lon,0.095), { kind:'landmark', key:'moon', name:nm, lat, lon, standoff:0.06 }, '#4fd1c5'); } }
  // neighbouring-star waypoints (representative far markers, real distances)
  for (const [nm,ly,ux,uy,uz,mass] of NEAR_STARS){ const dir=new THREE.Vector3(ux,uy,uz).normalize();
    const pos=dir.multiplyScalar(2600+ly*40);
    const s=dnPinSprite('#ffd27c'); s.position.copy(pos); s.scale.set(0.032,0.043,1);
    s.userData.dn={ kind:'star', name:nm, ly, mass, standoff:60 }; scene.add(s); dnPins.push(s); dnStars.push(s); }
}
function dnTogglePins(force){
  dnPinsVisible = (force===undefined) ? !dnPinsVisible : !!force;
  for (const s of dnPins) s.visible=dnPinsVisible;
  const b=root&&root.querySelector('#dnPins'); if(b){ b.classList.toggle('on',dnPinsVisible); b.setAttribute('aria-pressed',String(dnPinsVisible)); }
  if (dnTempoEl) dnTempoEl.style.display=dnPinsVisible?'flex':'none';
  return dnPinsVisible;
}

/* ---- Fly-to traversal with the symbolic time-tempo slider ---------------- */
function dnTempoDur(){ // slider frac → real animation seconds (fast→slow)
  return 0.2 + Math.pow(dnTempoFrac,1.4)*6.8;
}
function dnTempoSymbolic(){ // 247 zs → age of universe, log-mapped
  const lo=Math.log(2.47e-19), hi=Math.log(4.35e17);
  return Math.exp(lo+(hi-lo)*dnTempoFrac);
}
function dnFlyTo(destWorld, standoff, name){
  const dir=_dnV.copy(camera.position).sub(destWorld); if (dir.lengthSq()<1e-9) dir.set(0,0.4,1);
  dir.normalize();
  const end=destWorld.clone().add(dir.multiplyScalar(standoff));
  end.y += standoff*0.18;
  zoom3D.active=false;
  dnFlight={ active:true, t:0, dur:dnTempoDur(),
    p0:camera.position.clone(), t0:orbit.target.clone(), p1:end, t1:destWorld.clone() };
  if (name) toast('→ '+name+' · '+fmtSeconds(dnTempoSymbolic())+' tempo · '+dnFlight.dur.toFixed(1)+'s');
}
function dnFlyToBodyKey(key){
  const rec=planetMeshes[key]; if(!rec) { if(key==='sun'&&sun) dnFlyTo(sun.getWorldPosition(new THREE.Vector3()),14,'Sun'); return; }
  const p=PLANETS.find(x=>x.key===key);
  dnFlyTo(rec.group.getWorldPosition(new THREE.Vector3()), (p?p.size:1)*4+1.6, p?p.name:key);
}
function dnTickFlight(dt){
  if(!dnFlight||!dnFlight.active) return;
  dnFlight.t=Math.min(1, dnFlight.t+dt/dnFlight.dur);
  const u=dnFlight.t, e=u<0.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2; // smootherstep-ish
  camera.position.lerpVectors(dnFlight.p0,dnFlight.p1,e);
  orbit.target.lerpVectors(dnFlight.t0,dnFlight.t1,e);
  if (dnFlight.t>=1) dnFlight.active=false;
}
function dnPinPointer(e){
  if(!dnPinsVisible||!dnPins.length) return;
  const r=renderer.domElement.getBoundingClientRect();
  pointer.x=((e.clientX-r.left)/r.width)*2-1; pointer.y=-((e.clientY-r.top)/r.height)*2+1;
  _dnRay.setFromCamera(pointer,camera);
  const vis=dnPins.filter(s=>s.visible);
  const hit=_dnRay.intersectObjects(vis,false)[0];
  if(hit){ const m=hit.object.userData.dn;
    // NAVLINQ pick mode: clicking a body/star pin toggles its midpoint membership
    if (navMode && (m.kind==='star'||m.kind==='body')){
      navToggleBody(m.kind==='star' ? 'star:'+m.name : m.key);
      e.stopImmediatePropagation(); e.preventDefault(); return;
    }
    const world=hit.object.getWorldPosition(new THREE.Vector3());
    dnFlyTo(world, m.standoff||3, m.name);
    e.stopImmediatePropagation(); e.preventDefault();
  }
}
function dnPinHover(e){
  if(!dnTipEl) return;
  if(!dnPinsVisible||!dnPins.length){ dnTipEl.style.display='none'; return; }
  const r=renderer.domElement.getBoundingClientRect();
  pointer.x=((e.clientX-r.left)/r.width)*2-1; pointer.y=-((e.clientY-r.top)/r.height)*2+1;
  _dnRay.setFromCamera(pointer,camera);
  const hit=_dnRay.intersectObjects(dnPins.filter(s=>s.visible),false)[0];
  if(hit){ const m=hit.object.userData.dn;
    dnTipEl.textContent = m.kind==='star' ? `${m.name} · ${m.ly} ly` : m.name;
    dnTipEl.style.left=e.clientX+'px'; dnTipEl.style.top=e.clientY+'px'; dnTipEl.style.display='block';
    renderer.domElement.style.cursor='pointer';
  } else { dnTipEl.style.display='none'; renderer.domElement.style.cursor=''; }
}

/* ---- Zoom-input parser (feature 2) --------------------------------------- */
function dnParseZoom(raw){
  if(!raw) return null;
  const s=raw.trim().toLowerCase();
  // scale factor:  ×3, x3, *3, 300%
  let m=s.match(/^[x×*]\s*([0-9.eE+-]+)$/); if(m) return { kind:'scale', factor:parseFloat(m[1]) };
  m=s.match(/^([0-9.eE+-]+)\s*%$/); if(m) return { kind:'scale', factor:100/parseFloat(m[1]) }; // 200% = closer (÷2)
  // "surface" / "fit"
  if(/^surf/.test(s)) return { kind:'surface' };
  if(/^fit|^frame|^whole/.test(s)) return { kind:'fit' };
  // number + unit → physical distance (altitude above surface, or absolute for AU+)
  m=s.match(/^([0-9.eE+-]+)\s*([a-zµ]+)?$/);
  if(!m) return null;
  const val=parseFloat(m[1]); if(!isFinite(val)) return null;
  const u=(m[2]||'').replace('µ','u');
  const KM={ mm:1e-6, cm:1e-5, m:1e-3, km:1, mi:1.60934, mile:1.60934, miles:1.60934,
    au:1.495978707e8, ls:299792.458, ld:384400,
    ly:9.4607e12, pc:3.0857e13, r:'radii', radii:'radii', re:'radii' };
  let unit=u||'km';
  if(unit==='') unit='km';
  const conv=KM[unit];
  if(conv===undefined) return { kind:'bad', unit:u };
  return { kind:'dist', unit, val, absolute:['au','ly','pc'].includes(unit), radii:conv==='radii', km: conv==='radii'?null:val*conv };
}
function dnApplyZoom(parsed, readoutEl){
  const nb=dnActiveBody(); if(!nb){ if(readoutEl) readoutEl.textContent='No body in view.'; return; }
  const rkm=BODY_R_KM[nb.key]||1, kmPerScene=rkm/nb.sceneR, name=nb.key.charAt(0).toUpperCase()+nb.key.slice(1);
  orbit.target.copy(nb.center);
  const curScene=camera.position.distanceTo(nb.center);
  let targetScene, note;
  if(parsed.kind==='scale'){ targetScene=curScene/parsed.factor; note=`× ${parsed.factor} on ${name}`; }
  else if(parsed.kind==='surface'){ targetScene=nb.sceneR*1.02; note=`Skim ${name}'s surface`; }
  else if(parsed.kind==='fit'){ targetScene=nb.sceneR*5.5; note=`Frame ${name}`; }
  else if(parsed.kind==='dist'){
    let altKm;
    if(parsed.radii) altKm=(parsed.val-1)*rkm;               // N radii from centre
    else if(parsed.absolute) altKm=parsed.km - rkm;          // AU/ly/pc = distance from centre
    else altKm=parsed.km;                                    // altitude above surface
    const sceneR = parsed.absolute && !parsed.radii ? (parsed.km/kmPerScene) : nb.sceneR + Math.max(0,altKm)/kmPerScene;
    targetScene=sceneR;
    note=`${parsed.radii?parsed.val+' radii':fmtKm(parsed.absolute?parsed.km:Math.max(0,altKm))} ${parsed.absolute?'from centre':'above surface'}`;
  } else { if(readoutEl) readoutEl.textContent=`Unrecognised unit “${parsed.unit||''}”. Try km, AU, ly, ×2, 300%, surface.`; return; }
  const rawTarget=targetScene;
  targetScene=Math.max(orbit.minDistance, Math.min(orbit.maxDistance, targetScene));
  const clamped=Math.abs(targetScene-rawTarget)>rawTarget*0.001;
  zoom3D.targetR=targetScene; zoom3D.hasAnchor=false; zoom3D.active=true;
  if(readoutEl){
    const altOut=(targetScene-nb.sceneR)*kmPerScene;
    readoutEl.innerHTML=`<b>${name}</b> · ${note}<br>→ camera altitude <b>${altOut<=0?'at surface':fmtKm(altOut)}</b>`+
      (clamped?'<br><span style="color:#ffb020">clamped to the render envelope</span>':'');
  }
}
function buildZoomPanel(body){
  body.innerHTML=`<label>Distance, scale, or percentage</label>
    <input class="dn-in" id="dnZoomIn" placeholder="e.g. 500 km · 1 AU · ×2 · 300% · surface" autocomplete="off" spellcheck="false">
    <div class="dn-hint">Understood: mm·m·km·mi·AU·ls·ld·ly·pc · N r (radii) · ×2 / *2 · 300% · “surface” · “fit”. Applied to the <b>selected planet</b> (or, with nothing selected, the body nearest the view centre).</div>
    <div class="dn-read" id="dnZoomOut">Type a value and press Enter.</div>
    <div class="dn-rowbtn">
      <button class="dn-mini" data-q="surface">Surface</button>
      <button class="dn-mini" data-q="100 km">100 km</button>
      <button class="dn-mini" data-q="1 AU">1 AU</button>
      <button class="dn-mini" data-q="fit">Fit</button></div>`;
  const inp=body.querySelector('#dnZoomIn'), out=body.querySelector('#dnZoomOut');
  const run=(txt)=>{ const p=dnParseZoom(txt); if(!p){ out.textContent='Enter a number with a unit, a ×factor, or a %.'; return; } dnApplyZoom(p,out); };
  inp.addEventListener('keydown', e=>{ if(e.key==='Enter'){ run(inp.value); } });
  body.querySelectorAll('.dn-mini').forEach(b=>b.addEventListener('click',()=>{ inp.value=b.dataset.q; run(b.dataset.q); }));
}

/* ---- X·Y·Z / lat-long viewing card (feature 5) --------------------------- */
function buildCoordPanel(body){
  body.innerHTML=`<canvas class="dn-gizmo" id="dnGizmo" width="244" height="150"></canvas>
    <div class="dn-read" id="dnCoordOut" style="margin-top:9px">—</div>
    <div class="dn-hint">Your point-of-view’s live X·Y·Z in 3-D space (heliocentric — the Sun is the origin), with ecliptic longitude/latitude. The lat·long line is the surface cheat-sheet for the focused body.</div>`;
}
function dnDrawGizmo(){
  const p=dnPanels.coord; if(!p||!p.el.classList.contains('on')) return;
  const cv=p.body.querySelector('#dnGizmo'); if(!cv) return;
  const g=cv.getContext('2d'), W=cv.width, H=cv.height; g.clearRect(0,0,W,H);
  const nb=dnActiveBody(); if(!nb) return;
  const rel=_dnV.copy(camera.position).sub(nb.center);
  const r=rel.length()||1e-6;
  const lat=Math.asin(THREE.MathUtils.clamp(rel.y/r,-1,1))/DEG;
  const lon=Math.atan2(rel.z,rel.x)/DEG;
  const rkm=BODY_R_KM[nb.key]||1, altKm=(r-nb.sceneR)*(rkm/nb.sceneR);
  // sphere + lat/long grid, camera sub-point marker
  const cx=W*0.32, cy=H*0.5, R=44;
  g.strokeStyle='rgba(255,255,255,.16)'; g.lineWidth=1;
  for(let a=-60;a<=60;a+=30){ const yy=cy - R*Math.sin(a*DEG), rr=R*Math.cos(a*DEG);
    g.beginPath(); g.ellipse(cx,yy,rr,rr*0.32,0,0,Math.PI*2); g.stroke(); }
  g.beginPath(); g.arc(cx,cy,R,0,Math.PI*2); g.strokeStyle='rgba(124,92,255,.7)'; g.stroke();
  // camera sub-point
  const sx=cx+R*Math.cos(lat*DEG)*Math.cos(lon*DEG), sy=cy-R*Math.sin(lat*DEG);
  g.fillStyle='#4fd1c5'; g.beginPath(); g.arc(sx,sy,4,0,Math.PI*2); g.fill();
  // X·Y·Z tripod reflecting camera basis (project world axes to screen-ish)
  const ox=W*0.78, oy=H*0.5, L=30;
  const e=new THREE.Matrix4().lookAt(camera.position, orbit.target, camera.up);
  const bx=new THREE.Vector3().setFromMatrixColumn(e,0), by=new THREE.Vector3().setFromMatrixColumn(e,1), bz=new THREE.Vector3().setFromMatrixColumn(e,2);
  const axis=(v,col,lbl)=>{ g.strokeStyle=col; g.fillStyle=col; g.lineWidth=2;
    g.beginPath(); g.moveTo(ox,oy); g.lineTo(ox+v.x*L, oy-v.y*L); g.stroke();
    g.font='9px -apple-system,sans-serif'; g.fillText(lbl, ox+v.x*L*1.15-3, oy-v.y*L*1.15+3); };
  axis(bx,'#ff6b6b','X'); axis(by,'#4fd1c5','Y'); axis(bz,'#7c9bff','Z');
  const out=p.body.querySelector('#dnCoordOut');
  if(out){
    // The user's point-of-view IN SPACE — heliocentric, since the Sun sits at
    // the scene origin. This is the coordinate of the camera itself, not Earth.
    const cam=camera.position, dSun=cam.length()||1e-9;
    const rAU=Math.pow(dSun/SCENE_K,2);                        // invert rS = SCENE_K·√r_AU
    // scene (X,Y,Z) → ecliptic (x,y,z): x=X, y=−Z, z=Y  (auToScene maps x,z,−y)
    const eLon=Math.atan2(-cam.z, cam.x)/DEG, eLat=Math.asin(THREE.MathUtils.clamp(cam.y/dSun,-1,1))/DEG;
    const sunDist = rAU<1e-3 ? fmtKm(rAU*1.495978707e8) : (rAU<1?rAU.toFixed(4):rAU.toFixed(rAU<100?3:1))+' AU';
    const hh='font-size:9.5px;letter-spacing:.05em;text-transform:uppercase;color:#8b93ad';
    const su='color:#8b93ad;font-weight:400';
    const name=nb.key.charAt(0).toUpperCase()+nb.key.slice(1);
    out.innerHTML=
      `<div style="${hh}">Your POV · position in space</div>`+
      `X <b>${cam.x.toFixed(2)}</b> · Y <b>${cam.y.toFixed(2)}</b> · Z <b>${cam.z.toFixed(2)}</b> <span style="${su}">scene units</span><br>`+
      `Sun <b>${sunDist}</b> · ecliptic λ <b>${eLon.toFixed(2)}°</b> · β <b>${eLat.toFixed(2)}°</b>`+
      `<div style="${hh};margin-top:7px">Relative to ${name} · surface cheat-sheet</div>`+
      `lat <b>${lat.toFixed(2)}°</b> · lon <b>${lon.toFixed(2)}°</b> · alt <b>${altKm<=0?'at surface':fmtKm(altKm)}</b>`;
  }
}

/* ---- Flight tracker (feature 6) — offline great-circle simulation -------- */
function buildFlightsPanel(body){
  const codes=Object.keys(AIRPORTS).sort();
  const opts=codes.map(c=>`<option value="${c}">${AIRPORTS[c][0]}</option>`).join('');
  body.innerHTML=`<div class="dn-flrow">
      <div><label>From (IATA)</label><input class="dn-in" id="dnFrom" placeholder="ATL" maxlength="3" list="dnApList" autocomplete="off"></div>
      <div><label>To (IATA)</label><input class="dn-in" id="dnTo" placeholder="DAL" maxlength="3" list="dnApList" autocomplete="off"></div></div>
    <label>Vias (optional, comma-sep IATA)</label>
    <input class="dn-in" id="dnVia" placeholder="e.g. DFW, DEN" list="dnApList" autocomplete="off">
    <datalist id="dnApList">${opts}</datalist>
    <div class="dn-flrow" style="margin-top:7px">
      <div><label>Date</label><input class="dn-in" id="dnFDate" type="date" value="2026-08-17"></div>
      <div><label>Depart</label><input class="dn-in" id="dnFTime" type="time" value="09:30"></div></div>
    <div class="dn-rowbtn">
      <button class="dn-mini on" id="dnWx">Weather</button>
      <button class="dn-mini" id="dnPOV">Plane POV</button>
      <button class="dn-mini" id="dnFly" style="margin-left:auto">Fly ▶</button></div>
    <div class="dn-read" id="dnFOut">${codes.length} airports loaded. Type or pick codes (e.g. ATL→DAL) and press Fly. Great-circle path, day/night from the real Sun; “Plane POV” rides aboard the airliner (the world slows to the passenger’s frame); weather is a stylised offline model.</div>`;
  const q=id=>body.querySelector(id);
  q('#dnWx').addEventListener('click',e=>e.currentTarget.classList.toggle('on'));
  q('#dnPOV').addEventListener('click',e=>e.currentTarget.classList.toggle('on'));
  q('#dnFly').addEventListener('click',()=>dnStartFlight(body));
}
function dnAirport(code){ const k=(code||'').trim().toUpperCase(); return AIRPORTS[k]?{code:k,name:AIRPORTS[k][0],lat:AIRPORTS[k][1],lon:AIRPORTS[k][2]}:null; }
// Widebody twin-engine airliner (Boeing 777-300ER / 787-class silhouette),
// built from primitives — nose points toward -Z so it leads along the flight
// tangent set by holder.lookAt(). Sized relative to Earth's scene radius R.
function dnMakeAirliner(R){
  const g=new THREE.Group(); g.name='airliner';
  const U=R*0.017;                                             // base unit
  const skin =new THREE.MeshStandardMaterial({ color:0xf4f6f9, metalness:0.32, roughness:0.46 });
  const wing =new THREE.MeshStandardMaterial({ color:0xe9edf2, metalness:0.34, roughness:0.54 });
  const eng  =new THREE.MeshStandardMaterial({ color:0x30353f, metalness:0.55, roughness:0.4 });
  const livery=new THREE.MeshStandardMaterial({ color:0xd21f2b, metalness:0.28, roughness:0.5 }); // tail livery
  const glass=new THREE.MeshStandardMaterial({ color:0x14213c, metalness:0.7, roughness:0.18, emissive:0x0a1830, emissiveIntensity:0.5 });
  // fuselage (capsule along Z)
  const fus=new THREE.Mesh(new THREE.CapsuleGeometry(U*0.55, U*7.0, 6, 18), skin);
  fus.rotation.x=Math.PI/2; g.add(fus);
  // cockpit glass at the nose
  const cock=new THREE.Mesh(new THREE.SphereGeometry(U*0.5,16,12,0,Math.PI*2,0,Math.PI*0.55), glass);
  cock.rotation.x=-Math.PI/2; cock.position.z=-U*3.7; g.add(cock);
  // swept main wings + underslung engines (one per side → twinjet)
  const side=sx=>{
    const w=new THREE.Mesh(new THREE.BoxGeometry(U*3.6,U*0.10,U*1.5), wing);
    w.position.set(sx*U*2.1,-U*0.12,U*0.5); w.rotation.y=sx*0.40; w.rotation.z=sx*0.05; g.add(w);
    const nac=new THREE.Mesh(new THREE.CylinderGeometry(U*0.42,U*0.42,U*1.5,16), eng);
    nac.rotation.x=Math.PI/2; nac.position.set(sx*U*2.5,-U*0.52,U*0.05); g.add(nac);
    const intake=new THREE.Mesh(new THREE.RingGeometry(U*0.24,U*0.42,16), new THREE.MeshBasicMaterial({ color:0x0b0d12, side:THREE.DoubleSide }));
    intake.position.set(sx*U*2.5,-U*0.52,-U*0.70); g.add(intake);
    const stab=new THREE.Mesh(new THREE.BoxGeometry(U*1.6,U*0.08,U*0.8), wing);
    stab.position.set(sx*U*0.9,0,U*3.9); stab.rotation.y=sx*0.42; g.add(stab);
  };
  side(-1); side(1);
  // vertical tail fin with livery
  const fin=new THREE.Mesh(new THREE.BoxGeometry(U*0.11,U*1.5,U*1.3), livery);
  fin.position.set(0,U*0.78,U*4.0); fin.rotation.x=-0.28; g.add(fin);
  // cabin window strip (thin dark band along the fuselage)
  const band=new THREE.Mesh(new THREE.BoxGeometry(U*0.02,U*0.14,U*5.4), glass);
  band.position.set(U*0.55,U*0.05,0); g.add(band);
  const band2=band.clone(); band2.position.x=-U*0.55; g.add(band2);
  return g;
}
function dnStartFlight(body){
  const q=id=>body.querySelector(id), out=q('#dnFOut');
  const from=dnAirport(q('#dnFrom').value), to=dnAirport(q('#dnTo').value);
  if(!from||!to){ out.innerHTML='<span style="color:#ffb020">Unknown code.</span> Try e.g. JFK, LHR, DXB, HND, SIN, LAX, SYD, LOS.'; return; }
  const vias=(q('#dnVia').value||'').split(',').map(s=>dnAirport(s)).filter(Boolean);
  const legs=[from,...vias,to];
  const rec=planetMeshes.earth; if(!rec){ out.textContent='Earth not ready.'; return; }
  const R=(PLANETS.find(p=>p.key==='earth').size);
  // build great-circle polyline through all legs (on Earth group, non-rotating frame)
  if(dnFlightArc){ rec.group.remove(dnFlightArc); dnFlightArc.geometry.dispose(); dnFlightArc=null; }
  if(dnPlane){ rec.group.remove(dnPlane); dnPlane=null; }
  const pts=[]; const segIdx=[0];
  for(let i=0;i<legs.length-1;i++){
    const a=latLonToVec(legs[i].lat,legs[i].lon,1).normalize(), b=latLonToVec(legs[i+1].lat,legs[i+1].lon,1).normalize();
    const ang=Math.acos(THREE.MathUtils.clamp(a.dot(b),-1,1)), N=Math.max(24,Math.round(ang/Math.PI*160));
    for(let s=0;s<=N;s++){ const t=s/N;
      const so=Math.sin(ang)>1e-6?Math.sin((1-t)*ang)/Math.sin(ang):(1-t), sb=Math.sin(ang)>1e-6?Math.sin(t*ang)/Math.sin(ang):t;
      const dir=new THREE.Vector3(a.x*so+b.x*sb, a.y*so+b.y*sb, a.z*so+b.z*sb).normalize();
      const arc=Math.sin(t*Math.PI)*R*0.16;                 // cruise-altitude bulge
      pts.push(dir.multiplyScalar(R*1.008+arc)); }
    segIdx.push(pts.length-1);
  }
  const geo=new THREE.BufferGeometry().setFromPoints(pts);
  dnFlightArc=new THREE.Line(geo, new THREE.LineBasicMaterial({ color:0x4fd1c5, transparent:true, opacity:0.85, depthTest:false }));
  dnFlightArc.renderOrder=998; rec.group.add(dnFlightArc);
  // widebody airliner (twin-engine, Boeing 777-300ER-class silhouette)
  const pl=dnMakeAirliner(R); const holder=new THREE.Group(); holder.add(pl); rec.group.add(holder); dnPlane=holder;
  // weather (deterministic offline model seeded by route+date)
  const wxOn=q('#dnWx').classList.contains('on'), povOn=q('#dnPOV').classList.contains('on');
  const seed=_hashStr(from.code+to.code+(q('#dnFDate').value||''));
  const WX=['Clear skies','Scattered cloud','Broken cloud','Rain showers','Thunderstorms','Hail risk','Snow'];
  const wx=WX[seed%WX.length];
  dnFlight={ active:false }; // pause any camera fly-to
  const total=pts.length-1;
  dnFlightSim={ pts, holder, i:0, total, dur:(povOn?Math.max(18,total*0.055):Math.max(6,total*0.02)), t:0, povOn, wx:wxOn?wx:null, out, from, to,
    depart:(q('#dnFTime').value||'09:30'), date:(q('#dnFDate').value||'') };
  const km=dnGcKm(legs);
  out.innerHTML=`<b>${from.code}→${to.code}</b>${vias.length?' via '+vias.map(v=>v.code).join(', '):''} · ~${km.toLocaleString(undefined,{maximumFractionDigits:0})} km<br>`+
    `Depart ${dnFlightSim.depart} · ${wxOn?('weather: '+wx):'weather off'}${povOn?' · POV on':''}`;
  dnTogglePins(true);
}
function dnGcKm(legs){ let s=0; for(let i=0;i<legs.length-1;i++){ const a=legs[i],b=legs[i+1];
  const p1=a.lat*DEG,p2=b.lat*DEG,dl=(b.lon-a.lon)*DEG,dp=(b.lat-a.lat)*DEG;
  const h=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2; s+=6371*2*Math.asin(Math.min(1,Math.sqrt(h))); } return s; }
let dnFlightSim=null;
function dnTickFlightSim(dt){
  if(!dnFlightSim) return; const F=dnFlightSim;
  F.t=Math.min(1, F.t+dt/F.dur); const idx=F.t*F.total, i=Math.floor(idx), f=idx-i;
  const a=F.pts[Math.min(i,F.total)], b=F.pts[Math.min(i+1,F.total)];
  F.holder.position.lerpVectors(a,b,f);
  // orient along tangent
  const dir=_dnV.copy(b).sub(a); if(dir.lengthSq()>1e-9){ F.holder.lookAt(F.holder.position.clone().add(dir)); }
  if(F.povOn){ const rec=planetMeshes.earth; const wp=rec.group.localToWorld(F.holder.position.clone());
    const wd=rec.group.localToWorld(b.clone()).sub(rec.group.localToWorld(a.clone()));
    orbit.target.copy(wp); camera.position.copy(wp).add(wd.normalize().multiplyScalar(-0.35)).add(new THREE.Vector3(0,0.12,0)); }
  if(F.t>=1){ if(F.out) F.out.innerHTML+='<br><b style="color:#4fd1c5">Arrived.</b>'; dnFlightSim=null; }
}

/* ---- Tempo control (bottom strip) + init + per-frame tick ---------------- */
function dnBuildTempo(){
  dnTempoEl=document.createElement('div'); dnTempoEl.id='dnTempo';
  dnTempoEl.style.cssText='position:absolute;left:50%;transform:translateX(-50%);bottom:112px;z-index:11;display:flex;align-items:center;gap:9px;background:rgba(12,14,24,.66);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:7px 13px;font-size:11px;color:#c6cde0;touch-action:none';
  dnTempoEl.innerHTML=`<span class="dn-grip" title="Drag to move this control" style="cursor:grab;color:#8b93ad;font-size:13px;line-height:1;user-select:none">⠿</span>
    <span title="Symbolic traversal tempo — not literal faster-than-light; the speed of light c is never exceeded">Warp tempo</span>
    <input type="range" min="0" max="1000" value="450" style="width:150px;accent-color:#7c5cff">
    <span id="dnTempoLbl" style="min-width:66px;font-variant-numeric:tabular-nums;color:#fff">—</span>`;
  root.appendChild(dnTempoEl);
  const rng=dnTempoEl.querySelector('input'), lbl=dnTempoEl.querySelector('#dnTempoLbl');
  const upd=()=>{ dnTempoFrac=(+rng.value)/1000; lbl.textContent=fmtSeconds(dnTempoSymbolic()); };
  rng.addEventListener('input',upd); upd();
  // Draggable by its grip (like every deep-nav card) so it never sits on top of
  // another panel and traps its contents. Position persists on-device.
  const TKEY='ewiCosmosDN_tempo';
  try{ const st=JSON.parse(localStorage.getItem(TKEY)||'{}');
    if(st.x!=null){ dnTempoEl.style.left=st.x+'px'; dnTempoEl.style.top=st.y+'px'; dnTempoEl.style.bottom='auto'; dnTempoEl.style.transform='none'; } }catch(_){}
  const grip=dnTempoEl.querySelector('.dn-grip'); let gx=0,gy=0,gdrag=false;
  grip.addEventListener('pointerdown',e=>{ gdrag=true; const r=dnTempoEl.getBoundingClientRect();
    dnTempoEl.style.transform='none'; dnTempoEl.style.bottom='auto'; dnTempoEl.style.left=r.left+'px'; dnTempoEl.style.top=r.top+'px';
    gx=e.clientX-r.left; gy=e.clientY-r.top; grip.style.cursor='grabbing'; try{grip.setPointerCapture(e.pointerId);}catch(_){}; e.preventDefault(); });
  grip.addEventListener('pointermove',e=>{ if(!gdrag) return; const w=window.innerWidth,h=window.innerHeight;
    const nx=Math.max(4,Math.min(w-dnTempoEl.offsetWidth-4,e.clientX-gx)), ny=Math.max(56,Math.min(h-40,e.clientY-gy));
    dnTempoEl.style.left=nx+'px'; dnTempoEl.style.top=ny+'px'; });
  grip.addEventListener('pointerup',e=>{ gdrag=false; grip.style.cursor='grab'; try{grip.releasePointerCapture(e.pointerId);}catch(_){}
    try{ localStorage.setItem(TKEY,JSON.stringify({x:parseFloat(dnTempoEl.style.left)||0,y:parseFloat(dnTempoEl.style.top)||0})); }catch(_){}; });
}
function initDeepNav(){
  if(dnInited) return; dnInited=true;
  dnHudEl=root.querySelector('#dnHud'); dnTipEl=root.querySelector('#dnTip');
  if(dnHudEl) dnHudEl.classList.add('on');
  dnBuildPins(); dnBuildTempo();
  // pin interaction runs before the body-selection handler (capture phase)
  renderer.domElement.addEventListener('pointerdown', dnPinPointer, true);
  renderer.domElement.addEventListener('pointermove', dnPinHover, { passive:true });
}
let _dnHudAccum=0;
function deepNavTick(dt){
  if(!dnInited) return;
  dnTickFlight(dt);
  dnTickFlightSim(dt);
  // keep pin sprites a readable constant screen size regardless of dolly
  _dnHudAccum+=dt;
  if(_dnHudAccum>0.12){ _dnHudAccum=0; dnUpdateHUD(); dnDrawGizmo(); }
}

// expose a tiny hook for automated validation
window.__cosmosStudio = { open:openStudio, close, heliocentric, auToScene, PLANETS, EVENTS,
  jumpToEvent, toggleNavMode, navBarycenterAU, setRealtime, dropMyLocation,
  navToggle:(id)=>navToggleBody(id), navFlyToMidpoint,
  get navSelection(){ return [...navSel]; }, get realtime(){ return realtime; },
  get navMidpoint(){ const R=navComputeMidpoints(); if(!R) return null;
    return { count:R.nodes.length, interstellar:R.anyStar, scale:R.phys.scale,
      lon:+R.phys.lon.toFixed(3), lat:+R.phys.lat.toFixed(3), r:+R.phys.r.toFixed(5),
      span:+R.phys.span.toFixed(5), dominant:R.dom.name,
      offset:R.anyStar?null:+((R.phys.offKm)||0).toFixed(1) }; },
  get imported(){return imported;},
  get cameraDistance(){ return (camera && orbit) ? camera.position.distanceTo(orbit.target) : null; },
  // deep-nav test hooks
  dnPanel:(id)=>dnPanel(id), dnParseZoom:(s)=>dnParseZoom(s), dnTogglePins:()=>dnTogglePins(),
  dnFlyToKey:(k)=>dnFlyToBodyKey(k), get dnFocus(){ return dnNearestBody()?.key||null; },
  get dnPinCount(){ return dnPins.length; }, get dnFlying(){ return !!(dnFlight&&dnFlight.active); },
  get dnFlightActive(){ return !!dnFlightSim; }, get dnWorldSlow(){ return dnWorldSlow; }, get airportCount(){ return Object.keys(AIRPORTS).length; } };
