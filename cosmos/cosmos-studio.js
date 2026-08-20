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
let sun, sunLight, sunGlow;
let asteroidBelt, meteorSys = null;
// "Sun's End" cinematic playback — an independent, scripted stellar-death time-lapse
// (red giant → planetary nebula → white dwarf). Distinct from Explore/Cinematic
// camera modes and from the 2D/3D render switch; toggled on/off at any moment.
let novaOn = false, novaPlaying = false, novaT = 0;
const NOVA_DUR = 54;                          // seconds of wall-clock for the full time-lapse
let novaShell = null;                          // expanding planetary-nebula ejecta shell
let _novaSaved = null;                         // saved scene state for a clean restore
let novaBar = null, novaFlashEl = null;        // control "screen" + climax flash overlay
let novaRec = null;                            // active Sun's End MediaRecorder session (or null)
let novaRecComp = null;                        // per-frame compositor for the "scene + cards" export
let novaFocusOn = false;                       // focus lock — hold on the selected object, stop auto camera
// "Event Cinema" — every Jump-to-an-event scene becomes an immersive, playable
// cinematic with the *same experience as Sun's End*: a control bar (play/pause,
// a scrubber over the event's own time window, ← / → to step between events, a
// Focus lock, MP4 export, exit) driven by an auto-directed camera and per-type
// scene scripting (eclipse/shower/planetary-season/deep-time).
let ecOn = false, ecPlaying = false, ecT = 0, ecIndex = -1;
const EC_DUR = 30;                             // seconds of wall-clock for one full event playthrough
let ecAng = 0;                                 // accumulated cinematic orbit angle (rad) — driven by the per-type choreography
let ecPhase = '';                              // current scripted beat label (mirrors Sun's End phase text)
let ecBar = null;                              // Event Cinema control card
let _ecSaved = null;                           // saved scene state for a clean restore
let ecFocusOn = false;                         // focus lock — hold on the user's selected object
let ecFocusKey = 'earth';                      // the scene the event frames (Sun · planet · Moon · Earth)
let ecRec = null;                              // active Event Cinema MediaRecorder session (or null)
let ecRecComp = null;                          // per-frame compositor for the "scene + cards" export
let ecT0 = 0;                                  // camera phase seed (keeps motion continuous across seeks)
let _ecUiAccum = 0;
// ── Black holes ─────────────────────────────────────────────────────────────
// A brand-new gravitational-dynamics layer (the ephemeris renderer has none):
// user-placed black holes become fixed massive attractors, and when the sim is
// "live" every movable body (planets, the Moon riding Earth, the asteroid belt,
// and imported objects) leaves its Keplerian rail and falls under Newtonian
// gravity — superposed inverse-square accelerations integrated with a symplectic
// (semi-implicit Euler) step and Plummer softening. Trajectories are exact conic
// sections for the simulated field; the wall-clock rate is compressed for
// viewing. Newtonian gravity is valid outside the strong-field region — general
// relativity refines the motion near the horizon (r_s = 2GM/c²), which we surface
// honestly as a numeric readout rather than integrate.
const blackHoles = [];                         // [{ id,name,massMsun,rs,rs0,spin,tiltDeg,pov,pos,group,horizon,ring,disk,glow,light,parts,partData,diskSpin,captureR }]
let bhSeq = 1;
let bhDraft = null;                            // the not-yet-locked-in black hole being configured/previewed
let bhSimOn = false;                           // gravity integrator live (bodies falling in)
let bhBodies = [];                             // [{ kind,ref,pos,vel,mass,alive }] snapshot of movables during a live sim
let bhBeltVel = null, bhBeltAlive = null, bhBeltBase = null;   // asteroid-belt velocity/alive/original-position buffers
let _bhSaved = null;                           // pre-sim snapshot for a clean, reversible restore
let bhCineOn = false, bhCinePlaying = false, bhCineT = 0, bhCineTarget = null, bhCineFocusOn = false;
let bhBar = null;                              // #stBhBar cinematic control card
let bhRec = null, bhRecComp = null;            // black-hole cinematic MP4 recorder + "scene + cards" compositor (same engine as Sun's End)
let bhCineStar = null;                         // main-character Scene id the cinematic frames (null = the black hole itself)
let _bhCineUiAccum = 0;
const BH_CINE_DUR = 60;                        // seconds of wall-clock for one full black-hole cinematic
const BH_GM_REF = 26;                          // scene gravitational parameter of the reference (1e6 M☉) hole → watchable free-fall
const BH_MASS_REF = 1e6;                       // reference mass (M☉) the scene μ is calibrated to
const BH_RATE = 1.0;                           // physics time multiplier (visual pacing)
const BH_DRAG = 0.10;                          // accretion inspiral: fraction of orbital speed bled per second (per unit
                                               // proximity) to the disk / dynamical friction / gravitational radiation, so
                                               // every bound body's orbit decays and it is inevitably drawn in and absorbed
const BH_RS_KM_PER_MSUN = 2.953;               // Schwarzschild radius per solar mass: r_s = 2GM/c² ≈ 2.953 km · (M/M☉)
let bhDiskTex = null, bhGlowTex = null;        // shared, lazily-built canvas textures
const _bhReduce = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
// Scratch vectors — reused every frame to avoid per-frame allocation (resilience).
const _bhA = new THREE.Vector3(), _bhB = new THREE.Vector3(), _bhAcc = new THREE.Vector3(),
      _bhTan = new THREE.Vector3(), _bhTmp = new THREE.Vector3(), _bhUp = new THREE.Vector3(0,1,0);
// Main-character cinematic scratch — reused every frame (no per-frame allocation).
const _bhStarP = new THREE.Vector3(), _bhStarQ = new THREE.Vector3(), _bhNbP = new THREE.Vector3(), _bhMid = new THREE.Vector3();
let _bhNbR = 1;
// Selecting / dragging a black hole directly in the 3D scene.
let bhDrag = null;                             // active drag session: { bh, moved, uiN }
let bhSelRing = null;                          // reusable camera-facing selection halo
const _bhPick = new THREE.Vector2();
const _bhDragN = new THREE.Vector3(), _bhDragHit = new THREE.Vector3(), _bhDragOff = new THREE.Vector3();
const _bhDragPlane = new THREE.Plane();
// A star (the Sun) bleeds energy to a nearby hole — dimming, cooling, shrinking, dying.
let bhSunDrain = 0;                             // 0 = healthy, 1 = fully devoured
let bhSunFed = false;                           // dead-star mass already fed to the hole
let _bhSunShred = 0;                            // throttle for the plasma stream Sun → hole
const _bhSunColDead = new THREE.Color(0x140208);
const _bhSunCol = new THREE.Color();
// Remember the last render view (2D sandbox vs 3D studio) on this device, so a
// refresh / reopened tab restores exactly where the user left off.
const VIEW_KEY = 'ewi-cosmos-view';            // localStorage: '2d' | '3d'
let _restoringView = false;                    // true while auto-restoring (suppresses the opening toast)
function saveView(v){ try{ localStorage.setItem(VIEW_KEY, v); }catch(e){} }
function readView(){ try{ return localStorage.getItem(VIEW_KEY); }catch(e){ return null; } }
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
let cineVisited = new Set();                    // bodies already toured (→ always hops to nearest UNVISITED)
let cineParked = false;                        // true = user parked the camera on a body/pin → the auto-director stays yielded (no "bounce back") until they press Auto/Focus
// Auto-director dwell + playlist. The user sets how long the camera holds each
// scene (any number of seconds/minutes/hours) and the exact order it visits
// (Sun · planets · Moon · imported objects). Both persist per device.
let cineDwellSec = 8;                           // seconds the auto-director holds each scene before switching
let cinePlaylist = null;                        // ordered [{id,on}] — lazily built from the live scene, then persisted
let cinePlIndex = 0;                            // current position within the enabled playlist
let cinePlDragFrom = null;                       // drag-reorder source index within the playlist card
let cineSunSafe = false;                         // camera framing: true = "outside-Sun only" (orbit never swings the lens through the Sun); false = the current free orbit that may cross in front of the Sun
let cineListKey = undefined;                     // last id highlighted in the Scene list for the auto-director (dedupe DOM writes)
const CINE_DWELL_KEY = 'ewi-cosmos-cine-dwell';
const CINE_PL_KEY    = 'ewi-cosmos-cine-playlist';
const CINE_SUNSAFE_KEY = 'ewi-cosmos-cine-sunsafe';
let gamepadIndex = null;
let idSeq = 1;

// NAVLINQ — gravity-weighted midpoint of a chosen set of bodies
let navMode = false;
const navSel = new Set();                     // planet keys
let navGroup = null;                          // THREE.Group: links + midpoint marker
let navMidMarker = null;                      // invisible pick proxy at the midpoint → click to focus/fly there
let navOffsetMarker = null;                   // invisible pick proxy on the teal offset (centre→barycenter) line
let navFlyEngaged = false;                    // true while a fly-to-midpoint is engaged (button is a toggle)
let navLocked = false;                        // true → selection frozen; navigate freely without disturbing the midpoint
let navBadgeMode = 'readout';                 // 'readout' | 'offset' — which explainer the badge card shows
// Slide / truck camera mode: dragging (or a one-finger/trackpad gesture) moves
// the focal point (orbit.target) freely to a new X·Y·Z in space, decoupled from
// the currently-focused body — press G to toggle (tap the ✥ Slide button too).
let panMode = false;
// Align-to-plane view state: snap the camera to look straight at a principal
// coordinate plane — X·Y (front), X·Z (top), Y·Z (side) — keys 1 / 2 / 3.
let viewPlane = null;                         // 'xy' | 'xz' | 'yz' | null (free orbit)
let viewPlaneSide = 1;                         // +1 / -1 → which side of the axis we view from
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
    color:#9aa3bd;border-bottom:1px solid rgba(255,255,255,.07);
    display:flex;align-items:center;justify-content:space-between;gap:8px}
  .st-panel h4 .st-x{appearance:none;border:0;background:rgba(255,255,255,.06);color:#c6cde0;
    width:24px;height:24px;border-radius:7px;font-size:12px;line-height:1;cursor:pointer;flex:none;
    display:inline-flex;align-items:center;justify-content:center;transition:background .15s,color .15s}
  .st-panel h4 .st-x:hover{background:rgba(255,90,90,.28);color:#fff}
  .st-panel h4 .st-x:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}
  .st-scroll{overflow:auto;padding:8px}
  .st-item{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:9px;cursor:pointer;font-size:12.5px;position:relative;transition:background .15s}
  .st-item:hover{background:rgba(255,255,255,.05)}
  .st-item.sel{background:rgba(124,92,255,.2)}
  /* Cinematic "now showing" — the object the auto-director is currently framing, kept in perfect sync with the show */
  .st-item.cine-now{background:linear-gradient(90deg,rgba(124,92,255,.34),rgba(124,92,255,.12));box-shadow:inset 0 0 0 1px rgba(124,92,255,.55)}
  .st-item.cine-now::before{content:"";position:absolute;left:0;top:6px;bottom:6px;width:3px;border-radius:3px;background:#b9a6ff;box-shadow:0 0 8px rgba(124,92,255,.9);animation:cineNowPulse 1.6s ease-in-out infinite}
  .st-item.cine-now>span:nth-of-type(2){color:#fff;font-weight:700}
  @keyframes cineNowPulse{0%,100%{opacity:.55}50%{opacity:1}}
  @media (prefers-reduced-motion:reduce){.st-item.cine-now::before{animation:none;opacity:.9}}
  .st-dot{width:11px;height:11px;border-radius:50%;flex:none}
  .st-item .x{margin-left:auto;opacity:.5;font-size:13px}
  .st-item .x:hover{opacity:1}
  /* Black Holes group in the Scene list — a parent header with ＋/− and a live count, then one indented, independently-deletable sub-row per hole */
  .st-bhgroup{margin-top:2px}
  .st-item.st-bhhead>span:nth-of-type(2){font-weight:700}
  .st-bhhead .bhg-count{margin-left:6px;min-width:1.5em;height:17px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums;color:#efe9ff;background:rgba(150,130,255,.2);border:1px solid rgba(150,130,255,.4);border-radius:9px}
  .st-bhhead .bhg-ctl{margin-left:auto;display:flex;gap:5px;align-items:center}
  .st-bhhead .bhg-btn{appearance:none;width:22px;height:22px;line-height:1;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(150,130,255,.45);background:rgba(150,130,255,.14);color:#efe9ff;border-radius:7px;font-size:15px;font-weight:700;cursor:pointer;transition:background .15s,border-color .15s}
  .st-bhhead .bhg-btn:hover:not(:disabled){background:rgba(150,130,255,.3);border-color:rgba(150,130,255,.7)}
  .st-bhhead .bhg-btn:disabled{opacity:.4;cursor:default}
  .st-item.st-bhsub{margin-left:18px;font-size:12px}
  .st-item.bh-star{background:linear-gradient(90deg,rgba(184,166,255,.32),rgba(124,92,255,.12));box-shadow:inset 0 0 0 1px rgba(184,166,255,.5)}
  .st-item.bh-star>span:nth-of-type(2){color:#fff;font-weight:700}
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
    background:rgba(12,14,24,.82);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:8px 12px;
    transition:opacity .3s ease,transform .32s cubic-bezier(.22,.61,.36,1)}
  .st-time .st-time-x{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#c6cde0;
    width:28px;height:28px;border-radius:8px;font-size:16px;line-height:1;cursor:pointer;flex:none;
    display:inline-flex;align-items:center;justify-content:center;transition:background .15s,border-color .15s,color .15s}
  .st-time .st-time-x:hover{background:rgba(124,92,255,.2);border-color:rgba(124,92,255,.5);color:#fff}
  .st-time .st-time-x:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}
  /* Dynamic Island — collapsed time pill; morphs to/from the full card via crossfade + scale. */
  .st-pill{position:absolute;left:50%;bottom:12px;transform:translateX(-50%) scale(.92);z-index:4;
    display:inline-flex;align-items:center;gap:9px;height:40px;padding:0 17px;border-radius:999px;
    border:1px solid rgba(255,255,255,.14);background:rgba(12,14,24,.82);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
    color:#eef1f8;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;cursor:pointer;
    opacity:0;pointer-events:none;box-shadow:0 8px 26px rgba(0,0,0,.45);
    transition:opacity .3s ease,transform .32s cubic-bezier(.22,.61,.36,1),background .15s,border-color .15s}
  .st-pill:hover{background:rgba(124,92,255,.22);border-color:rgba(124,92,255,.5)}
  .st-pill:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}
  .st-pill .pill-dot{width:8px;height:8px;border-radius:50%;background:#8a7cff;box-shadow:0 0 8px rgba(124,92,255,.9);flex:none}
  .st-pill.live .pill-dot{background:#37d67a;box-shadow:0 0 8px rgba(55,214,122,.95);animation:pillPulse 1.6s ease-in-out infinite}
  @keyframes pillPulse{0%,100%{opacity:.55}50%{opacity:1}}
  @media (prefers-reduced-motion:reduce){.st-pill.live .pill-dot{animation:none}}
  /* Collapsed state: the card fades/scales out, the pill fades/scales in (same centre → Dynamic-Island morph). */
  #studioRoot.time-collapsed .st-time{opacity:0;transform:translateX(-50%) scale(.92);pointer-events:none}
  #studioRoot.time-collapsed .st-pill{opacity:1;transform:translateX(-50%) scale(1);pointer-events:auto}
  .st-time input[type=date]{background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);color:#e8ecf6;border-radius:8px;padding:5px 7px;font-size:12.5px}
  .st-time input[type=range]{width:120px;accent-color:#7c5cff}
  .st-hint{position:absolute;right:276px;bottom:14px;z-index:4;font-size:11px;color:#8b93ad;max-width:250px;text-align:right;pointer-events:none;
    display:flex;align-items:flex-start;justify-content:flex-end;gap:6px}
  .st-hint-txt{pointer-events:none;text-align:right;max-width:230px}
  .st-hint-x{pointer-events:auto;flex:none;appearance:none;border:1px solid rgba(255,255,255,.14);
    background:rgba(12,14,24,.72);color:#c6cde0;width:18px;height:18px;border-radius:50%;font-size:10px;line-height:1;
    cursor:pointer;display:inline-flex;align-items:center;justify-content:center;margin-top:1px;
    -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);transition:background .15s,color .15s,border-color .15s}
  .st-hint-x:hover{background:rgba(255,90,90,.28);color:#fff;border-color:transparent}
  .st-hint-x:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}
  .st-help-chip{position:absolute;right:14px;bottom:14px;z-index:4;display:none;align-items:center;justify-content:center;
    width:30px;height:30px;border-radius:50%;appearance:none;border:1px solid rgba(255,255,255,.14);
    background:rgba(12,14,24,.72);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
    color:#c6cde0;font:700 14px -apple-system,system-ui,sans-serif;cursor:pointer;
    box-shadow:0 6px 20px rgba(0,0,0,.35);transition:background .15s,color .15s,border-color .15s,transform .15s}
  .st-help-chip:hover{background:rgba(124,92,255,.22);border-color:rgba(124,92,255,.55);color:#fff;transform:translateY(-1px)}
  .st-help-chip:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}
  #studioRoot.st-hint-off .st-hint{display:none}
  #studioRoot.st-hint-off .st-help-chip{display:inline-flex}
  .st-drop{position:absolute;inset:52px 0 0 0;z-index:8;display:none;align-items:center;justify-content:center;
    background:rgba(90,63,214,.22);border:3px dashed rgba(124,92,255,.7);margin:12px;border-radius:18px;
    font-size:20px;font-weight:800;color:#fff;pointer-events:none}
  #studioRoot.dragging .st-drop{display:flex}
  .st-toast{position:absolute;left:50%;top:66px;transform:translateX(-50%);z-index:9;background:rgba(20,22,34,.95);
    border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:8px 14px;font-size:12.5px;opacity:0;transition:opacity .2s;pointer-events:none}
  .st-toast.show{opacity:1}
  .st-badge{position:absolute;left:50%;transform:translateX(-50%);bottom:64px;z-index:6;background:rgba(124,92,255,.16);border:1px solid rgba(124,92,255,.5);
    border-radius:12px;padding:9px 14px;font-size:12px;max-width:min(440px,86vw);max-height:min(46vh,360px);overflow-y:auto;overscroll-behavior:contain;text-align:center;display:none}
  .st-badge::-webkit-scrollbar{width:9px}
  .st-badge::-webkit-scrollbar-thumb{background:rgba(124,92,255,.5);border-radius:8px}
  .st-badge::-webkit-scrollbar-track{background:transparent}
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
  .st-cine .cine-sep{width:1px;height:22px;background:rgba(255,255,255,.16);margin:0 2px}
  .st-cine .cine-dwell{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;color:#c6cde0;font-weight:600}
  .st-cine .cine-dwell input{width:52px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.16);
    background:rgba(255,255,255,.05);color:#e8ecf6;font-size:12.5px;font-weight:700;text-align:center;padding:0 4px}
  .st-cine .cine-dwell input:focus-visible{outline:2px solid #7c5cff;outline-offset:1px}
  .st-cine .cine-dwell select{height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.16);
    background:rgba(255,255,255,.05);color:#e8ecf6;font-size:12px;font-weight:600;padding:0 4px;cursor:pointer}
  .st-cine .cine-dwell select:focus-visible{outline:2px solid #7c5cff;outline-offset:1px}
  /* Cinematic playlist — reorderable pop-up card (always available in Cinematic) */
  .st-cine-pl{position:absolute;left:50%;top:100px;transform:translateX(-50%);z-index:9;display:none;
    flex-direction:column;gap:8px;width:min(340px,92vw);max-height:min(60vh,520px);padding:12px 12px 10px;
    border-radius:14px;background:rgba(12,14,24,.95);backdrop-filter:blur(12px);
    border:1px solid rgba(124,92,255,.42);box-shadow:0 14px 40px rgba(0,0,0,.55)}
  .st-cine-pl.on{display:flex}
  .st-cine-pl .pl-head{display:flex;align-items:center;gap:8px}
  .st-cine-pl .pl-title{font-weight:800;font-size:13px;color:#d9cffb;white-space:nowrap}
  .st-cine-pl .pl-sub{font-size:10.5px;color:#8a93a8;white-space:nowrap}
  .st-cine-pl .pl-spacer{flex:1}
  .st-cine-pl .pl-head button{appearance:none;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);
    color:#e8ecf6;height:26px;padding:0 9px;border-radius:8px;font-size:11.5px;font-weight:700;cursor:pointer}
  .st-cine-pl .pl-head button:hover{background:rgba(124,92,255,.2);border-color:rgba(124,92,255,.55)}
  .st-cine-pl .pl-rows{display:flex;flex-direction:column;gap:5px;overflow:auto;padding:2px 1px}
  .st-cine-pl .pl-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:9px;
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}
  .st-cine-pl .pl-row.pl-drag{opacity:.5;border-color:rgba(124,92,255,.6)}
  .st-cine-pl .pl-row.pl-over{border-color:rgba(124,92,255,.8);background:rgba(124,92,255,.14)}
  .st-cine-pl .pl-row .pl-grip{cursor:grab;color:#8a93a8;font-size:14px;user-select:none;touch-action:none}
  .st-cine-pl .pl-row input[type=checkbox]{width:16px;height:16px;accent-color:#7c5cff;cursor:pointer;flex:none}
  .st-cine-pl .pl-row .pl-name{flex:1;font-size:12.5px;color:#e8ecf6;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .st-cine-pl .pl-row.pl-off .pl-name{color:#8a93a8;font-weight:500}
  .st-cine-pl .pl-row .pl-mv{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);
    color:#c6cde0;width:24px;height:24px;border-radius:7px;font-size:12px;cursor:pointer;flex:none;
    display:inline-flex;align-items:center;justify-content:center}
  .st-cine-pl .pl-row .pl-mv:hover:not(:disabled){background:rgba(124,92,255,.2);border-color:rgba(124,92,255,.55)}
  .st-cine-pl .pl-row .pl-mv:disabled{opacity:.32;cursor:not-allowed}
  .st-cine-pl .pl-row *:focus-visible,.st-cine-pl .pl-head button:focus-visible{outline:2px solid #7c5cff;outline-offset:1px}
  .st-cine-pl .pl-note{font-size:10.5px;line-height:1.45;color:#8a93a8}
  /* Sun's End — independent stellar-death playback */
  .st-btn#stNova.on{background:linear-gradient(180deg,#ff8a3c,#e0431f);border-color:transparent;color:#fff;
    box-shadow:0 0 0 1px rgba(255,138,60,.5),0 6px 18px rgba(224,67,31,.35)}
  .st-nova{position:absolute;left:50%;bottom:112px;transform:translateX(-50%);z-index:8;display:none;
    flex-direction:column;gap:8px;width:min(560px,92vw);padding:12px 14px;border-radius:14px;
    background:rgba(14,12,20,.9);backdrop-filter:blur(12px);border:1px solid rgba(255,138,60,.42);
    box-shadow:0 10px 34px rgba(0,0,0,.5)}
  .st-nova.on{display:flex}
  /* Fluid header: title + phase shrink (ellipsis) and the button group wraps to a
     second line before anything can be pushed outside the card frame. */
  .st-nova .nv-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .st-nova .nv-title{font-weight:800;font-size:13px;color:#ffd9b8;letter-spacing:.2px;white-space:nowrap;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
  .st-nova .nv-time{font-size:11.5px;color:#9aa3bd;font-variant-numeric:tabular-nums;white-space:nowrap;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis}
  .st-nova .nv-spacer{flex:1 1 0;min-width:0}
  .st-nova .nv-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-left:auto;flex:0 0 auto}
  .st-nova .nv-scrub{-webkit-appearance:none;appearance:none;width:100%;height:6px;border-radius:6px;cursor:pointer;
    background:linear-gradient(90deg,#ff8a3c 0%,#e0431f var(--nvp,0%),rgba(255,255,255,.14) var(--nvp,0%))}
  .st-nova .nv-scrub::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;border-radius:50%;
    background:#fff;border:2px solid #e0431f;cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,.4)}
  .st-nova .nv-scrub::-moz-range-thumb{width:15px;height:15px;border-radius:50%;background:#fff;border:2px solid #e0431f;cursor:pointer}
  .st-nova .nv-note{font-size:11px;line-height:1.5;color:#c6cde0}
  .st-nova .nv-note b{color:#ffd9b8}
  .st-nova button{appearance:none;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#e8ecf6;
    height:30px;min-width:32px;padding:0 12px;border-radius:8px;font-size:12.5px;font-weight:700;cursor:pointer;
    display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background .15s,border-color .15s}
  .st-nova button:hover{background:rgba(255,138,60,.2);border-color:rgba(255,138,60,.55)}
  .st-nova button:disabled{opacity:.4;cursor:not-allowed}
  .st-nova #stNovaExport.nv-rec{color:#ffb3b3;border-color:rgba(255,90,90,.6);background:rgba(255,60,60,.18)}
  .st-nova #stNovaFocus.on{background:linear-gradient(180deg,#7c5cff,#5a3fd6);border-color:transparent;color:#fff;
    box-shadow:0 0 0 1px rgba(124,92,255,.5),0 6px 18px rgba(90,63,214,.35)}
  .st-nova .nv-menu{position:absolute;right:10px;bottom:calc(100% + 8px);display:flex;flex-direction:column;gap:6px;
    padding:8px;border-radius:12px;background:rgba(14,12,20,.97);border:1px solid rgba(255,138,60,.4);
    box-shadow:0 20px 60px rgba(0,0,0,.6);z-index:20}
  .st-nova .nv-menu button{white-space:nowrap;justify-content:flex-start;text-align:left;min-width:210px}
  .st-nova-flash{position:absolute;inset:0;z-index:7;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 50%,#fff 0%,#ffd9a0 38%,rgba(255,180,110,0) 72%)}
  /* Event Cinema — the Sun's-End player re-skinned for events (violet accent) */
  .st-nova.st-ec{border-color:rgba(124,92,255,.44)}
  .st-nova.st-ec .nv-title{color:#d9cffb}
  .st-nova.st-ec .nv-note b{color:#d9cffb}
  .st-nova.st-ec .ec-idx{font-size:11px;color:#8a93a8;font-variant-numeric:tabular-nums;white-space:nowrap}
  .st-nova.st-ec .nv-scrub{background:linear-gradient(90deg,#7c5cff 0%,#5a3fd6 var(--nvp,0%),rgba(255,255,255,.14) var(--nvp,0%))}
  .st-nova.st-ec .nv-scrub::-webkit-slider-thumb{border-color:#5a3fd6}
  .st-nova.st-ec .nv-scrub::-moz-range-thumb{border-color:#5a3fd6}
  .st-nova.st-ec button:hover{background:rgba(124,92,255,.2);border-color:rgba(124,92,255,.55)}
  .st-nova.st-ec #stEcExport.nv-rec{color:#ffb3b3;border-color:rgba(255,90,90,.6);background:rgba(255,60,60,.18)}
  .st-nova.st-ec #stEcFocus.on{background:linear-gradient(180deg,#7c5cff,#5a3fd6);border-color:transparent;color:#fff;
    box-shadow:0 0 0 1px rgba(124,92,255,.5),0 6px 18px rgba(90,63,214,.35)}
  /* Black-hole toolbar button + cinematic bar + config dialog (indigo/amber accent) */
  .st-btn#stBlackHole.on{background:linear-gradient(180deg,#8a7cff,#4b3fb0);border-color:transparent;color:#fff;
    box-shadow:0 0 0 1px rgba(138,124,255,.5),0 6px 18px rgba(75,63,176,.4)}
  .st-nova.st-bh{border-color:rgba(150,130,255,.5);background:rgba(10,10,18,.92)}
  .st-nova.st-bh .nv-title{color:#e6dcff}
  .st-nova.st-bh .nv-note b{color:#ffd9a8}
  .st-nova.st-bh .nv-scrub{background:linear-gradient(90deg,#ffcf9a 0%,#ff8a3c var(--nvp,0%),rgba(255,255,255,.14) var(--nvp,0%))}
  .st-nova.st-bh .nv-scrub::-webkit-slider-thumb{border-color:#ff8a3c}
  .st-nova.st-bh .nv-scrub::-moz-range-thumb{border-color:#ff8a3c}
  .st-nova.st-bh button:hover{background:rgba(150,130,255,.22);border-color:rgba(150,130,255,.6)}
  .st-nova.st-bh #stBhFocus.on{background:linear-gradient(180deg,#8a7cff,#4b3fb0);border-color:transparent;color:#fff;
    box-shadow:0 0 0 1px rgba(138,124,255,.5),0 6px 18px rgba(75,63,176,.35)}
  .st-nova .nv-rec{background:linear-gradient(180deg,#ff5a6a,#c11f38)!important;border-color:transparent!important;color:#fff!important;
    box-shadow:0 0 0 1px rgba(255,90,106,.5),0 6px 18px rgba(193,31,56,.4);animation:nvRecPulse 1.1s ease-in-out infinite}
  @keyframes nvRecPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.28)}}
  /* Black-hole count card — Warp-Tempo-style floating pop-up (only while BH mode is active) */
  .st-bhcount{position:absolute;left:14px;bottom:180px;z-index:9;display:none;align-items:center;gap:8px;
    padding:7px 10px;border-radius:13px;border:1px solid rgba(150,130,255,.5);background:rgba(10,10,18,.94);
    box-shadow:0 10px 30px rgba(0,0,0,.5);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px);
    font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#e6dcff;user-select:none;touch-action:none}
  .st-bhcount.on{display:flex}
  .st-bhcount .bhc-grip{cursor:grab;color:#8a7cff;font-size:14px;padding:2px 1px;line-height:1;opacity:.85}
  .st-bhcount .bhc-grip:active{cursor:grabbing}
  .st-bhcount .bhc-ic{color:#b8a6ff;font-size:14px}
  .st-bhcount .bhc-lab{color:#c9bdf0;font-weight:600;letter-spacing:.2px;opacity:.9}
  .st-bhcount .bhc-n{min-width:1.4em;text-align:center;font-variant-numeric:tabular-nums;font-size:15px;font-weight:800;color:#fff}
  .st-bhcount button{appearance:none;border:1px solid rgba(150,130,255,.45);background:rgba(150,130,255,.14);color:#efe9ff;
    width:26px;height:26px;border-radius:8px;font-size:16px;font-weight:800;line-height:1;cursor:pointer;display:grid;place-items:center;
    transition:background .12s,border-color .12s,transform .08s}
  .st-bhcount button.bhc-reset{width:auto;padding:0 9px;font-size:12px;font-weight:700}
  .st-bhcount button:hover:not(:disabled){background:rgba(150,130,255,.28);border-color:rgba(150,130,255,.7)}
  .st-bhcount button:active:not(:disabled){transform:scale(.94)}
  .st-bhcount button:disabled{opacity:.38;cursor:not-allowed}
  .st-bhcount button:focus-visible{outline:2px solid #b8a6ff;outline-offset:2px}
  /* Configure-and-lock-in dialog — right side, above the Inspector */
  .st-bhform{position:absolute;right:12px;top:64px;z-index:13;width:min(300px,86vw);max-height:calc(100% - 150px);overflow-y:auto;
    display:flex;flex-direction:column;gap:9px;padding:13px 14px;border-radius:14px;
    background:rgba(10,10,18,.95);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);
    border:1px solid rgba(150,130,255,.5);box-shadow:0 18px 54px rgba(0,0,0,.6);
    animation:bhFormIn .28s cubic-bezier(.22,.61,.36,1)}
  @keyframes bhFormIn{from{opacity:0;transform:translateY(-8px) scale(.97)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.st-bhform{animation:none}}
  .st-bhform .bhf-h{display:flex;align-items:center;justify-content:space-between;font-weight:800;font-size:13.5px;color:#e6dcff;letter-spacing:.2px}
  .st-bhform .bhf-x{appearance:none;border:0;background:rgba(255,255,255,.06);color:#c6cde0;width:26px;height:26px;border-radius:7px;font-size:13px;cursor:pointer}
  .st-bhform .bhf-x:hover{background:rgba(255,90,90,.28);color:#fff}
  .st-bhform .bhf-row{display:flex;flex-direction:column;gap:3px;font-size:11px;color:#9aa3bd}
  .st-bhform .bhf-row input[type=text]{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#eef1f8;padding:6px 9px;font-size:12.5px}
  .st-bhform .bhf-row input[type=range]{width:100%;accent-color:#8a7cff;cursor:pointer}
  .st-bhform .bhf-read{font-size:11px;color:#ffd9a8;font-variant-numeric:tabular-nums;margin-top:-3px}
  .st-bhform .bhf-xyz{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px}
  .st-bhform .bhf-xyz label{display:flex;flex-direction:column;gap:3px;font-size:10.5px;color:#9aa3bd}
  .st-bhform .bhf-xyz input{width:100%;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#eef1f8;padding:5px 7px;font-size:12px;font-variant-numeric:tabular-nums}
  .st-bhform select{background:rgba(20,20,32,.96);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#eef1f8;padding:6px 9px;font-size:12.5px;cursor:pointer}
  .st-bhform .bhf-note{font-size:10.5px;line-height:1.5;color:#9aa3bd}
  .st-bhform .bhf-actions{display:flex;gap:8px;margin-top:2px}
  .st-bhform .bhf-go{flex:1;appearance:none;border:0;border-radius:9px;padding:9px 12px;font-size:12.5px;font-weight:800;cursor:pointer;color:#fff;
    background:linear-gradient(180deg,#8a7cff,#4b3fb0);box-shadow:0 6px 18px rgba(75,63,176,.4)}
  .st-bhform .bhf-go:hover{filter:brightness(1.08)}
  .st-bhform .bhf-cancel{appearance:none;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#e8ecf6;border-radius:9px;padding:9px 12px;font-size:12.5px;font-weight:700;cursor:pointer}
  .st-bhform .bhf-cancel:hover{background:rgba(255,90,90,.2);border-color:rgba(255,90,90,.5)}
  /* Inspector panel for a locked-in black hole */
  .st-insp-bh .ib-h{font-weight:800;font-size:13.5px;color:#e6dcff;margin-bottom:7px}
  .st-insp-bh .ib-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11.5px;color:#9aa3bd;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)}
  .st-insp-bh .ib-row b{color:#eef1f8;font-variant-numeric:tabular-nums;text-align:right}
  .st-insp-bh .ib-actions{display:flex;gap:8px;margin:10px 0 8px}
  .st-insp-bh .ib-actions .bhf-go{flex:1;appearance:none;border:0;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:800;cursor:pointer;color:#fff;background:linear-gradient(180deg,#8a7cff,#4b3fb0)}
  .st-insp-bh .ib-actions .bhf-cancel{appearance:none;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#e8ecf6;border-radius:9px;padding:8px 10px;font-size:12px;font-weight:700;cursor:pointer}
  .st-insp-bh .ib-actions .bhf-cancel:hover{background:rgba(255,90,90,.2);border-color:rgba(255,90,90,.5)}
  .st-insp-bh .ib-note{font-size:10.5px;line-height:1.5;color:#8a93a8}
  .st-item.bh .st-dot,.st-dot.st-bhdot{display:flex;align-items:center;justify-content:center;font-size:9px;line-height:1;color:#c9bcff;
    background:radial-gradient(circle at 40% 35%,#3a2d6e,#0a0714 72%)!important;box-shadow:0 0 7px rgba(138,124,255,.7)}
  /* Warp-tempo dock / undock — Apple-esque integration into (and segregation out
     of) the Scene, Inspector, or Time card. */
  .st-panel.dn-has-tempo .st-scroll{flex:1 1 auto;min-height:0}
  #dnTempo.dn-docked{position:static!important;left:auto!important;top:auto!important;bottom:auto!important;transform:none!important;
    flex:none;width:auto;margin:9px;background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.12);flex-wrap:wrap;
    transition:transform .34s cubic-bezier(.22,.61,.36,1),background .2s,border-color .2s}
  #dnTempo.dn-docked input[type=range]{flex:1 1 90px;width:auto}
  #dnTempo.dn-docked-time{margin:0 0 0 6px;width:auto;flex-wrap:nowrap}
  #dnTempo.dn-dragging{box-shadow:0 18px 46px rgba(0,0,0,.55);border-color:rgba(124,92,255,.6)}
  .st-left.dn-dock-target,.st-right.dn-dock-target,.st-time.dn-dock-target{
    outline:2px dashed rgba(124,92,255,.9);outline-offset:3px;
    box-shadow:0 0 0 4px rgba(124,92,255,.18),0 12px 34px rgba(90,63,214,.28)}
  @media (prefers-reduced-motion:reduce){#dnTempo,#dnTempo.dn-docked{transition:none!important}}
  @media (max-width:820px){
    .st-panel{width:44vw;max-width:250px;top:60px;bottom:120px}
    .st-hint{display:none}
    .st-bar{gap:6px;overflow-x:auto}
    .st-bar .st-btn span.lbl{display:none}
  }
  @media (max-width:560px){
    .st-panel{width:min(86vw,320px);height:auto;bottom:auto;top:60px;max-height:44vh}
    .st-home .g{margin:0}
    .st-home span:not(.g){display:none}
    .st-time{flex-wrap:wrap;max-width:calc(100vw - 24px);justify-content:center}
  }

  /* ---- Universal card dismissal + dynamic, device-aware layout ---- */
  /* Every side panel slides fully off-screen and fades when dismissed — the
     motion reads calm and intentional (Apple-style), never a hard pop. */
  .st-panel{transition:transform .32s cubic-bezier(.22,.61,.36,1),opacity .24s ease}
  .st-left.st-hidden{transform:translateX(calc(-100% - 16px));opacity:0;pointer-events:none}
  .st-right.st-hidden{transform:translateX(calc(100% + 16px));opacity:0;pointer-events:none}
  /* Slim edge tabs bring a hidden panel back without crowding the toolbar. */
  .st-tab{position:absolute;top:50%;transform:translateY(-50%);z-index:5;display:none;
    align-items:center;justify-content:center;writing-mode:vertical-rl;text-orientation:mixed;
    padding:15px 7px;font-size:11px;font-weight:700;letter-spacing:.07em;color:#c6cde0;
    background:rgba(12,14,24,.82);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);
    border:1px solid rgba(255,255,255,.1);cursor:pointer;
    transition:background .15s,border-color .15s,color .15s}
  .st-tab:hover{background:rgba(124,92,255,.2);border-color:rgba(124,92,255,.5);color:#fff}
  .st-tab:focus-visible{outline:2px solid #7c5cff;outline-offset:2px}
  .st-tab.on{display:inline-flex}
  #stTabLeft{left:0;border-left:0;border-radius:0 13px 13px 0}
  #stTabRight{right:0;border-right:0;border-radius:13px 0 0 13px}
  /* Immersive view — one control clears every overlay for a pure, clean sky. */
  #studioRoot.immersive .st-panel,#studioRoot.immersive .st-time,#studioRoot.immersive .st-pill,#studioRoot.immersive .st-hint,#studioRoot.immersive .st-help-chip,
  #studioRoot.immersive .st-badge,#studioRoot.immersive .st-cine,#studioRoot.immersive .st-cine-pl,
  #studioRoot.immersive .st-nova,#studioRoot.immersive .dn-hud,#studioRoot.immersive .st-tab,
  #studioRoot.immersive .dn-panel{opacity:0;pointer-events:none;transition:opacity .28s ease}
  #studioRoot.immersive .st-bar{transform:translateY(-100%);
    transition:transform .34s cubic-bezier(.22,.61,.36,1)}
  .st-restore{position:absolute;top:calc(12px + env(safe-area-inset-top,0px));left:50%;
    transform:translateX(-50%);z-index:10;display:none;align-items:center;gap:7px;height:36px;
    padding:0 15px;border-radius:999px;border:1px solid rgba(255,255,255,.16);
    background:rgba(12,14,24,.8);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);
    color:#e8ecf6;font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:0 8px 26px rgba(0,0,0,.45)}
  #studioRoot.immersive .st-restore{display:inline-flex}
  .st-restore:hover{background:rgba(124,92,255,.24);border-color:rgba(124,92,255,.55)}
  .st-btn#stImmersive.on{background:linear-gradient(180deg,#7c5cff,#5a3fd6);border-color:transparent;color:#fff}
  /* Notch / home-indicator safe areas so nothing hides behind device cutouts. */
  .st-bar{padding-left:max(12px,env(safe-area-inset-left));
    padding-right:max(12px,env(safe-area-inset-right));padding-top:env(safe-area-inset-top,0px);
    min-height:52px;height:auto}
  .st-time{bottom:max(12px,env(safe-area-inset-bottom,0px))}
  .st-pill{bottom:max(12px,env(safe-area-inset-bottom,0px))}
  /* Touch devices: enlarge every hit target to a comfortable ≥40px (WCAG 2.2). */
  @media (pointer:coarse){
    .st-btn{height:40px}
    .st-seg .st-btn{height:38px}
    .st-cine button,.st-nova button{height:38px;min-width:40px}
    .st-panel h4 .st-x,.dn-x{width:32px;height:32px;font-size:15px}
    .st-cine-pl .pl-row .pl-mv{width:32px;height:32px}
    .st-tab{padding:20px 10px;font-size:12px}
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
  .dn-body{padding:11px 12px;font-size:12.5px;max-height:min(64vh,560px);overflow-y:auto;overscroll-behavior:contain}
  .dn-body::-webkit-scrollbar{width:9px}
  .dn-body::-webkit-scrollbar-thumb{background:rgba(124,92,255,.45);border-radius:8px}
  .dn-body::-webkit-scrollbar-track{background:transparent}
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
    line-height:1.5;color:#c6cde0;max-width:230px;font-variant-numeric:tabular-nums;display:none;
    transition:opacity .24s ease,transform .24s ease}
  .dn-hud.on{display:block}
  /* The alt/scale details card belongs to the Scene corner — hiding the Scene panel hides it too. */
  #studioRoot.left-hidden .dn-hud{opacity:0;transform:translateY(6px);pointer-events:none}
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
  .nv-chip.sel{background:rgba(124,92,255,.28);border-color:#7c5cff;color:#fff;box-shadow:0 0 0 1px rgba(124,92,255,.4) inset}
  .nv-sec{font:700 11px -apple-system,system-ui,sans-serif;color:#c6cde0;margin:9px 0 4px;letter-spacing:.02em}
  .nv-scrollx{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:2px 0;scrollbar-width:thin;scrollbar-color:rgba(124,92,255,.6) transparent;cursor:grab}
  .nv-scrollx:active{cursor:grabbing}
  .nv-scrollx::-webkit-scrollbar{height:10px}
  .nv-scrollx::-webkit-scrollbar-thumb{background:rgba(124,92,255,.6);border-radius:8px}
  .nv-scrollx::-webkit-scrollbar-track{background:rgba(255,255,255,.05);border-radius:8px}
  .nv-scrollhint{font:600 9.5px -apple-system,system-ui,sans-serif;color:#8892ac;margin:1px 0 3px;display:flex;align-items:center;gap:4px}
  .nv-scrollhint::before{content:"\\2194";color:#7c5cff;font-size:12px}
  .nv-tbl{width:100%;border-collapse:collapse;font:600 10.5px -apple-system,system-ui,sans-serif;color:#dfe4f2}
  .nv-tbl th,.nv-tbl td{padding:4px 7px;text-align:right;white-space:nowrap;border-bottom:1px solid rgba(255,255,255,.07)}
  .nv-tbl th:first-child,.nv-tbl td:first-child{text-align:left}
  .nv-tbl th{color:#9aa3bd;font-weight:700;cursor:help}
  .nv-read{font:500 11px -apple-system,system-ui,sans-serif;color:#c6cde0;margin:4px 0;line-height:1.5}
  .nv-read b{color:#fff}
  .nv-foot{font:500 10px -apple-system,system-ui,sans-serif;color:#8b93ad;margin-top:6px;line-height:1.55}
  .nv-foot b{color:#aeb6cf}
  .nv-lay{font:500 9.5px -apple-system,system-ui,sans-serif;color:#8892ac;margin-top:1px;font-style:italic}
  .nv-eta{font:600 11px -apple-system,system-ui,sans-serif;color:#dfe4f2;margin:6px 0;line-height:1.55;padding:6px 8px;border:1px solid rgba(124,92,255,.28);border-radius:8px;background:rgba(124,92,255,.08)}
  .nv-eta b{color:#fff}
  .dn-mini.on{background:rgba(124,92,255,.30);border-color:rgba(124,92,255,.6);color:#fff}
  .nv-travel{margin-top:8px;border-top:1px solid rgba(255,255,255,.08);padding-top:4px}`;
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
      <button class="st-btn" id="stNova" title="Sun's End — play a cinematic, sped-up time-lapse of the Sun's death (red giant → planetary nebula → white dwarf). Click to start or stop; drag to change your view while it plays." aria-pressed="false">☀ <span class="lbl">Sun's&nbsp;End</span></button>
      <button class="st-btn" id="stBlackHole" title="Black Hole — add one or more black holes to the Solar System. Set each hole's mass, size, position, spin, tilt and POV independently, lock in, and watch every body fall in under accurate Newtonian gravity.">◕ <span class="lbl">Black&nbsp;Hole</span></button>
      <div class="grow"></div>
      <button class="st-btn ghost" id="stAdd" title="Add a primitive">＋ <span class="lbl">Add</span></button>
      <button class="st-btn ghost" id="stImport" title="Import a model, image, video, or audio">⬆ <span class="lbl">Import</span></button>
      <button class="st-btn ghost" id="stNav" title="NAVLINQ — pick 2+ bodies to compute their gravity-weighted midpoint" aria-pressed="false">◎ <span class="lbl">NAVLINQ</span></button>
      <button class="st-btn ghost" id="stPan" title="Slide / truck (G) — drag or use a one-finger / trackpad gesture to glide the focal point to a new X·Y·Z, independent of the focused body" aria-pressed="false">✥ <span class="lbl">Slide</span></button>
      <div class="st-seg" role="group" aria-label="Align the view to a principal plane" title="Snap the camera to look straight at a coordinate plane — front (X·Y), top (X·Z) or side (Y·Z). Keys 1 / 2 / 3; press again to view from the opposite side. Then drag to fine-tune, wheel / pinch to zoom, ✥ Slide to reframe.">
        <button class="st-btn" id="stPlaneXY" title="Front view — look at the X·Y plane, down the Z axis (X → right, Y → up). Key 1" aria-pressed="false">XY</button>
        <button class="st-btn" id="stPlaneXZ" title="Top view — look at the X·Z plane, down the Y axis (X → right, Z → up). Key 2" aria-pressed="false">XZ</button>
        <button class="st-btn" id="stPlaneYZ" title="Side view — look at the Y·Z plane, down the X axis (Z → right, Y → up). Key 3" aria-pressed="false">YZ</button>
      </div>
      <button class="st-btn ghost" id="stLoc" title="Drop a pin at your real-world location on Earth">📍 <span class="lbl">Location</span></button>
      <button class="st-btn ghost on" id="dnPins" title="Toggle waypoint thumbtacks" aria-pressed="true">📌 <span class="lbl">Pins</span></button>
      <button class="st-btn ghost" id="dnZoom" title="Precision zoom — type a distance, %, or scale">🔍 <span class="lbl">Zoom</span></button>
      <button class="st-btn ghost" id="dnCoord" title="Latitude / Longitude · X·Y·Z viewing card">🧭 <span class="lbl">Coordinates</span></button>
      <button class="st-btn ghost" id="dnFlights" title="Flight tracker — plan and fly routes">✈ <span class="lbl">Flights</span></button>
      <select class="st-btn ghost" id="stEvent" title="Jump to a real or predicted event" style="max-width:230px"></select>
      <button class="st-btn ghost" id="stSave" title="Save scene to this browser">💾 <span class="lbl">Save</span></button>
      <button class="st-btn ghost" id="stExport" title="Export scene as a file">⇩ <span class="lbl">Export</span></button>
      <button class="st-btn ghost" id="stImmersive" title="Immersive view — hide every panel and control for a clean sky. Press again, or tap “Show controls”, to bring them back." aria-pressed="false">⛶ <span class="lbl">Immersive</span></button>
      <div class="st-seg" role="group" aria-label="Render style" style="margin-left:2px">
        <button class="st-btn" id="stView2d" title="Back to the 2D physics sandbox">◫ <span class="lbl">2D</span></button>
        <button class="st-btn on" id="stView3d" title="3D cinematic studio" aria-pressed="true">◈ <span class="lbl">3D</span></button>
      </div>
    </div>

    <aside class="st-panel st-left">
      <h4><span>Scene</span><button class="st-x" id="stCloseLeft" type="button" title="Hide the Scene panel" aria-label="Hide the Scene panel">✕</button></h4>
      <div class="st-scroll" id="stObjList"></div>
    </aside>

    <aside class="st-panel st-right">
      <h4><span>Inspector</span><button class="st-x" id="stCloseRight" type="button" title="Hide the Inspector panel" aria-label="Hide the Inspector panel">✕</button></h4>
      <div class="st-scroll" id="stInspector"><div class="st-note">Select a body or imported object to inspect and transform it.</div></div>
    </aside>

    <button class="st-tab" id="stTabLeft" type="button" title="Show the Scene panel" aria-label="Show the Scene panel">Scene</button>
    <button class="st-tab" id="stTabRight" type="button" title="Show the Inspector panel" aria-label="Show the Inspector panel">Inspector</button>
    <button class="st-restore" id="stRestore" type="button" title="Show the controls again">◱ Show controls</button>

    <div class="st-badge" id="stBadge"></div>
    <div class="dn-hud" id="dnHud"></div>
    <div class="dn-tip" id="dnTip"></div>

    <div class="st-cine" id="stCineDock">
      <button id="stCineAuto" class="on" title="Auto-directed cinematic camera">🎬 Auto</button>
      <button id="stCinePrev" title="Nearest neighbouring body — back">←</button>
      <span class="nm" id="stCineName">Auto-directed</span>
      <button id="stCineNext" title="Nearest neighbouring body — next">→</button>
      <button id="stCineFocus" title="Focus the selected body (or nearest body)">◎ Focus</button>
      <span class="cine-sep" aria-hidden="true"></span>
      <button id="stCineView" class="cine-view" aria-pressed="false" title="Camera framing. Off = the current free orbit that can swing the lens through the Sun to keep the scene’s object in view. On = “outside-Sun only”, so every shot stays on the outer side and the camera never passes through the Sun.">🎥 Through-Sun</button>
      <span class="cine-sep" aria-hidden="true"></span>
      <label class="cine-dwell" for="stCineDwellN" title="How long the auto-director holds each scene before switching to the next in the playlist">
        <span>Hold each</span>
        <input type="number" id="stCineDwellN" min="1" max="999" step="1" value="8" inputmode="numeric" aria-label="Auto-switch hold time — amount" />
        <select id="stCineDwellU" aria-label="Auto-switch hold time — unit">
          <option value="1">sec</option>
          <option value="60">min</option>
          <option value="3600">hr</option>
        </select>
      </label>
      <button id="stCinePlaylist" title="Choose which scenes the auto-director visits, and the order" aria-haspopup="dialog" aria-expanded="false">☰ Playlist</button>
    </div>

    <div class="st-cine-pl" id="stCinePlCard" role="dialog" aria-label="Cinematic playlist order" aria-modal="false">
      <div class="pl-head">
        <span class="pl-title">🎬 Playlist order</span>
        <span class="pl-sub">Cinematic auto-switch</span>
        <span class="pl-spacer"></span>
        <button id="stCinePlReset" class="pl-reset" title="Restore the default Sun-outward order and re-enable every scene">↺ Reset</button>
        <button id="stCinePlClose" class="pl-close" title="Close" aria-label="Close playlist">✕</button>
      </div>
      <div class="pl-rows" id="stCinePlRows"></div>
      <div class="pl-note">Drag ⠿ or use ↑ ↓ to reorder · tick to include · the show loops through your enabled scenes in this order.</div>
    </div>

    <div class="st-nova-flash" id="stNovaFlash"></div>
    <div class="st-nova" id="stNovaBar">
      <div class="nv-top">
        <span class="nv-title">☀ Sun's End</span>
        <span class="nv-time" id="stNovaPhase">Main sequence · the Sun today</span>
        <span class="nv-spacer"></span>
        <div class="nv-actions">
          <button id="stNovaPlay" title="Pause / resume playback">⏸</button>
          <button id="stNovaReplay" title="Replay from the beginning">↺</button>
          <button id="stNovaFocus" title="Focus lock — hold on your selected object and stop the auto camera" aria-pressed="false">◎ Focus</button>
          <button id="stNovaExport" title="Export this Sun&rsquo;s End as an MP4 video">⤓ MP4</button>
          <button id="stNovaExit" title="Exit — return to the normal 3D view">✕</button>
        </div>
      </div>
      <input type="range" class="nv-scrub" id="stNovaScrub" min="0" max="1000" value="0" step="1" aria-label="Scrub the time-lapse" />
      <div class="nv-note" id="stNovaNote"></div>
    </div>

    <div class="st-nova st-ec" id="stEcBar">
      <div class="nv-top">
        <span class="nv-title">🎬 <span id="stEcTitle">Event</span></span>
        <span class="nv-time" id="stEcTime"></span>
        <span class="nv-spacer"></span>
        <div class="nv-actions">
          <span class="ec-idx" id="stEcIdx"></span>
          <button id="stEcPrev" title="Previous event">←</button>
          <button id="stEcPlay" title="Pause / resume playback">⏸</button>
          <button id="stEcReplay" title="Replay this event from the beginning">↺</button>
          <button id="stEcNext" title="Next event">→</button>
          <button id="stEcFocus" title="Focus lock — hold on your selected object and stop the auto camera" aria-pressed="false">◎ Focus</button>
          <button id="stEcExport" title="Export this event scene as an MP4 video">⤓ MP4</button>
          <button id="stEcExit" title="Exit — return to the normal 3D view">✕</button>
        </div>
      </div>
      <input type="range" class="nv-scrub" id="stEcScrub" min="0" max="1000" value="0" step="1" aria-label="Scrub the event timeline" />
      <div class="nv-note" id="stEcNote"></div>
    </div>

    <div class="st-nova st-bh" id="stBhBar">
      <div class="nv-top">
        <span class="nv-title">◕ <span id="stBhTitle">Black Hole</span></span>
        <span class="nv-time" id="stBhPhase">Approach</span>
        <span class="nv-spacer"></span>
        <div class="nv-actions">
          <button id="stBhPlay" title="Pause / resume the cinematic">⏸</button>
          <button id="stBhReplay" title="Restart — replay the whole event from the moment the black hole was placed">↺</button>
          <button id="stBhFocus" title="Focus lock — hold on your selected object and stop the auto camera" aria-pressed="false">◎ Focus</button>
          <button id="stBhAdd" title="Add another independent black hole">＋ Hole</button>
          <button id="stBhExport" title="Export this black-hole cinematic as an MP4 video">⤓ MP4</button>
          <button id="stBhExit" title="Exit the cinematic — the black hole and its physics keep running">✕</button>
        </div>
      </div>
      <input type="range" class="nv-scrub" id="stBhScrub" min="0" max="1000" value="0" step="1" aria-label="Scrub the black-hole cinematic" />
      <div class="nv-note" id="stBhNote"></div>
    </div>

    <!-- Black-hole count card — a Warp-Tempo-style floating pop-up that only appears while
         Black Hole mode is active. Lets you add / remove / reset holes without hunting for
         the toolbar toggle (so you never accidentally switch the whole mode off). -->
    <div class="st-bhcount" id="stBhCount" role="group" aria-label="Number of black holes" hidden>
      <span class="bhc-grip" id="stBhCountGrip" title="Drag to move this card" aria-hidden="true">⠿</span>
      <span class="bhc-ic" aria-hidden="true">◕</span>
      <button id="stBhCountMinus" title="Remove the most recent black hole" aria-label="Remove a black hole">−</button>
      <span class="bhc-n" id="stBhCountN" aria-live="polite" aria-atomic="true">0</span>
      <span class="bhc-lab">Black&nbsp;Holes</span>
      <button id="stBhCountPlus" title="Add and customize a black hole" aria-label="Add a black hole">＋</button>
      <button id="stBhCountReset" class="bhc-reset" title="Remove every black hole (reset to zero)" aria-label="Reset to zero">Reset</button>
    </div>

    <div class="st-time" id="stTime">
      <button class="st-time-x" id="stTimeCollapse" type="button" title="Collapse into the time pill" aria-label="Collapse the time controls into a pill" aria-expanded="true">⌄</button>
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
    <!-- Dynamic Island — the collapsed form of the time card: a single glanceable pill (live date + time) that expands back into the full controls on tap. Self-contained (never needs the immersive “Show controls” overlay to return). -->
    <button class="st-pill" id="stTimePill" type="button" title="Show date, time & the time controls" aria-label="Show date, time and the time controls" aria-expanded="false">
      <span class="pill-dot" aria-hidden="true"></span>
      <span class="pill-txt" id="stPillTxt">—</span>
    </button>

    <div class="st-hint" id="stHint">
      <span class="st-hint-txt">Explore: drag orbit · scroll / pinch zoom · right-drag or two-finger pan · <b>1/2/3</b> front·top·side view · <b>G</b> slide · <b>H</b> immersive · <b>W/E/R</b> move·rotate·scale · <b>F</b> focus · <b>Del</b> remove · gamepad supported</span>
      <button class="st-hint-x" id="stHintHide" type="button" title="Hide these tips" aria-label="Hide the on-screen exploration tips">✕</button>
    </div>
    <button class="st-help-chip" id="stHintShow" type="button" title="Show the exploration tips" aria-label="Show the exploration tips">?</button>

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
  novaBar     = root.querySelector('#stNovaBar');
  novaFlashEl = root.querySelector('#stNovaFlash');
  ecBar       = root.querySelector('#stEcBar');
  bhBar       = root.querySelector('#stBhBar');

  // event dropdown — grouped by category
  const sel = root.querySelector('#stEvent');
  const cats = [];
  EVENTS.forEach((e,i)=>{ let g=cats.find(c=>c.cat===(e.cat||'Events')); if(!g){ g={cat:e.cat||'Events', items:[]}; cats.push(g); } g.items.push(i); });
  sel.innerHTML = '<option value="">Jump to an event…</option>' +
    cats.map(g=>`<optgroup label="${g.cat}">`+
      g.items.map(i=>`<option value="${i}">${EVENTS[i].date || EVENTS[i].epoch} · ${EVENTS[i].name}</option>`).join('')+
      `</optgroup>`).join('');
  sel.addEventListener('change', ()=>{ if (sel.value!=='') ecEnter(+sel.value); });

  // wiring
  root.querySelector('#stView2d').addEventListener('click', close);
  camBtnExp.addEventListener('click', ()=>setCamMode('explore'));
  camBtnCine.addEventListener('click', ()=>setCamMode('cinematic'));
  root.querySelector('#stCineAuto').addEventListener('click', cineAuto);
  root.querySelector('#stCinePrev').addEventListener('click', ()=>cineStep(-1));
  root.querySelector('#stCineNext').addEventListener('click', ()=>cineStep(1));
  root.querySelector('#stCineFocus').addEventListener('click', cineFocusSelected);
  root.querySelector('#stCineView').addEventListener('click', cineToggleView);
  // Auto-director dwell time + reorderable playlist card
  root.querySelector('#stCineDwellN').addEventListener('input', cineApplyDwellFromUI);
  root.querySelector('#stCineDwellN').addEventListener('change', ()=>{ cineApplyDwellFromUI(); cineSyncDwellUI(); });
  root.querySelector('#stCineDwellU').addEventListener('change', ()=>{ cineApplyDwellFromUI(); cineSyncDwellUI(); });
  root.querySelector('#stCinePlaylist').addEventListener('click', ()=>cinePlToggleCard());
  root.querySelector('#stCinePlClose').addEventListener('click', ()=>cinePlToggleCard(false));
  root.querySelector('#stCinePlReset').addEventListener('click', cinePlReset);
  cineLoadPrefs(); cineSyncDwellUI(); cineSyncViewUI();
  // Sun's End — independent stellar-death time-lapse (toggle on/off at any time)
  root.querySelector('#stNova').addEventListener('click', ()=>novaToggle());
  root.querySelector('#stNovaPlay').addEventListener('click', novaTogglePlay);
  root.querySelector('#stNovaReplay').addEventListener('click', novaReplay);
  root.querySelector('#stNovaFocus').addEventListener('click', novaToggleFocus);
  root.querySelector('#stNovaExport').addEventListener('click', novaExportMenu);
  root.querySelector('#stNovaExit').addEventListener('click', ()=>novaExit());  root.querySelector('#stNovaScrub').addEventListener('input', e=>novaSeek((+e.target.value)/1000));
  // Event Cinema — immersive player for every Jump-to-an-event scene
  root.querySelector('#stEcPrev').addEventListener('click', ()=>ecStep(-1));
  root.querySelector('#stEcNext').addEventListener('click', ()=>ecStep(1));
  root.querySelector('#stEcPlay').addEventListener('click', ecTogglePlay);
  root.querySelector('#stEcReplay').addEventListener('click', ecReplay);
  root.querySelector('#stEcFocus').addEventListener('click', ecToggleFocus);
  root.querySelector('#stEcExport').addEventListener('click', ecExportMenu);
  root.querySelector('#stEcExit').addEventListener('click', ()=>ecExit());
  root.querySelector('#stEcScrub').addEventListener('input', e=>ecSeek((+e.target.value)/1000));
  root.querySelector('#stBlackHole').addEventListener('click', ()=>bhOpenForm());
  root.querySelector('#stBhPlay').addEventListener('click', bhCineTogglePlay);
  root.querySelector('#stBhReplay').addEventListener('click', bhCineReplay);
  root.querySelector('#stBhFocus').addEventListener('click', bhCineToggleFocus);
  root.querySelector('#stBhAdd').addEventListener('click', ()=>bhOpenForm());
  root.querySelector('#stBhExport').addEventListener('click', bhExportMenu);
  root.querySelector('#stBhExit').addEventListener('click', ()=>bhCineExit());
  root.querySelector('#stBhScrub').addEventListener('input', e=>bhCineSeek((+e.target.value)/1000));
  // Black-hole count card (+/− pop-up, Warp-Tempo style)
  root.querySelector('#stBhCountPlus').addEventListener('click', bhCountPlus);
  root.querySelector('#stBhCountMinus').addEventListener('click', bhCountMinus);
  root.querySelector('#stBhCountReset').addEventListener('click', bhCountReset);
  bhCountInitDrag();
  bhCountRefresh();
  root.querySelector('#stAdd').addEventListener('click', addPrimitiveMenu);
  root.querySelector('#stImport').addEventListener('click', ()=>root.querySelector('#stFile').click());
  root.querySelector('#stFile').addEventListener('change', e=>{ handleFiles(e.target.files); e.target.value=''; });
  root.querySelector('#stNav').addEventListener('click', toggleNavMode);
  root.querySelector('#stPan').addEventListener('click', ()=>setPanMode(!panMode));
  root.querySelector('#stPlaneXY').addEventListener('click', ()=>alignViewPlane('xy'));
  root.querySelector('#stPlaneXZ').addEventListener('click', ()=>alignViewPlane('xz'));
  root.querySelector('#stPlaneYZ').addEventListener('click', ()=>alignViewPlane('yz'));
  root.querySelector('#stLoc').addEventListener('click', dropMyLocation);
  root.querySelector('#dnPins').addEventListener('click', ()=>dnTogglePins());
  root.querySelector('#dnZoom').addEventListener('click', ()=>dnPanel('zoom').toggle());
  root.querySelector('#dnCoord').addEventListener('click', ()=>dnPanel('coord').toggle());
  root.querySelector('#dnFlights').addEventListener('click', ()=>dnPanel('flights').toggle());
  root.querySelector('#stSave').addEventListener('click', saveScene);
  root.querySelector('#stExport').addEventListener('click', exportScene);
  // Universal card dismissal + immersive view
  root.querySelector('#stCloseLeft').addEventListener('click', ()=>panelShow('left', false));
  root.querySelector('#stCloseRight').addEventListener('click', ()=>panelShow('right', false));
  root.querySelector('#stTabLeft').addEventListener('click', ()=>panelShow('left', true));
  root.querySelector('#stTabRight').addEventListener('click', ()=>panelShow('right', true));
  root.querySelector('#stImmersive').addEventListener('click', ()=>toggleImmersive());
  root.querySelector('#stRestore').addEventListener('click', ()=>toggleImmersive(false));
  root.querySelector('#stTimeCollapse').addEventListener('click', ()=>timeDockSet(true));
  root.querySelector('#stTimePill').addEventListener('click', ()=>timeDockSet(false));
  // Exploration tips — dismissible; the choice (hint ⇄ “?” chip) persists on-device.
  const _hintApply = (off)=>{ root.classList.toggle('st-hint-off', off);
    try{ localStorage.setItem('ewiCosmosHint', off?'off':'on'); }catch(_){} };
  try{ if(localStorage.getItem('ewiCosmosHint')==='off') root.classList.add('st-hint-off'); }catch(_){}
  root.querySelector('#stHintHide').addEventListener('click', ()=>_hintApply(true));
  root.querySelector('#stHintShow').addEventListener('click', ()=>_hintApply(false));
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

/* ---- Universal card dismissal + dynamic layout ----------------------------
   Every side panel can be hidden (its header ✕) and reopened (a slim edge tab),
   and one Immersive control clears all chrome. Choices persist per device so a
   small screen stays calm and a large screen stays rich. */
const PANEL_KEY = { left:'ewi-cosmos-panel-left', right:'ewi-cosmos-panel-right' };
function panelSel(side){ return side==='left' ? '.st-left' : '.st-right'; }
function panelShow(side, show, persist){
  const panel = root.querySelector(panelSel(side));
  const tab   = root.querySelector(side==='left' ? '#stTabLeft' : '#stTabRight');
  if (!panel) return;
  panel.classList.toggle('st-hidden', !show);
  if (tab) tab.classList.toggle('on', !show);
  // The bottom-left object-details card (alt / scale HUD) lives in the Scene corner:
  // hide it with the Scene panel and restore it when the panel returns.
  if (side === 'left') root.classList.toggle('left-hidden', !show);
  if (persist !== false){ try{ localStorage.setItem(PANEL_KEY[side], show ? '1' : '0'); }catch(_){} }
}
function panelToggle(side){
  const panel = root.querySelector(panelSel(side));
  if (panel) panelShow(side, panel.classList.contains('st-hidden'));
}
function applyPanelPrefs(){
  const smallDefault = window.matchMedia('(max-width:820px)').matches; // phones/tablets start clean
  ['left','right'].forEach(side=>{
    let saved = null; try{ saved = localStorage.getItem(PANEL_KEY[side]); }catch(_){}
    const show = saved === null ? !smallDefault : saved === '1';
    panelShow(side, show, false);
  });
}
function toggleImmersive(force){
  if (!root) return;
  const on = (force === undefined) ? !root.classList.contains('immersive') : !!force;
  root.classList.toggle('immersive', on);
  const b = root.querySelector('#stImmersive');
  if (b){ b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
  if (on) toast('Immersive view · tap “Show controls” to restore');
  else    toast('Controls restored');
}

/* ---- Time dock — Apple “Dynamic Island” collapse -----------------------------
   The bottom time card collapses into a single glanceable pill (live date +
   time) and expands back on tap — a self-contained control that never depends on
   the Immersive “Show controls” overlay to return. The choice persists per device
   (phones start collapsed for a calm, uncluttered sky). */
const TIME_DOCK_KEY = 'ewi-cosmos-time-collapsed';
function timeDockSet(collapsed, persist){
  if (!root) return;
  root.classList.toggle('time-collapsed', collapsed);
  const pill = root.querySelector('#stTimePill'); if (pill) pill.setAttribute('aria-expanded', String(!collapsed));
  const cb = root.querySelector('#stTimeCollapse'); if (cb) cb.setAttribute('aria-expanded', String(!collapsed));
  if (persist !== false){ try{ localStorage.setItem(TIME_DOCK_KEY, collapsed ? '1' : '0'); }catch(_){} }
  updateLocalClock();                            // populate the pill / card immediately
}
function timeDockToggle(){ if (root) timeDockSet(!root.classList.contains('time-collapsed')); }
function applyTimeDockPref(){
  const smallDefault = window.matchMedia('(max-width:560px)').matches;   // phones start as the compact pill
  let saved = null; try{ saved = localStorage.getItem(TIME_DOCK_KEY); }catch(_){}
  const collapsed = saved === null ? smallDefault : saved === '1';
  timeDockSet(collapsed, false);
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
  // Any manual camera interaction (orbit / pan) leaves an aligned plane view →
  // clear the highlighted plane button so the UI honestly reflects the state.
  orbit.addEventListener('start', ()=>{ if (viewPlane!==null){ viewPlane=null; updatePlaneBtns(); } });
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
  sunGlow = glow;

  // planets
  for (const p of PLANETS) buildPlanet(p);
  buildAsteroidBelt();

  updatePlanets();
  refreshObjList();
  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  // Grab a black hole directly (capture phase, ahead of OrbitControls) to drag it through space.
  window.addEventListener('pointerdown', bhGrabPointer, true);
  const markInput = ()=>{ cineLastInput = performance.now(); };
  renderer.domElement.addEventListener('pointerdown', markInput);
  renderer.domElement.addEventListener('wheel', markInput, { passive:true });
  renderer.domElement.addEventListener('wheel', onWheelDolly, { passive:false });
  // Mobile: two-finger pinch → smooth cursor-anchored zoom (mirrors the wheel
  // dolly). OrbitControls keeps one-finger orbit + two-finger pan; pinch adds the
  // missing zoom axis so touch feels like a native map/globe. See onTouchPinch*.
  renderer.domElement.addEventListener('touchstart', onTouchPinchStart, { passive:true });
  renderer.domElement.addEventListener('touchmove',  onTouchPinchMove,  { passive:false });
  renderer.domElement.addEventListener('touchend',   onTouchPinchEnd,   { passive:true });
  renderer.domElement.addEventListener('touchcancel',onTouchPinchEnd,   { passive:true });
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

/* ---- Auto-director dwell + playlist ------------------------------------------
   The Cinematic auto-director no longer cuts between a fixed, random handful of
   planets. Instead it follows an explicit, user-owned playlist (order + which
   scenes are included) and holds each scene for a user-set dwell time. Both are
   remembered per device so the show the user composed persists across visits. */
function cineDefaultOrder(){
  // Sun outward, with the Moon nested right after Earth — the natural tour.
  return ['sun','mercury','venus','earth','moon','mars','jupiter','saturn','uranus','neptune'];
}
function cineLoadPrefs(){
  try{ const d = parseFloat(localStorage.getItem(CINE_DWELL_KEY)); if (isFinite(d) && d>0) cineDwellSec = Math.min(86400, Math.max(1, d)); }catch(_){}
  try{
    const raw = localStorage.getItem(CINE_PL_KEY);
    if (raw){ const arr = JSON.parse(raw); if (Array.isArray(arr)) cinePlaylist = arr.filter(x=>x&&typeof x.id==='string').map(x=>({ id:x.id, on:x.on!==false })); }
  }catch(_){}
  try{ cineSunSafe = localStorage.getItem(CINE_SUNSAFE_KEY) === '1'; }catch(_){}
}
function cineSavePrefs(){
  try{ localStorage.setItem(CINE_DWELL_KEY, String(cineDwellSec)); }catch(_){}
  try{ localStorage.setItem(CINE_PL_KEY, JSON.stringify(cinePlaylist||[])); }catch(_){}
  try{ localStorage.setItem(CINE_SUNSAFE_KEY, cineSunSafe ? '1' : '0'); }catch(_){}
}
// View selector — flip between the current free orbit (may cross the Sun) and
// "outside-Sun only" framing, then persist + reflect the choice in the toolbar.
function cineToggleView(force){
  cineSunSafe = (force===undefined) ? !cineSunSafe : !!force;
  cineSavePrefs(); cineSyncViewUI();
}
function cineSyncViewUI(){
  if (!root) return;
  const b = root.querySelector('#stCineView'); if (!b) return;
  b.classList.toggle('on', cineSunSafe);
  b.setAttribute('aria-pressed', String(cineSunSafe));
  b.textContent = cineSunSafe ? '☀︎ Outside-Sun' : '🎥 Through-Sun';
}
// Keep the Scene-list "now showing" highlight in perfect sync with the
// auto-director: highlight the body the cinematic camera is currently framing
// (auto playlist scene, or the Focus target), and clear it otherwise.
function cineSyncList(){
  if (!objListEl) return;
  const id = (camMode==='cinematic' && !cineParked)
    ? (cineFocusOn ? cineFocusId : cineFocusKey)
    : null;
  if (id === cineListKey) return;
  cineListKey = id;
  objListEl.querySelectorAll('.st-item').forEach(el =>
    el.classList.toggle('cine-now', id != null && el.dataset.id === String(id)));
}
// Build the playlist once from the default order (only scenes that actually
// exist), then keep it reconciled with the live scene: append any imported
// objects at the tail, drop entries whose object has gone away. This is the
// "always working" guarantee — the card reflects exactly what's in the scene.
function cineEnsurePlaylist(){
  const probe = _cineA;
  if (!cinePlaylist){
    cinePlaylist = cineDefaultOrder()
      .filter(id => cineCenterOf(id, probe) >= 0)
      .map(id => ({ id, on:true }));
  }
  const live = cineFocusList();
  const liveSet = new Set(live);
  cinePlaylist = cinePlaylist.filter(it => liveSet.has(it.id));
  for (const id of live){ if (!cinePlaylist.some(it => it.id===id)) cinePlaylist.push({ id, on:true }); }
  return cinePlaylist;
}
function cineEnabledSeq(){
  cineEnsurePlaylist();
  const probe = _cineB;
  return cinePlaylist.filter(it => it.on && cineCenterOf(it.id, probe) >= 0).map(it => it.id);
}

function tickCinematic(dt){
  // The user parked the camera (clicked a thumbtack, or picked a body in the
  // Scene list) → hold that POV indefinitely and never let the auto-director
  // snatch it back. Control returns to the show only when the user explicitly
  // presses "Auto" (or enters Focus). This is what "the user always keeps
  // control" means: no automatic bounce-back a few seconds after arriving.
  if (cineParked) return;
  // Non-restrictive cinematic: if the user is actively steering (recent orbit
  // drag or wheel), yield full control and don't auto-cut. Auto-direction
  // resumes a few seconds after the user lets go.
  if (performance.now() - cineLastInput < 4000) return;
  // Focus sub-mode: lock onto one chosen body of mass and glide around it,
  // instead of the auto-director cutting between bodies.
  if (cineFocusOn && cineFocusId){ cineTickFocus(dt); return; }
  cineT += dt; cineNextCut -= dt;
  if (cineNextCut <= 0){
    const seq = cineEnabledSeq();
    if (seq.length){
      cinePlIndex = (cinePlIndex + 1) % seq.length;
      cineFocusKey = seq[cinePlIndex];
    }
    cineNextCut = Math.max(1, cineDwellSec);     // hold each scene for the user's dwell time
  }
  // Resolve the focused scene's world centre + radius (works for the Sun, any
  // planet, the Moon, and imported objects). If it vanished mid-tour, snap to
  // the first still-available scene rather than freezing on a dead target.
  let cRad = cineCenterOf(cineFocusKey, _cineA);
  if (cRad < 0){
    const seq = cineEnabledSeq(); if (!seq.length) return;
    cinePlIndex = Math.min(cinePlIndex, seq.length - 1);
    cineFocusKey = seq[cinePlIndex];
    cRad = cineCenterOf(cineFocusKey, _cineA); if (cRad < 0) return;
  }
  const tgt = _cineA;
  const radius = 6 + cRad*3;
  let desired;
  // "Outside-Sun only" framing: keep the lens on the hemisphere facing AWAY from
  // the Sun so the orbit never swings the camera through the Sun, while still
  // holding the scene's object dead-centre. We build an orthonormal basis around
  // the outward radial (Sun→target) direction and sway within ±~66° of it, so the
  // outward component of the view direction always stays positive (never crosses
  // to the Sun-facing side). For the Sun itself this can't apply → free orbit.
  if (cineSunSafe && cineFocusKey !== 'sun'){
    if (sun) sun.getWorldPosition(_cineSun); else _cineSun.set(0,0,0);
    _cineOut.copy(tgt).sub(_cineSun);
    if (_cineOut.lengthSq() < 1e-6){
      const ang = cineT*0.18;
      desired = _cineDesired.set(tgt.x + Math.cos(ang)*radius, tgt.y + Math.max(2.4, radius*0.28), tgt.z + Math.sin(ang)*radius);
    } else {
      _cineOut.normalize();
      _cineRight.crossVectors(_worldUp, _cineOut);
      if (_cineRight.lengthSq() < 1e-6) _cineRight.set(1,0,0);
      _cineRight.normalize();
      _cineUp2.crossVectors(_cineOut, _cineRight).normalize();
      const sway = Math.sin(cineT*0.16) * 1.15;                 // ±~66° — stays on the Sun-far hemisphere
      const bob  = 0.34 + Math.sin(cineT*0.5)*0.12;
      _cineDir.copy(_cineOut).multiplyScalar(Math.cos(sway))
        .addScaledVector(_cineRight, Math.sin(sway))
        .addScaledVector(_cineUp2, bob)
        .normalize();
      desired = _cineDesired.copy(tgt).addScaledVector(_cineDir, radius);
    }
  } else {
    const ang = cineT*0.18;
    desired = _cineDesired.set(
      tgt.x + Math.cos(ang)*radius,
      tgt.y + Math.max(2.4, radius*0.28) + Math.sin(cineT*0.5)*1.2,
      tgt.z + Math.sin(ang)*radius
    );
  }
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
// Scratch vectors for the "outside-Sun only" cinematic framing basis (reused each frame).
const _cineSun = new THREE.Vector3();
const _cineOut = new THREE.Vector3();
const _cineRight = new THREE.Vector3();
const _cineUp2 = new THREE.Vector3();
const _cineDir = new THREE.Vector3();
const _cineDesired = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0,1,0);

function cineFocusList(){
  const ids = [];
  if (sun) ids.push('sun');
  for (const p of PLANETS) if (planetMeshes[p.key]) ids.push(p.key);
  if (moon) ids.push('moon');
  for (const bh of blackHoles) ids.push(bh.id);
  for (const im of imported) ids.push(im.id);
  return ids;
}
function cineCenterOf(id, out){
  if (id==='sun' && sun){ sun.getWorldPosition(out); return 3; }
  if (id==='moon' && moon){ moon.mesh.getWorldPosition(out); return 0.6; }
  if (planetMeshes[id]){ planetMeshes[id].group.getWorldPosition(out); return (PLANETS.find(p=>p.key===id)?.size||1); }
  const bh = blackHoles.find(x=>x.id===id);
  if (bh && bh.group){ out.copy(bh.pos); return bh.rs*2.2; }
  const im = imported.find(x=>x.id===id);
  if (im){ const b = new THREE.Box3().setFromObject(im.object3d); b.getCenter(out); return (b.getSize(_cineSize).length()*0.5)||1; }
  return -1;
}
function cineName(id){
  if (id==='sun') return 'Sun';
  if (id==='moon') return 'Moon';
  const p = PLANETS.find(x=>x.key===id); if (p) return p.name;
  const bh = blackHoles.find(x=>x.id===id); if (bh) return bh.name;
  const im = imported.find(x=>x.id===id); if (im) return im.name;
  return '—';
}
function cineNearestUnvisited(id){
  // Nearest body (true 3D distance, omnidirectional) that hasn't been toured yet.
  // Skipping visited bodies makes → a greedy nearest-neighbour tour that reaches
  // EVERY body exactly once — so every planet is guaranteed reachable and the
  // camera never loops among a close inner cluster (e.g. Earth↔Moon↔Venus).
  if (cineCenterOf(id, _cineA) < 0) return null;
  let best = null, bestD = Infinity;
  for (const cand of cineFocusList()){
    if (cand===id || cineVisited.has(cand)) continue;
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
  cineFocusOn = true; cineFocusId = id;
  cineParked = false;                              // Focus is a deliberate motion mode → release any park
  cineVisited = new Set([id]); cineHist.length = 0;
  cineLastInput = 0;
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
  cineFocusOn = false; cineFocusId = null; cineHist.length = 0; cineVisited = new Set();
  const seq = cineEnabledSeq(); cinePlIndex = 0; if (seq.length) cineFocusKey = seq[0];
  cineNextCut = 0; cineLastInput = 0; cineParked = false;   // "Auto" hands control back to the director
  if (camMode!=='cinematic') setCamMode('cinematic'); else cineUpdateDock();
}
function cineHold(){
  // The user explicitly parked the camera on a body/pin → hold this POV and let
  // the auto-director yield until they choose Auto/Focus again. The camera never
  // drifts away on its own, so the user always keeps control of where they are.
  cineParked = true; cineLastInput = performance.now();
}
function cineStep(dir){
  if (camMode!=='cinematic') setCamMode('cinematic');
  if (!cineFocusOn || !cineFocusId){ cineFocusSelected(); return; }
  if (dir < 0){
    // ← retrace the tour one body at a time.
    const prev = cineHist.pop();
    if (prev != null){ cineFocusId = prev; cineLastInput = 0; cineUpdateDock(); }
    return;
  }
  // → hop to the nearest not-yet-visited body; when the full tour of every body
  // is done, start a fresh loop from the current one so it keeps cycling.
  let next = cineNearestUnvisited(cineFocusId);
  if (!next){ cineVisited = new Set([cineFocusId]); next = cineNearestUnvisited(cineFocusId); }
  if (next){
    cineHist.push(cineFocusId);
    cineVisited.add(next);
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
  if (camMode!=='cinematic') cinePlToggleCard(false);   // the playlist card belongs to Cinematic mode
  cineSyncList();                                       // keep the Scene-list "now showing" highlight in sync with mode/focus/park changes
}

/* ---- Cinematic playlist card — include + reorder the auto-switch scenes ----
   "Always working": rebuilt from the live scene each time it opens, so the Sun,
   every planet, the Moon and any imported object appear, and reordering / toggling
   takes effect immediately on the next cut. Reorder by drag (⠿) or ↑ ↓ keys —
   both paths kept for full keyboard + pointer accessibility (WCAG 2.2). */
function cinePlCardBuild(){
  if (!root) return;
  const rows = root.querySelector('#stCinePlRows'); if (!rows) return;
  cineEnsurePlaylist();
  rows.innerHTML = '';
  cinePlaylist.forEach((it, idx) => {
    const nm = cineName(it.id);
    const row = document.createElement('div');
    row.className = 'pl-row' + (it.on ? '' : ' pl-off');
    row.setAttribute('draggable','true');
    row.dataset.idx = String(idx);
    row.innerHTML =
      `<span class="pl-grip" aria-hidden="true">⠿</span>`+
      `<input type="checkbox" ${it.on?'checked':''} aria-label="Include ${nm} in the cinematic auto-switch" />`+
      `<span class="pl-name">${nm}</span>`+
      `<button class="pl-mv pl-up" title="Move up" aria-label="Move ${nm} earlier" ${idx===0?'disabled':''}>↑</button>`+
      `<button class="pl-mv pl-down" title="Move down" aria-label="Move ${nm} later" ${idx===cinePlaylist.length-1?'disabled':''}>↓</button>`;
    row.querySelector('input').addEventListener('change', e=>{ it.on = e.target.checked; row.classList.toggle('pl-off', !it.on); cineSavePrefs(); });
    row.querySelector('.pl-up').addEventListener('click', ()=>cinePlMove(idx,-1));
    row.querySelector('.pl-down').addEventListener('click', ()=>cinePlMove(idx, 1));
    row.addEventListener('dragstart', e=>{ cinePlDragFrom=idx; row.classList.add('pl-drag'); try{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', String(idx)); }catch(_){} });
    row.addEventListener('dragend', ()=>{ row.classList.remove('pl-drag'); rows.querySelectorAll('.pl-over').forEach(r=>r.classList.remove('pl-over')); });
    row.addEventListener('dragover', e=>{ e.preventDefault(); try{ e.dataTransfer.dropEffect='move'; }catch(_){} row.classList.add('pl-over'); });
    row.addEventListener('dragleave', ()=>row.classList.remove('pl-over'));
    row.addEventListener('drop', e=>{ e.preventDefault(); row.classList.remove('pl-over'); if (cinePlDragFrom!=null && cinePlDragFrom!==idx) cinePlReorder(cinePlDragFrom, idx); cinePlDragFrom=null; });
    rows.appendChild(row);
  });
}
function cinePlMove(idx, dir){
  const j = idx + dir;
  if (j < 0 || j >= cinePlaylist.length) return;
  const t = cinePlaylist[idx]; cinePlaylist[idx] = cinePlaylist[j]; cinePlaylist[j] = t;
  cineSavePrefs(); cinePlCardBuild();
}
function cinePlReorder(from, to){
  const [it] = cinePlaylist.splice(from, 1);
  cinePlaylist.splice(to, 0, it);
  cineSavePrefs(); cinePlCardBuild();
}
function cinePlToggleCard(force){
  const card = root && root.querySelector('#stCinePlCard'); if (!card) return;
  const willOpen = (force===undefined) ? !card.classList.contains('on') : !!force;
  if (willOpen){ cinePlCardBuild(); card.classList.add('on'); }
  else card.classList.remove('on');
  const btn = root.querySelector('#stCinePlaylist'); if (btn) btn.setAttribute('aria-expanded', String(willOpen));
}
function cinePlReset(){
  cinePlaylist = null; cineEnsurePlaylist();     // rebuild from the default Sun-outward order, all enabled
  cinePlIndex = 0; cineSavePrefs(); cinePlCardBuild();
}
function cineApplyDwellFromUI(){
  if (!root) return;
  const n = root.querySelector('#stCineDwellN'), u = root.querySelector('#stCineDwellU');
  if (!n || !u) return;
  let v = parseFloat(n.value); if (!isFinite(v) || v <= 0) v = 1;
  const unit = parseFloat(u.value) || 1;
  cineDwellSec = Math.min(86400, Math.max(1, v * unit));
  cineSavePrefs();
}
function cineSyncDwellUI(){
  if (!root) return;
  const n = root.querySelector('#stCineDwellN'), u = root.querySelector('#stCineDwellU');
  if (!n || !u) return;
  let unit = 1;
  if (cineDwellSec >= 3600 && cineDwellSec % 3600 === 0) unit = 3600;
  else if (cineDwellSec >= 60 && cineDwellSec % 60 === 0) unit = 60;
  u.value = String(unit); n.value = String(cineDwellSec / unit);
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

// Set zoom3D.anchor to the world point on the focal plane beneath a screen point
// (cx,cy in client px). Shared by wheel + pinch so both pin the point they zoom to.
function _dollySetAnchor(cx, cy){
  const el = renderer.domElement, rect = el.getBoundingClientRect();
  if (!rect.width || !rect.height){ zoom3D.hasAnchor = false; return; }
  _dollyNDC.set(((cx-rect.left)/rect.width)*2-1, -(((cy-rect.top)/rect.height)*2-1));
  raycaster.setFromCamera(_dollyNDC, camera);
  camera.getWorldDirection(_dollyFwd);
  _dollyPlane.setFromNormalAndCoplanarPoint(_dollyFwd, orbit.target);
  if (raycaster.ray.intersectPlane(_dollyPlane, _dollyHit)){ zoom3D.anchor.copy(_dollyHit); zoom3D.hasAnchor = true; }
  else zoom3D.hasAnchor = false;
}

// ---- Touch pinch-zoom (mobile / trackpad-less tablets) ----
// OrbitControls (native zoom disabled) gives one-finger orbit + two-finger pan
// but NO pinch zoom. This layer reads the two-finger spread and drives the same
// smooth, anchored zoom3D glide as the wheel — the missing mobile zoom axis.
const _pinch = { active:false, dist:0 };
function _touchSpread(a, b){ return Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY); }
function onTouchPinchStart(e){
  if (e.touches.length === 2){
    _pinch.active = true;
    _pinch.dist = _touchSpread(e.touches[0], e.touches[1]);
    cineLastInput = performance.now();
  }
}
function onTouchPinchMove(e){
  if (!_pinch.active || e.touches.length !== 2) return;
  e.preventDefault();                                // block the browser's page pinch
  const t0 = e.touches[0], t1 = e.touches[1];
  const d = _touchSpread(t0, t1);
  if (_pinch.dist > 0 && d > 0){
    _dollySetAnchor((t0.clientX+t1.clientX)/2, (t0.clientY+t1.clientY)/2);
    // fingers apart (d > prev) → ratio < 1 → radius shrinks → zoom IN.
    const ratio = Math.max(0.5, Math.min(2, _pinch.dist / d));
    const curR = camera.position.distanceTo(orbit.target);
    const base = zoom3D.active ? zoom3D.targetR : curR;
    zoom3D.targetR = Math.max(orbit.minDistance, Math.min(orbit.maxDistance, base * ratio));
    zoom3D.active = true;
    cineLastInput = performance.now();
  }
  _pinch.dist = d;
}
function onTouchPinchEnd(e){
  if (e.touches.length < 2){ _pinch.active = false; _pinch.dist = 0; }
}

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

    if (playing && !novaOn && !ecOn && !bhSimOn){
      simDate = new Date(simDate.getTime() + timeScale*dt*DAY_MS*dnWorldSlow);
      updatePlanets();
    }
    // planet spin (visual, exaggerated) — scaled by the POV calm factor
    for (const p of PLANETS){
      const rec = planetMeshes[p.key];
      rec.spin.rotation.y += (p.rot!==0 ? (1/p.rot) : 0) * dt * 0.6 * dnWorldSlow;
    }
    if (asteroidBelt && !bhSimOn) asteroidBelt.rotation.y += dt*0.02;
    if (meteorSys) updateMeteors(dt);
    // Black-hole gravitational dynamics + visuals (independent of camera mode)
    bhIntegrate(dt); bhRenderTick(dt); bhBurstTick(dt); bhStellarTick(dt);
    // NAVLINQ midpoint tracks the bodies as they move (throttled; updates even when paused)
    if (navMode && navSel.size>=2){ _navAccum+=dt; if(_navAccum>0.1){ _navAccum=0; updateNav(); } }

    pollGamepad(dt);
    if (novaOn) novaTick(dt);
    else if (ecOn) ecTick(dt);
    else if (bhCineOn) bhCineTick(dt);
    else if (camMode==='cinematic'){ tickCinematic(dt); cineSyncList(); }
    tickDolly3D(dt);
    deepNavTick(dt);
    orbit.update();
    renderer.render(scene, camera);
    if (novaRecComp) novaRecComposite();        // grab the fresh frame for a "scene + cards" export
    if (ecRecComp) ecRecComposite();            // …and for an Event Cinema export
    if (bhRecComp) bhRecComposite();            // …and for a Black-Hole cinematic export

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
let navTravelOpen = false;                    // NAVLINQ panel: interplanetary-travel section expanded?

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
    const T = navTravelCompute(R);
    const travel = T ? `<br><span style="color:#8b93ad;font-size:11px">Travel: barycenter equilibrium T ≈ <b>${T.Tspace.toFixed(0)} K</b> · longest one-way light time <b>${fmtSeconds(T.maxLight)}</b> · open “Interplanetary travel” for per-point g, v_esc, fuel &amp; synced-launch timing.</span>` : '';
    return `<b>NAVLINQ · ${R.nodes.length} bodies · in-system</b><br>`+
      `<span style="color:#c6cde0">Barycenter: ecliptic λ ${p.lon.toFixed(2)}° · β ${p.lat.toFixed(2)}° · ${p.r.toFixed(4)} AU from the Sun</span><br>`+
      `<span style="color:#c6cde0">Centre → barycenter offset <b>${fmtKm(p.offKm)}</b> · node span ${p.span.toFixed(3)} AU</span><br>`+
      `<span style="color:#9aa3bd;font-size:11px">Gravity pulls the midpoint ${fmtKm(p.offKm)} toward <b>${R.dom.name}</b> (${R.massPct.toFixed(1)}% of the set's mass). Mass-weighted 3-D barycenter — physically exact (established mechanics).</span>`+
      `<br><span style="color:#8892ac;font-size:10.5px">Tip: tap the teal pin on the dashed line to learn why it shows · use 🔒 Lock to orbit &amp; zoom without changing the set.</span>`+travel;
  }
  return `<b>NAVLINQ · ${R.nodes.length} nodes · interstellar</b><br>`+
    `<span style="color:#c6cde0">Barycenter bearing λ ${p.lon.toFixed(1)}° · β ${p.lat.toFixed(1)}° · ${p.r.toFixed(3)} ly from the Sun</span><br>`+
    `<span style="color:#c6cde0">Node span ${p.span.toFixed(2)} ly · dominant mass <b>${R.dom.name}</b> (${R.massPct.toFixed(1)}%)</span><br>`+
    `<span style="color:#9aa3bd;font-size:11px">Real catalogued distances &amp; directions; the marker shows the true 3-D bearing rendered at representative range (stars sit far beyond scene scale). O(N) &amp; direction-agnostic — the same formula extends to any bodies in any direction.</span>`;
}

/* ---------------------------------------------------------------------------
   5c-bis.  NAVLINQ · interplanetary-travel physics
   ---------------------------------------------------------------------------
   Every route is made comparable for *both* endpoints by quantifying, per node:
   surface gravity, escape velocity & specific escape energy (the energy floor to
   leave a surface), propellant fraction (fuel cost), distance & light-time to the
   shared barycenter, a common-yardstick transit time, and the launch offsets that
   synchronise arrival. Every figure is labelled by basis (established / exact /
   illustrative / speculative) — no false precision. Parameters are real, measured
   values: μ = GM (m³·s⁻², IAU DE440 — ≥9 significant figures, far tighter than G·M
   since G itself is only ~2×10⁻⁵ precise), R = mean radius (m), T = mean surface
   or 1-bar temperature (K). Derived quantities are exact consequences of energy
   conservation, so they carry <0.1% modelling error. */
const NAV_C_KMS   = 299792.458;               // km·s⁻¹ — speed of light (exact, SI)
const NAV_G0      = 9.80665;                   // m·s⁻² — standard gravity (exact, SI)
const NAV_VE_CHEM = 450 * NAV_G0 / 1000;       // km·s⁻¹ — exhaust speed, Isp 450 s (LH₂/LOX)
const NAV_A_LOWT  = 0.001 * NAV_G0;            // m·s⁻² — 0.001 g sustained (high-Isp electric ref)
const NAV_BODY = {
  sun:     { mu:1.32712440018e20, R:6.957e8,  T:5772 },
  mercury: { mu:2.2032e13,        R:2.4397e6, T:440  },
  venus:   { mu:3.24859e14,       R:6.0518e6, T:737  },
  earth:   { mu:3.986004418e14,   R:6.371e6,  T:288  },
  moon:    { mu:4.9048695e12,     R:1.7374e6, T:250  },
  mars:    { mu:4.282837e13,      R:3.3895e6, T:210  },
  jupiter: { mu:1.26686534e17,    R:6.9911e7, T:165  },
  saturn:  { mu:3.7931187e16,     R:5.8232e7, T:134  },
  uranus:  { mu:5.793939e15,      R:2.5362e7, T:76   },
  neptune: { mu:6.836529e15,      R:2.4622e7, T:72   },
};
function navBodyKey(n){ if(n.kind==='planet') return n.id; if(n.id==='sun') return 'sun'; if(n.id==='moon') return 'moon'; return null; }
// Per-node departure/transfer metrics toward the (in-system) barycenter.
function navTravelCompute(R){
  if (!R || R.anyStar) return null;
  const bary = R.phys.bary;                                   // AU vector (Sun at origin)
  const rows = [];
  R.nodes.forEach(n=>{
    const bk = navBodyKey(n); const b = bk && NAV_BODY[bk]; if(!b) return;
    const g    = b.mu/(b.R*b.R);                               // m·s⁻² — surface gravity
    const vesc = Math.sqrt(2*b.mu/b.R)/1000;                   // km·s⁻¹ — escape velocity
    const eps  = b.mu/b.R;                                     // J·kg⁻¹ — specific escape energy = ½v_esc²
    const dAU  = n.auPos.distanceTo(bary);
    const dkm  = dAU*AU_KM_NAV, dm = dkm*1000;
    const tLight  = dkm/NAV_C_KMS;                             // s — one-way light/command time
    const tCruise = dm>0 ? 2*Math.sqrt(dm/NAV_A_LOWT) : 0;     // s — brachistochrone at 0.001 g
    const propFrac = 1 - Math.exp(-vesc/NAV_VE_CHEM);          // surface-escape propellant fraction (Tsiolkovsky)
    rows.push({ name:n.name, g, vesc, eps, dAU, dkm, tLight, tCruise, propFrac, T:b.T });
  });
  if (!rows.length) return null;
  const tMax = rows.reduce((m,r)=>Math.max(m,r.tCruise),0);
  rows.forEach(r=> r.launchOffset = tMax - r.tCruise);        // head start → simultaneous arrival
  const rBary = R.phys.r;                                     // AU from the Sun
  // Grey-body equilibrium temperature at the barycenter. The inverse-square point
  // source diverges at r→0, but a passive body cannot exceed the Sun's photospheric
  // effective temperature (~5772 K) as it approaches the surface — clamp there.
  const Tspace = Math.min(NAV_BODY.sun.T, Math.max(2.725, 278.6*Math.pow(Math.max(rBary,1e-6),-0.5)));
  const maxLight = rows.reduce((m,r)=>Math.max(m,r.tLight),0);
  return { rows, tMax, rBary, Tspace, maxLight };
}
function navTravelHTML(R){
  if (!R) return `<div class="nv-foot">Select 2 or more bodies to compute travel physics.</div>`;
  if (R.anyStar){
    const rows = R.nodes.map(n=>{
      const d = n.lyPos.distanceTo(R.phys.bary);
      const sec = d*3.1556952e7;   // light-years → light-time seconds (1 ly = 1 yr of light travel)
      return `<tr><td>${n.name}</td><td>${d.toFixed(2)} ly</td><td>${fmtDurTech(sec)}<div class="nv-lay">${fmtDurLay(sec)}</div></td></tr>`;
    }).join('');
    return `<div class="nv-sec">Interstellar leg — light-time only</div>
      <div class="nv-scrollx"><table class="nv-tbl"><thead><tr><th>Node</th><th>To midpoint</th><th title="One-way light time: technical ETA on top, plain-language ETA below">One-way light time (ETA)</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="nv-foot"><b>Basis.</b> One-way light time = distance ÷ c (c = 299,792.458 km·s⁻¹, exact) — a <b>hard relativistic floor</b>. Surface-escape and crewed/robotic transit times are omitted on purpose: no demonstrated propulsion reaches a meaningful fraction of c, so any figure would be false precision (<b>speculative</b>).</div>`;
  }
  const T = navTravelCompute(R);
  if (!T) return `<div class="nv-foot">Select 2 or more in-system bodies to compute travel physics.</div>`;
  const rowsHtml = T.rows.map(x=>`<tr>
      <td>${x.name}</td><td>${x.g.toFixed(2)}</td><td>${x.vesc.toFixed(2)}</td>
      <td>${(x.eps/1e6).toFixed(1)}</td><td>${(x.propFrac*100).toFixed(1)}%</td>
      <td>${fmtKm(x.dkm)}</td><td>${fmtDurTech(x.tCruise)}<div class="nv-lay">${fmtDurLay(x.tCruise)}</div></td>
      <td>${x.launchOffset < 1 ? '—' : '+'+fmtDurTech(x.launchOffset)}</td><td>${fmtDurTech(x.tLight)}<div class="nv-lay">${fmtDurLay(x.tLight)}</div></td><td>${x.T} K</td>
    </tr>`).join('');
  return `
    <div class="nv-sec">Per-point departure &amp; transfer to the barycenter</div>
    <div class="nv-scrollx"><table class="nv-tbl">
      <thead><tr>
        <th>Body</th><th title="Surface gravity g = μ/R²">g m/s²</th>
        <th title="Escape velocity √(2μ/R)">v_esc km/s</th>
        <th title="Specific escape energy μ/R = ½v_esc²">E_esc MJ/kg</th>
        <th title="Propellant mass fraction to escape the surface — chemical Isp 450 s (Tsiolkovsky)">Fuel</th>
        <th title="Straight-line distance to the barycenter">To midpoint</th>
        <th title="Continuous-thrust flip-and-burn at 0.001 g (t = 2√(d/a)) — technical ETA on top, plain-language ETA below">Transit (ETA)</th>
        <th title="Head start so every point arrives together">Launch Δt</th>
        <th title="One-way light / command time to the midpoint (d ÷ c) — technical + plain-language ETA">Comm 1-way</th>
        <th title="Mean surface / 1-bar temperature">T_surf</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table></div>
    <div class="nv-sec">Rendezvous &amp; environment</div>
    <div class="nv-eta">Full trip ETA to the midpoint (synchronised arrival): technical <b>${fmtDurTech(T.tMax)}</b> · in plain terms, <b>${fmtDurLay(T.tMax)}</b>. Round-trip command latency at the midpoint: <b>${fmtDurTech(T.maxLight*2)}</b> (<b>${fmtDurLay(T.maxLight*2)}</b>).</div>
    <div class="nv-read">
      Synchronised arrival: the farthest point launches first; each other point waits its <b>Launch Δt</b> so all reach the barycenter together — a common continuous-thrust flip-and-burn at 0.001 g (≈9.8 mm·s⁻²), used purely as a transparent yardstick, not a specific vehicle.<br>
      Barycenter environment: <b>${T.rBary.toFixed(3)} AU</b> from the Sun → blackbody equilibrium <b>${T.Tspace.toFixed(0)} K</b> (grey body, albedo 0; 2.725 K CMB floor). Longest one-way command latency in the set: <b>${fmtSeconds(T.maxLight)}</b> (round-trip ${fmtSeconds(T.maxLight*2)}).
    </div>
    <div class="nv-foot">
      <b>Basis (calibrated confidence).</b> g = μ/R², v_esc = √(2μ/R) and E_esc = μ/R = ½v_esc² are exact consequences of energy conservation using measured μ = GM (IAU DE440, ≥9 significant figures) — <b>established science, &lt;0.1%</b> error. Fuel = 1 − e^(−v_esc/v_e), v_e = Isp·g₀ with Isp 450 s (LH₂/LOX) — <b>exact</b> for that Δv; a real ascent adds ~10–30% for drag &amp; gravity losses, so read it as a floor. Transit &amp; Launch Δt use a brachistochrone (t = 2√(d/a)) — a clean kinematic reference; Hohmann/chemical transfers take longer and a specific vehicle changes the value (<b>illustrative</b>). Comm time = d ÷ c is a <b>hard relativistic floor</b> — nothing beats it. T_surf are measured means; T_space is a modelled equilibrium. Read-across: higher v_esc &amp; Fuel ⇒ costlier launch, lower ROI; longer Comm ⇒ harder real-time control, higher risk; extreme T ⇒ thermal-design load.
    </div>`;
}
function navRefreshTravel(){
  const P = dnPanels.navlinq; if (!P) return;
  const el = P.body.querySelector('#nvTravel'); if (!el || !navTravelOpen) return;
  el.innerHTML = navTravelHTML(navComputeMidpoints());
  navSetupScrollx(el);
}
// Show a "scroll sideways" affordance above any table that overflows the panel width.
function navSetupScrollx(scope){
  if (!scope) return;
  scope.querySelectorAll('.nv-scrollx').forEach(sx=>{
    const overflow = sx.scrollWidth > sx.clientWidth + 1;
    let hint = sx.previousElementSibling;
    if (!(hint && hint.classList && hint.classList.contains('nv-scrollhint'))){
      hint = document.createElement('div'); hint.className = 'nv-scrollhint';
      hint.textContent = 'drag or scroll sideways for more columns';
      sx.parentNode.insertBefore(hint, sx);
    }
    hint.style.display = overflow ? 'flex' : 'none';
  });
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
    navLocked=false; navBadgeMode='readout';
    if (dnPanels.navlinq) dnPanels.navlinq.close();
  }
}
function navToggleBody(id){
  if (!id) return;
  if (navLocked){ toast('Selection locked — unlock to change the linked bodies'); return; }
  const ok = id==='sun' || id==='moon' || id.indexOf('star:')===0 || !!planetMeshes[id];
  if (!ok) return;
  if (navSel.has(id)) navSel.delete(id); else navSel.add(id);
  navBadgeMode = 'readout';
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
  navMidMarker = null;
  navOffsetMarker = null;
}
function updateNav(){
  clearNav();
  const R = navComputeMidpoints();
  navRefreshPanel(R);
  if (navTravelOpen) navRefreshTravel();
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
  // Invisible, generously-sized pick proxy so the midpoint itself is selectable:
  // clicking it focuses/flies the camera there (orbit then pivots about the midpoint).
  const pr = Math.max(0.5, mid.length()*0.02);
  const pick = new THREE.Mesh(new THREE.SphereGeometry(pr,12,12), new THREE.MeshBasicMaterial({ visible:false }));
  pick.position.copy(mid); pick.userData.navMidpoint = true;
  navGroup.add(pick); navMidMarker = pick;
  // geometric centre marker + dashed offset line — makes gravity's pull visible (in-system only)
  if (!R.anyStar && R.phys.cMarker){
    const cm = new THREE.Mesh(new THREE.SphereGeometry(0.10,16,16), new THREE.MeshBasicMaterial({ color:0x4fd1c5, transparent:true, opacity:0.9 }));
    cm.position.copy(R.phys.cMarker); navGroup.add(cm);
    const dl = new THREE.Line(new THREE.BufferGeometry().setFromPoints([ R.phys.cMarker.clone(), mid.clone() ]),
      new THREE.LineDashedMaterial({ color:0x4fd1c5, dashSize:0.25, gapSize:0.18, transparent:true, opacity:0.9 }));
    dl.computeLineDistances(); navGroup.add(dl);
    // Clickable thumb-tack on the offset line (only when the offset is visually
    // separated from the midpoint) — click it to learn WHY the line appears.
    const sep = R.phys.cMarker.distanceTo(mid);
    if (sep > 0.2){
      const midOff = R.phys.cMarker.clone().add(mid).multiplyScalar(0.5);
      const pinR = Math.max(0.12, mid.length()*0.012);
      const pin = new THREE.Mesh(new THREE.OctahedronGeometry(pinR,0),
        new THREE.MeshBasicMaterial({ color:0x4fd1c5, transparent:true, opacity:0.95 }));
      pin.position.copy(midOff); navGroup.add(pin);
      const opick = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.4, mid.length()*0.016),12,12),
        new THREE.MeshBasicMaterial({ visible:false }));
      opick.position.copy(midOff); opick.userData.navOffsetLine = true;
      navGroup.add(opick); navOffsetMarker = opick;
    }
  }
  scene.add(navGroup);
  eventNoteEl.style.display='block';
  eventNoteEl.innerHTML = (navBadgeMode==='offset' && !R.anyStar && R.phys.cMarker && navOffsetMarker)
    ? navOffsetHTML(R) : navReadoutHTML(R);
}
function navFlyToMidpoint(){
  // Toggle behaviour: if a fly-to-midpoint is already engaged, clicking again
  // cancels it (freezes the camera where it is); a further click re-triggers it.
  if (navFlyEngaged){
    if (dnFlight && dnFlight.active && dnFlight.tag==='navmid') dnFlight.active=false;
    navFlyEngaged=false; navUpdateFlyBtn(); toast('Fly-to midpoint cancelled');
    return;
  }
  const R = navComputeMidpoints(); if (!R){ toast('Pick 2 or more bodies first'); return; }
  // Arrive AT the actual X·Y·Z midpoint (not a wide stand-off): a minimal offset
  // keeps the orbit pivot well-defined while the camera lands on the point itself.
  const target = R.phys.marker.clone();
  const standoff = R.anyStar ? Math.max(3, target.length()*0.0015) : 0.12;
  navFlyEngaged=true; navUpdateFlyBtn();
  dnFlyTo(target, standoff, 'NAVLINQ midpoint', 'navmid');
}
function navUpdateFlyBtn(){
  const P = dnPanels.navlinq; if (!P) return;
  const b = P.body.querySelector('#nvFly'); if (!b) return;
  b.classList.toggle('on', navFlyEngaged);
  b.setAttribute('aria-pressed', String(navFlyEngaged));
  b.textContent = navFlyEngaged ? 'Cancel fly ✕' : 'Fly to midpoint ▶';
}
// Lock the current selection: the midpoint set is frozen so orbiting, zooming,
// rotating and panning the camera can never change it — the readout stays put.
function navToggleLock(){
  if (!navLocked && navSel.size < 2){ toast('Pick 2 or more bodies before locking the midpoint'); return; }
  navLocked = !navLocked;
  navUpdateLockBtn();
  highlightNav();
  toast(navLocked
    ? 'Midpoint locked — orbit, zoom, rotate & pan freely; the selection stays put'
    : 'Midpoint unlocked — click bodies to change the linked set');
}
function navUpdateLockBtn(){
  const P = dnPanels.navlinq; if (!P) return;
  const b = P.body.querySelector('#nvLock'); if (!b) return;
  b.classList.toggle('on', navLocked);
  b.setAttribute('aria-pressed', String(navLocked));
  b.textContent = navLocked ? '🔒 Locked' : '🔓 Lock';
  P.body.querySelectorAll('.nv-chip').forEach(c=>{
    c.style.opacity = navLocked ? '.5' : '';
    c.style.cursor  = navLocked ? 'not-allowed' : 'pointer';
  });
}
// Explain the teal dashed line (centre → barycenter offset). Toggling switches the
// badge card between the standard readout and this explainer; a module flag makes
// the throttled updateNav keep whichever the user last chose.
function navExplainOffset(){
  navBadgeMode = (navBadgeMode === 'offset') ? 'readout' : 'offset';
  updateNav();
}
function navOffsetHTML(R){
  const p = R.phys;
  return `<b style="color:#4fd1c5">Why the teal dashed line is here</b><br>`+
    `<span style="color:#c6cde0">It measures the gap between the <b>geometric centre</b> (the plain average of the selected positions — the teal dot) and the <b>barycenter</b> (the mass-weighted midpoint — the violet marker).</span><br>`+
    `<span style="color:#c6cde0">Because mass is uneven across your set, the balance point is pulled <b>${fmtKm(p.offKm)}</b> toward <b>${R.dom.name}</b> (${R.massPct.toFixed(1)}% of the set's mass). Give every body equal mass and the two points merge — the line disappears.</span><br>`+
    `<span style="color:#8b93ad;font-size:11px">Established mechanics — barycenter = Σ(mᵢ·rᵢ) ÷ Σmᵢ, exact (&lt;0.1% error from measured masses). Tap the pin again to return to the readout; tap the violet marker to fly there.</span>`;
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
    <div class="dn-rowbtn"><button class="dn-mini" id="nvClear">Clear</button><button class="dn-mini" id="nvLock" aria-pressed="false" title="Lock the selected bodies so orbiting, zooming, rotating & panning never change the midpoint">🔓 Lock</button><button class="dn-mini" id="nvTravelBtn">Interplanetary travel ▾</button><button class="dn-mini" id="nvFly" style="margin-left:auto">Fly to midpoint ▶</button></div>
    <div id="nvTravel" class="nv-travel" style="display:none"></div>`;
  body.querySelectorAll('.nv-chip').forEach(c=>c.addEventListener('click', ()=>navToggleBody(c.dataset.id)));
  body.querySelector('#nvClear').addEventListener('click', ()=>{ if (navLocked){ toast('Unlock the selection first to clear it'); return; } navSel.clear(); clearNav(); highlightNav(); navRefreshPanel(null); navRefreshTravel(); if (dnFlight && dnFlight.tag==='navmid') dnFlight.active=false; navFlyEngaged=false; navUpdateFlyBtn(); });
  body.querySelector('#nvLock').addEventListener('click', navToggleLock);
  body.querySelector('#nvFly').addEventListener('click', navFlyToMidpoint);
  navUpdateFlyBtn(); navUpdateLockBtn();
  // Horizontal scroll for the wide physics tables: the panel is only 268 px, so
  // translate vertical wheel intent into sideways motion and support click-drag
  // panning. Delegated on #nvTravel because its innerHTML is rebuilt on refresh.
  const travelEl = body.querySelector('#nvTravel');
  travelEl.addEventListener('wheel', (e)=>{
    const sx = e.target.closest('.nv-scrollx'); if (!sx) return;
    if (sx.scrollWidth <= sx.clientWidth + 1) return;
    const delta = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    const atStart = sx.scrollLeft <= 0, atEnd = sx.scrollLeft >= sx.scrollWidth - sx.clientWidth - 1;
    if ((delta < 0 && !atStart) || (delta > 0 && !atEnd)){ sx.scrollLeft += delta; e.preventDefault(); }
  }, { passive:false });
  let dragSx=null, dragX=0, dragL=0;
  travelEl.addEventListener('pointerdown', (e)=>{
    const sx = e.target.closest('.nv-scrollx'); if (!sx || sx.scrollWidth <= sx.clientWidth + 1) return;
    dragSx=sx; dragX=e.clientX; dragL=sx.scrollLeft; try{ sx.setPointerCapture(e.pointerId); }catch(_){} sx.classList.add('drag');
  });
  travelEl.addEventListener('pointermove', (e)=>{ if (dragSx) dragSx.scrollLeft = dragL - (e.clientX - dragX); });
  const endDrag=(e)=>{ if (dragSx){ try{ dragSx.releasePointerCapture(e.pointerId); }catch(_){} dragSx.classList.remove('drag'); dragSx=null; } };
  travelEl.addEventListener('pointerup', endDrag);
  travelEl.addEventListener('pointercancel', endDrag);
  body.querySelector('#nvTravelBtn').addEventListener('click', ()=>{
    navTravelOpen = !navTravelOpen;
    const el = body.querySelector('#nvTravel'), btn = body.querySelector('#nvTravelBtn');
    el.style.display = navTravelOpen ? 'block' : 'none';
    btn.textContent = navTravelOpen ? 'Interplanetary travel ▴' : 'Interplanetary travel ▾';
    btn.classList.toggle('on', navTravelOpen);
    if (navTravelOpen) navRefreshTravel();
  });
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
  const pill = root.querySelector('#stTimePill'); if (pill) pill.classList.toggle('live', on);   // pill dot pulses green while tracking real time
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
  if (!root) return;
  const now = new Date();
  const dateStr = now.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' });
  const timeStr = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const both = dateStr + ' · ' + timeStr;
  const el = root.querySelector('#stLocal'); if (el) el.textContent = both;      // Current Time now includes the current date
  const pill = root.querySelector('#stPillTxt'); if (pill) pill.textContent = both;
}

/* ---------------------------------------------------------------------------
   5b.  "Sun's End" — an independent, scripted stellar-death time-lapse
   ---------------------------------------------------------------------------
   A pre-generated, cinematic "video" of the Sun's far-future death, playable at
   any moment and fully separate from the Explore/Cinematic camera modes and the
   2D/3D render switch. The Sun swells into a red giant, its photosphere engulfs
   Mercury → Venus → Earth → the inner system, then the outer envelope is cast
   off as a planetary nebula that sweeps the rest of the system, leaving a white
   dwarf. Deterministic per-fraction so it can be scrubbed, paused, resumed and
   replayed. The camera auto-directs but yields instantly to the user, so the
   viewer can change angles while it plays (as in Cinematic mode / a Director
   camera). Calibrated confidence: a 1 M☉ star does NOT go supernova — this is a
   faithful red-giant → planetary-nebula → white-dwarf sequence, dramatised. */
const _nvColA = new THREE.Color();
const _nvColB = new THREE.Color();
const _nvZero = new THREE.Vector3(0,0,0);
let _nvUiAccum = 0;
const NOVA_NOTE = 'A <b>1 M☉</b> star like the Sun ends as a <b>red giant → planetary nebula → white dwarf</b> — it does <b>not</b> go supernova (that needs ≳ 8 solar masses). This is a stylised, sped-up dramatisation: the swelling photosphere engulfs Mercury, Venus, Earth and beyond, then the ejected envelope sweeps the outer system. Timings are rounded stellar-evolution estimates. <b>Drag anytime</b> to change your view while it plays.';

function _nvClamp(x,a,b){ return x<a?a:(x>b?b:x); }
function _nvLerp(a,b,t){ return a+(b-a)*t; }
function _nvEase(t){ t=_nvClamp(t,0,1); return t*t*(3-2*t); }          // smoothstep
function _nvEaseOut(t){ t=_nvClamp(t,0,1); return 1-(1-t)*(1-t); }

// Visible photosphere scale, in multiples of the Sun's base scene radius (3 units).
function novaScaleAt(f){
  if (f < 0.12) return _nvLerp(1, 1.18, f/0.12);
  if (f < 0.30) return _nvLerp(1.18, 3.0, _nvEase((f-0.12)/0.18));
  if (f < 0.62) return _nvLerp(3.0, 6.4, _nvEase((f-0.30)/0.32));      // red-giant swell (× 3 → ~19 scene units)
  if (f < 0.74){ const u=(f-0.62)/0.12; return _nvLerp(6.4,7.6,u) + Math.sin(u*Math.PI*6)*0.55*u; } // thermal pulses
  if (f < 0.86){ const u=(f-0.74)/0.12; return _nvLerp(7.6, 0.55, _nvEase(u)); }  // envelope cast off, core collapses
  return 0.28;                                                          // white-dwarf remnant
}
// Monotonically-increasing swept radius (scene units) → deterministic engulfment
// that never "resurrects" a consumed planet as the visible core later collapses.
function novaReach(f){
  if (f < 0.30) return 3*novaScaleAt(f);
  if (f < 0.62) return _nvLerp(9.0, 19.2, _nvEase((f-0.30)/0.32));
  if (f < 0.74) return _nvLerp(19.2, 22.8, (f-0.62)/0.12);
  const u=(f-0.74)/0.26; return _nvLerp(22.8, 40, _nvEaseOut(u));       // nebula shell sweeps the outer system
}
function novaPhase(f){
  if (f<0.12) return { t:'Main sequence · the Sun today',                       yr:'now' };
  if (f<0.30) return { t:'Subgiant · core hydrogen exhausted',                  yr:'≈ +5 billion yr' };
  if (f<0.62) return { t:'Red giant · swelling past the inner planets',         yr:'≈ +7 billion yr' };
  if (f<0.74) return { t:'Helium flash & thermal pulses',                       yr:'≈ +7.6 billion yr' };
  if (f<0.86) return { t:'Planetary nebula · the envelope is cast off',         yr:'≈ +7.7 billion yr' };
  return       { t:'White dwarf · the cooling stellar remnant',                 yr:'≈ +7.8 billion yr →' };
}
// Star surface / light / corona look across the sequence.
function novaApplyLook(f){
  let col, inten, glowO, glowHex=0xffb020;
  if (f < 0.12){ col=_nvColA.setHex(0xffcf6b); inten=_nvLerp(3.2,3.8,f/0.12); glowO=0.14; }
  else if (f < 0.30){ const u=_nvEase((f-0.12)/0.18);
    col=_nvColA.setHex(0xffcf6b).lerp(_nvColB.setHex(0xffa64d),u); inten=_nvLerp(3.8,4.8,u); glowO=_nvLerp(0.14,0.24,u); glowHex=0xffa64d; }
  else if (f < 0.62){ const u=_nvEase((f-0.30)/0.32);
    col=_nvColA.setHex(0xffa64d).lerp(_nvColB.setHex(0xff5a2a),u); inten=_nvLerp(4.8,5.6,u); glowO=_nvLerp(0.24,0.44,u); glowHex=0xff5a2a; }
  else if (f < 0.74){ const u=(f-0.62)/0.12; const throb=0.5+0.5*Math.sin(u*Math.PI*6);
    col=_nvColA.setHex(0xff4a24).lerp(_nvColB.setHex(0xffb84a),throb*0.5); inten=_nvLerp(5.6,6.6,u)+throb*0.6; glowO=_nvLerp(0.44,0.5,u); glowHex=0xff5a2a; }
  else if (f < 0.86){ const u=_nvEase((f-0.74)/0.12);                     // envelope ejection: bright flash → dim
    col=_nvColA.setHex(0xffffff).lerp(_nvColB.setHex(0xbcd6ff),u); inten=_nvLerp(9.0,1.6,u); glowO=_nvLerp(0.5,0.08,u); glowHex=0xffe0b0; }
  else { col=_nvColA.setHex(0xcfe3ff); inten=1.2; glowO=0.06; glowHex=0xbcd6ff; } // white dwarf
  if (sun) sun.material.color.copy(col);
  if (sunLight){ sunLight.intensity=inten; sunLight.color.copy(col); }
  if (sunGlow){ sunGlow.material.opacity=glowO; sunGlow.material.color.setHex(glowHex); }
}
function novaEnsureShell(){
  if (novaShell || !scene) return;
  novaShell = new THREE.Mesh(
    new THREE.SphereGeometry(1,48,32),
    new THREE.MeshBasicMaterial({ color:0xff884a, transparent:true, opacity:0, side:THREE.BackSide,
      blending:THREE.AdditiveBlending, depthWrite:false })
  );
  novaShell.visible=false; novaShell.renderOrder=2; scene.add(novaShell);
}
// Deterministic — the entire tableau is a pure function of the timeline fraction f.
function novaApply(f){
  f=_nvClamp(f,0,1);
  if (sun) sun.scale.setScalar(novaScaleAt(f));
  novaApplyLook(f);
  const reach=novaReach(f);
  if (novaShell){
    if (f>=0.72){ const u=(f-0.72)/0.28; const rr=_nvLerp(7,40,_nvEaseOut(u));
      novaShell.visible=true; novaShell.scale.setScalar(rr);
      const op=(u<0.16)?(u/0.16*0.42):Math.max(0,_nvLerp(0.42,0,_nvEaseOut((u-0.16)/0.84)));
      novaShell.material.opacity=op;
    } else novaShell.visible=false;
  }
  for (const p of PLANETS){ const rec=planetMeshes[p.key]; if(!rec) continue;
    const gone = rec.group.position.length() <= reach;
    rec.group.visible=!gone; if(rec.orbitLine) rec.orbitLine.visible=!gone;
  }
  if (asteroidBelt) asteroidBelt.visible=(reach<9.8);
  if (novaFlashEl){ const fl=(f>=0.735&&f<0.82)?Math.max(0,1-Math.abs(f-0.755)/0.05):0; novaFlashEl.style.opacity=(fl*0.85).toFixed(3); }
}
// Auto-directed establishing camera that pulls back to keep the growing envelope
// framed — but yields the instant the user orbits/zooms/pans (like Cinematic mode).
function novaFrameCamera(dt){
  if (novaFocusOn){
    orbit.target.lerp(novaComputeFocusTarget(), 1-Math.pow(0.02, dt));   // hold on the selection; leave the camera to the user
    return;                                                              // focus lock stops the auto scene change
  }
  if (performance.now()-cineLastInput < 3500) return;
  const f=_nvClamp(novaT/NOVA_DUR,0,1);
  const reach=Math.max(3, novaReach(f));
  const dist=reach*3.1 + 6;
  const ang=novaT*0.12;
  const desired=new THREE.Vector3(Math.cos(ang)*dist, dist*0.4 + reach*0.3, Math.sin(ang)*dist);
  camera.position.lerp(desired, 1-Math.pow(0.0016,dt));
  orbit.target.lerp(_nvZero, 1-Math.pow(0.004,dt));
}
function novaUpdateUI(){
  if (!novaBar || !root) return;
  const f=_nvClamp(novaT/NOVA_DUR,0,1), ph=novaPhase(f);
  const phaseEl=root.querySelector('#stNovaPhase'); if(phaseEl) phaseEl.textContent=ph.t+' · '+ph.yr;
  const scrub=root.querySelector('#stNovaScrub');
  if(scrub){ scrub.value=String(Math.round(f*1000)); scrub.style.setProperty('--nvp',(f*100).toFixed(1)+'%'); }
  const play=root.querySelector('#stNovaPlay'); if(play) play.textContent=novaPlaying?'⏸':'▶';
}
function novaEnter(){
  if (novaOn || !sun) return;
  if (ecOn) ecExit();
  novaEnsureShell();
  _novaSaved={ camMode, sunColor:sun.material.color.getHex(),
    lightI:sunLight?sunLight.intensity:3.2, lightC:sunLight?sunLight.color.getHex():0xfff4d8,
    glowO:sunGlow?sunGlow.material.opacity:0.14, glowC:sunGlow?sunGlow.material.color.getHex():0xffb020,
    pins:dnPinsVisible, belt:asteroidBelt?asteroidBelt.visible:true, simDate:new Date(simDate.getTime()) };
  playing=false; if(playBtn) playBtn.textContent='▶';
  try{ setRealtime(false); }catch(_){}
  if (camMode==='cinematic') setCamMode('explore');   // our own director drives the camera
  if (dnPinsVisible) dnTogglePins(false);             // pins would scale wildly on the giant Sun
  novaOn=true; novaPlaying=true; novaT=0; cineLastInput=0;
  novaFocusOn=false;
  const fbtn=root.querySelector('#stNovaFocus'); if(fbtn){ fbtn.classList.remove('on'); fbtn.setAttribute('aria-pressed','false'); }
  const btn=root.querySelector('#stNova'); if(btn){ btn.classList.add('on'); btn.setAttribute('aria-pressed','true'); }
  if (novaBar) novaBar.classList.add('on');
  const noteEl=root.querySelector('#stNovaNote'); if(noteEl) noteEl.innerHTML=NOVA_NOTE;
  novaApply(0); novaUpdateUI();
  camera.position.set(0, 16, 46); orbit.target.set(0,0,0);   // establishing shot
  toast("Sun's End — a cinematic time-lapse of the Sun's death · drag to change your view · click ☀ again to stop");
}
function novaExit(){
  if (!novaOn) return;
  if (novaRec) novaRecStop(false);              // discard any in-progress recording
  novaOn=false; novaPlaying=false;
  novaFocusOn=false;
  const fbtn=root&&root.querySelector('#stNovaFocus'); if(fbtn){ fbtn.classList.remove('on'); fbtn.setAttribute('aria-pressed','false'); }
  const btn=root&&root.querySelector('#stNova'); if(btn){ btn.classList.remove('on'); btn.setAttribute('aria-pressed','false'); }
  if (novaBar) novaBar.classList.remove('on');
  if (novaFlashEl) novaFlashEl.style.opacity='0';
  if (novaShell) novaShell.visible=false;
  if (sun){ sun.scale.setScalar(1); sun.material.color.setHex(_novaSaved?_novaSaved.sunColor:0xffcf6b); }
  if (sunLight && _novaSaved){ sunLight.intensity=_novaSaved.lightI; sunLight.color.setHex(_novaSaved.lightC); }
  if (sunGlow && _novaSaved){ sunGlow.material.opacity=_novaSaved.glowO; sunGlow.material.color.setHex(_novaSaved.glowC); }
  for (const p of PLANETS){ const rec=planetMeshes[p.key]; if(!rec) continue; rec.group.visible=true; if(rec.orbitLine) rec.orbitLine.visible=true; }
  if (asteroidBelt) asteroidBelt.visible=_novaSaved?_novaSaved.belt:true;
  if (_novaSaved){ if(_novaSaved.pins && !dnPinsVisible) dnTogglePins(true); simDate=_novaSaved.simDate; try{ updatePlanets(); }catch(_){} }
  _novaSaved=null;
  toast('Returned to the 3D view');
}
function novaToggle(){ if (novaOn) novaExit(); else novaEnter(); }
function novaTogglePlay(){ if(!novaOn) return; if(!novaPlaying && novaT>=NOVA_DUR) novaT=0; novaPlaying=!novaPlaying; cineLastInput=0; novaUpdateUI(); }
function novaReplay(){ if(!novaOn) return; novaT=0; novaPlaying=true; cineLastInput=0; novaApply(0); novaUpdateUI(); }
function novaSeek(frac){ if(!novaOn) return; novaPlaying=false; novaT=_nvClamp(frac,0,1)*NOVA_DUR; novaApply(_nvClamp(frac,0,1)); novaUpdateUI(); }
function novaToggleFocus(){
  if (!novaOn) return;
  novaFocusOn = !novaFocusOn;
  const b = root && root.querySelector('#stNovaFocus');
  if (b){ b.classList.toggle('on', novaFocusOn); b.setAttribute('aria-pressed', String(novaFocusOn)); }
  toast(novaFocusOn
    ? 'Focus lock on — holding on your selected object; the time-lapse keeps playing'
    : 'Focus lock off — the camera resumes its cinematic auto-direction');
}
// The point the focus lock holds on: the user's last-selected planet or imported
// object if it's still present, else the coordinate card's active body, else the
// Sun at the scene origin.
function novaComputeFocusTarget(){
  if (selected){
    if (selected.type==='planet'){ const rec=planetMeshes[selected.key]; if(rec && rec.group && rec.group.visible) return rec.group.position.clone(); }
    else if (selected.type==='imported' && selected.im && selected.im.object3d) return selected.im.object3d.position.clone();
  }
  const nb = dnActiveBody();
  if (nb && nb.center) return nb.center.clone();
  return new THREE.Vector3(0,0,0);
}
function novaTick(dt){
  if (novaPlaying){ novaT += dt; if (novaT>=NOVA_DUR){ novaT=NOVA_DUR; novaPlaying=false; } }
  novaApply(_nvClamp(novaT/NOVA_DUR,0,1));
  novaFrameCamera(dt);
  _nvUiAccum += dt; if (_nvUiAccum>0.1){ _nvUiAccum=0; novaUpdateUI(); }
  // A live export auto-saves the moment the full time-lapse completes.
  if (novaRec && !novaRec.finishing && !novaPlaying && novaT>=NOVA_DUR){
    novaRec.finishing = true;
    setTimeout(()=>{ novaRecStop(true); }, 450);   // small tail so the final frame lands
  }
}

/* ---------------------------------------------------------------------------
   Sun's End — MP4 export
   Records the cinematic to a downloadable video in two flavours:
     • Scene only            — the bare 3D render (canvas capture stream).
     • Scene + on-screen cards — the render composited with whatever HUD cards
                                 are open (Coordinates, NAVLINQ, Flights, …).
   Recording always begins from the user's current camera POV and plays the
   full stellar-death timeline once, saving automatically when it finishes.
   MP4 is preferred; if the browser can only record WebM we fall back to that
   and say so plainly. Text-only cards keep the capture canvas untainted, so
   the stream stays exportable. Video-only (no audio) by design.
   ------------------------------------------------------------------------- */
function novaPickVideoMime(){
  if (typeof MediaRecorder==='undefined' || !MediaRecorder.isTypeSupported) return null;
  const want = [
    'video/mp4;codecs=avc1.640028',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  for (const t of want){ try{ if (MediaRecorder.isTypeSupported(t)) return t; }catch(_){} }
  return '';   // supported, but no known type matched → let the browser default
}

function novaExportMenu(){
  if (novaRec){ novaRecStop(true); return; }    // clicking ● Stop finishes + saves
  if (!novaOn || !root) return;
  const host = root.querySelector('#stNovaBar'); if (!host) return;
  const existing = root.querySelector('#stNovaExpMenu');
  if (existing){ existing.remove(); return; }    // toggle the chooser off
  const m = document.createElement('div');
  m.id='stNovaExpMenu'; m.className='nv-menu';
  m.innerHTML =
    `<button data-m="scene">\ud83c\udfac Scene only</button>`+
    `<button data-m="cards">\ud83d\uddc2 Scene + on-screen cards</button>`;
  host.appendChild(m);
  m.addEventListener('click', e=>{
    const b=e.target.closest('button'); if(!b) return;
    const mode=b.getAttribute('data-m'); m.remove(); novaRecStart(mode);
  });
  setTimeout(()=>{
    const off=(ev)=>{
      if (!m.contains(ev.target) && ev.target.id!=='stNovaExport'){
        m.remove(); document.removeEventListener('pointerdown', off, true);
      }
    };
    document.addEventListener('pointerdown', off, true);
  }, 0);
}

function novaRecStart(mode){
  if (novaRec || !novaOn || !renderer) return;
  const mime = novaPickVideoMime();
  if (mime===null){ toast('Video export is not supported in this browser'); return; }
  const gl = renderer.domElement;
  const srcW = gl.width || gl.clientWidth, srcH = gl.height || gl.clientHeight;
  if (!srcW || !srcH){ toast('Nothing to record yet — try again in a moment'); return; }
  const capW = Math.min(1920, srcW), capH = Math.max(2, Math.round(capW * srcH/srcW));

  let stream;
  if (mode==='cards'){
    const cap = document.createElement('canvas'); cap.width=capW; cap.height=capH;
    const cctx = cap.getContext('2d', { alpha:false });
    cctx.fillStyle='#05060d'; cctx.fillRect(0,0,capW,capH);
    novaRecComp = { canvas:cap, ctx:cctx, capW, capH, overlay:null, building:false, lastBuild:0 };
    stream = cap.captureStream(30);
  } else {
    try{ stream = gl.captureStream(30); }
    catch(_){ toast('This browser blocked canvas capture — cannot export'); return; }
  }

  const chunks = [];
  let rec;
  try{
    rec = mime ? new MediaRecorder(stream, { mimeType:mime, videoBitsPerSecond:8_000_000 })
               : new MediaRecorder(stream);
  }catch(_){
    try{ rec = new MediaRecorder(stream); }
    catch(e2){ toast('Could not start the video recorder'); novaRecComp=null; return; }
  }
  const ext = ((rec.mimeType||mime||'').indexOf('mp4')>=0) ? 'mp4' : 'webm';

  rec.ondataavailable = e=>{ if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = ()=>{
    const save = !!(novaRec && novaRec.save);
    novaRecComp = null; novaRec = null;
    _novaRecRestoreUI();
    if (!save){ toast('Export cancelled'); return; }
    if (!chunks.length){ toast('Recording produced no data'); return; }
    const blob = new Blob(chunks, { type: chunks[0].type || mime || 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);
    a.href=url; a.download=`EWI-Cosmos-Suns-End-${mode==='cards'?'with-cards':'scene'}-${ts}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(_){} }, 5000);
    toast(ext==='mp4'
      ? 'Saved your Sun\u2019s End cinematic (MP4)'
      : 'Saved your Sun\u2019s End cinematic (WebM \u2014 this browser can\u2019t record MP4)');
  };
  rec.onerror = ()=>{ novaRecComp=null; novaRec=null; _novaRecRestoreUI(); toast('Recording error \u2014 export stopped'); };

  novaRec = { rec, mode, save:false, finishing:false };
  // Begin from the user's current POV; hold it briefly before the auto-director
  // eases in to keep the growing envelope framed.
  novaT=0; novaPlaying=true; novaApply(0); novaUpdateUI();
  cineLastInput = performance.now();
  _novaRecSetUI(true);
  try{ rec.start(100); }catch(_){ try{ rec.start(); }catch(e3){ novaRecComp=null; novaRec=null; _novaRecRestoreUI(); toast('Could not start the video recorder'); return; } }
  toast(mode==='cards'
    ? 'Recording Sun\u2019s End with your on-screen cards \u2014 it saves automatically when the time-lapse ends'
    : 'Recording Sun\u2019s End \u2014 it saves automatically when the time-lapse ends');
}

function novaRecStop(save){
  if (!novaRec) return;
  novaRec.save = !!save;
  try{ novaRec.rec.stop(); }
  catch(_){ novaRecComp=null; novaRec=null; _novaRecRestoreUI(); }
}

function _novaRecSetUI(on){
  if (!root) return;
  const b = root.querySelector('#stNovaExport');
  if (b){
    b.classList.toggle('nv-rec', on);
    b.textContent = on ? '\u25cf Stop' : '\u2913 MP4';
    b.title = on ? 'Stop and save the recording now' : 'Export this Sun\u2019s End as an MP4 video';
  }
  ['#stNovaScrub','#stNovaPlay','#stNovaReplay'].forEach(sel=>{
    const el = root.querySelector(sel); if (el) el.disabled = on;
  });
}
function _novaRecRestoreUI(){ _novaRecSetUI(false); }

// Per-frame composite for the "scene + cards" export — called from animate()
// right after renderer.render() (while the WebGL back-buffer is still valid,
// since preserveDrawingBuffer is off). Draws the fresh 3D frame, then the
// cached HUD-card bitmap on top; the bitmap is re-rasterised a few times a
// second from the live DOM so text and positions stay current without stalling.
function novaRecComposite(){
  const c = novaRecComp; if (!c) return;
  try{
    c.ctx.drawImage(renderer.domElement, 0,0, c.capW, c.capH);
    if (c.overlay) c.ctx.drawImage(c.overlay, 0,0, c.capW, c.capH);
    const now = performance.now();
    if (!c.building && now-c.lastBuild>280){ c.lastBuild=now; novaRecBuildOverlay(c); }
  }catch(_){}
}

// Rasterise the currently-visible HUD cards to an <img> via an SVG
// <foreignObject>. The studio stylesheet is embedded (CDATA-wrapped so CSS
// punctuation can't break the XML) and each card is XML-serialised so void
// elements like <input> come out well-formed — without that, the whole SVG
// fails to decode and the overlay silently vanishes. The wrapper background is
// forced transparent so only the cards paint over the scene. Text/emoji only →
// no cross-origin pixels → the capture canvas stays untainted.
function novaRecBuildOverlay(c){
  try{
    const panels = [].slice.call(document.querySelectorAll('#studioRoot .dn-panel.on'));
    if (!panels.length){ c.overlay=null; return; }
    const W = window.innerWidth, H = window.innerHeight;
    const css = ((document.getElementById('studio-css')||{}).textContent || '').replace(/]]>/g, ']]]]><![CDATA[>');
    const ser = new XMLSerializer();
    let inner = '';
    for (const p of panels){
      const r = p.getBoundingClientRect();
      if (r.width<2 || r.height<2) continue;
      const clone = p.cloneNode(true);
      clone.style.left = Math.round(r.left)+'px';
      clone.style.top  = Math.round(r.top)+'px';
      clone.style.margin = '0';
      clone.style.boxShadow = 'none';     // drop the soft drop-shadow — it rasterises as a translucent rectangle sitting off the card's frame
      clone.style.transition = 'none';
      // <canvas> pixels aren't carried by cloneNode/XMLSerializer, so bake each
      // live canvas (e.g. the animated X·Y·Z gizmo and its lat/long rings) into an
      // <img> snapshot so those animations actually appear in the recording.
      const liveCv  = p.querySelectorAll('canvas');
      const cloneCv = clone.querySelectorAll('canvas');
      for (let i=0;i<cloneCv.length;i++){
        try{
          const im = document.createElement('img');
          if (cloneCv[i].className) im.setAttribute('class', cloneCv[i].className);
          im.setAttribute('width', liveCv[i].width); im.setAttribute('height', liveCv[i].height);
          const st = cloneCv[i].getAttribute('style'); if (st) im.setAttribute('style', st);
          im.setAttribute('src', liveCv[i].toDataURL('image/png'));
          cloneCv[i].parentNode.replaceChild(im, cloneCv[i]);
        }catch(_){}
      }
      try{ inner += ser.serializeToString(clone); }catch(_){}
    }
    if (!inner){ c.overlay=null; return; }
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${c.capW}" height="${c.capH}" viewBox="0 0 ${W} ${H}">`+
      `<foreignObject x="0" y="0" width="${W}" height="${H}">`+
      `<div xmlns="http://www.w3.org/1999/xhtml" id="studioRoot" class="on" `+
        `style="position:absolute;inset:0;background:transparent;display:block;overflow:hidden">`+
      `<style><![CDATA[${css}]]></style>${inner}</div>`+
      `</foreignObject></svg>`;
    c.building = true;
    const img = new Image();
    img.onload  = ()=>{ c.overlay=img; c.building=false; };
    img.onerror = ()=>{ c.building=false; };
    img.src = 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  }catch(_){ c.building=false; }
}

/* ---------------------------------------------------------------------------
   5b. Event Cinema — the "Sun's End" experience for every Jump-to-an-event
   scene. Selecting an event enters an immersive player: a bottom control bar
   (title · date/epoch · confidence, ▶/⏸, a scrubber over the event's own time
   window, ← / → to step between events, ◎ Focus lock, ⤓ MP4, ✕ exit) while an
   auto-director glides the camera around the framed body. Per-type scripting
   gives each kind of event visible motion: eclipses sweep hours, meteor showers
   a night, planetary events a season arc, deep-time epochs a slow majestic orbit.
   ------------------------------------------------------------------------- */
// Half-width (in days) of the sim-time sweep for a date-based event, chosen so
// the scene actually moves: eclipses cover a few hours, showers a night, a
// planetary event a season, everything else a handful of days.
function ecWindowDays(e){
  if (!e || e.cosmic || !e.date) return 0;
  switch (e.type){
    case 'solar': case 'lunar':  return 0.5;   // ±6 h — the Moon/Sun geometry shifts
    case 'meteor':               return 1;     // ±12 h — one night of the shower
    case 'planet': case 'planetary': case 'opposition': case 'conjunction': return 120; // ±60 d — a season arc
    default:                     return 8;     // ±4 d
  }
}
function ecFrameKeyFor(e){
  const f = e && e.focus;
  if (f && (planetMeshes[f] || f==='sun' || f==='moon')) return f;
  return 'earth';
}
// The point the camera holds: with Focus lock on, the user's selected object (or
// the framed body); otherwise the event's framed body.
function ecTargetCenter(out){
  if (ecFocusOn && selected){
    if (selected.type==='planet'){ const rec=planetMeshes[selected.key]; if(rec&&rec.group){ rec.group.getWorldPosition(out); return (PLANETS.find(p=>p.key===selected.key)?.size||1); } }
    else if (selected.type==='imported' && selected.im){ const r=cineCenterOf(selected.im.id,out); if(r>=0) return r; }
  }
  const r = cineCenterOf(ecFocusKey, out);
  return r>=0 ? r : cineCenterOf('earth', out);
}
function ecApply(frac){
  const e = EVENTS[ecIndex]; if (!e) return;
  if (!e.cosmic && e.date){
    const half = ecWindowDays(e)/2;
    if (half > 0){
      const base = new Date(e.date+'T00:00:00Z').getTime();
      simDate = new Date(base + (frac-0.5)*2*half*DAY_MS);
      try{ updatePlanets(); }catch(_){}
    }
  }
}
function ecFrameCamera(dt){
  const rad = ecTargetCenter(_cineA);
  const r0 = 6 + Math.max(rad, 0.5)*3.2;
  const e = EVENTS[ecIndex];
  const f = _nvClamp(ecT/EC_DUR, 0, 1);
  const beat = ecSampleBeats(e, f);
  ecPhase = beat.phase;
  // accumulate the orbit angle from the beat's angular speed so the camera has
  // scripted momentum (slow establish → quicker mid → easing settle), never a
  // flat constant spin. Frozen while the user is actively steering.
  ecAng += beat.spin * dt * (2*Math.PI) * (_bhReduce() ? 0.35 : 1);
  const r = r0 * beat.r;
  const h = r0 * beat.h + Math.sin(ecAng*0.5)*r0*beat.h*0.06;
  // a gentle secondary framing offset for two-body events so both bodies stay in shot
  const desired = new THREE.Vector3(
    _cineA.x + Math.cos(ecAng)*r,
    _cineA.y + Math.max(2.0, h),
    _cineA.z + Math.sin(ecAng)*r
  );
  const posK = _bhReduce() ? 0.02 : 0.0016;
  camera.position.lerp(desired, 1 - Math.pow(posK, dt));
  orbit.target.lerp(_cineA, 1 - Math.pow(0.004, dt));
}
// Per-type cinematic choreography — a sequence of eased keyframes so each event
// kind moves with intent (like Sun's End's scripted phases), not one flat orbit:
// eclipses push in to totality and recede, showers sweep a night sky, planetary
// events arc across a season, deep-time epochs breathe in a slow majestic orbit.
function ecChoreography(e){
  const t = e && e.type;
  if (t==='solar' || t==='lunar') return [
    { at:0.00, r:2.15, h:0.55, spin:0.045, phase:'Alignment forming' },
    { at:0.30, r:1.30, h:0.34, spin:0.075, phase:'The shadow approaches' },
    { at:0.50, r:0.95, h:0.22, spin:0.028, phase:(t==='solar'?'Totality — the shadow falls':'Totality — the Moon reddens') },
    { at:0.72, r:1.30, h:0.32, spin:0.090, phase:'The shadow recedes' },
    { at:1.00, r:2.25, h:0.56, spin:0.130, phase:'Alignment ends' } ];
  if (t==='meteor') return [
    { at:0.00, r:1.75, h:0.16, spin:0.09, phase:'Night falls' },
    { at:0.42, r:1.45, h:0.11, spin:0.24, phase:'The radiant rises — streaks begin' },
    { at:0.74, r:1.55, h:0.22, spin:0.33, phase:'The shower peaks' },
    { at:1.00, r:1.95, h:0.40, spin:0.18, phase:'Dawn approaches' } ];
  if (t==='planetary' || t==='planet' || t==='opposition' || t==='conjunction') return [
    { at:0.00, r:2.45, h:0.50, spin:0.075, phase:'The bodies come into frame' },
    { at:0.50, r:1.70, h:0.34, spin:0.150, phase:'Relative motion over the season' },
    { at:1.00, r:2.55, h:0.56, spin:0.095, phase:'The configuration passes' } ];
  if (t==='asteroid' || t==='space') return [
    { at:0.00, r:2.60, h:0.48, spin:0.06, phase:'Approach' },
    { at:0.45, r:1.35, h:0.26, spin:0.20, phase:'Closest pass' },
    { at:1.00, r:2.40, h:0.52, spin:0.11, phase:'Departure' } ];
  if (t==='weather' || t==='geo' || t==='market') return [
    { at:0.00, r:2.30, h:0.60, spin:0.05, phase:'Establishing over Earth' },
    { at:0.5,  r:1.75, h:0.40, spin:0.12, phase:'The region in focus' },
    { at:1.00, r:2.40, h:0.62, spin:0.07, phase:'A wider view' } ];
  // cosmic / deep-time — slow, majestic, reverent
  return [
    { at:0.00, r:2.80, h:0.72, spin:0.040, phase:'Establishing' },
    { at:0.5,  r:1.95, h:0.46, spin:0.085, phase:'Drawing closer' },
    { at:1.00, r:3.00, h:0.80, spin:0.055, phase:'The long view' } ];
}
function ecSampleBeats(e, f){
  const B = ecChoreography(e);
  if (f<=B[0].at) return B[0];
  if (f>=B[B.length-1].at) return B[B.length-1];
  for (let i=0;i<B.length-1;i++){
    const a=B[i], b=B[i+1];
    if (f>=a.at && f<=b.at){
      const u=(b.at-a.at)>1e-6 ? (f-a.at)/(b.at-a.at) : 0;
      const k=_nvEase(u);   // smoothstep for buttery beat-to-beat transitions
      return { r:a.r+(b.r-a.r)*k, h:a.h+(b.h-a.h)*k, spin:a.spin+(b.spin-a.spin)*k,
        phase: u<0.5 ? a.phase : b.phase };
    }
  }
  return B[B.length-1];
}
function ecUpdateUI(){
  if (!ecBar || !root) return;
  const e = EVENTS[ecIndex]; if (!e) return;
  const f = _nvClamp(ecT/EC_DUR, 0, 1);
  ecPhase = ecSampleBeats(e, f).phase;   // keep the beat label in sync whether playing or scrubbing
  const titleEl = root.querySelector('#stEcTitle'); if (titleEl) titleEl.textContent = e.name;
  const timeEl = root.querySelector('#stEcTime');
  if (timeEl){
    const when = e.cosmic ? e.epoch
      : (e.date && ecWindowDays(e)>0 ? simDate.toISOString().slice(0,10) : (e.date||''));
    timeEl.textContent = ecPhase ? (ecPhase + ' · ' + when) : when;
  }
  const idxEl = root.querySelector('#stEcIdx'); if (idxEl) idxEl.textContent = (ecIndex+1)+' / '+EVENTS.length;
  const scrub = root.querySelector('#stEcScrub');
  if (scrub){ scrub.value=String(Math.round(f*1000)); scrub.style.setProperty('--nvp',(f*100).toFixed(1)+'%'); }
  const play = root.querySelector('#stEcPlay'); if (play) play.textContent = ecPlaying?'⏸':'▶';
  const note = root.querySelector('#stEcNote');
  if (note){
    const link = (!e.cosmic && e.link==='trading')
      ? `<br><a href="${tradingURL()}" target="_blank" rel="noopener" style="color:#b7a5ff;font-weight:700;text-decoration:none">Open EWI Trading Command Center →</a>` : '';
    note.innerHTML = (e.conf?confChip(e.conf):'') + `<span style="color:#c6cde0">${e.note||''}</span>${link}`;
  }
}
function ecShowBar(on){ if (ecBar) ecBar.classList.toggle('on', on); }
function ecEnter(i){
  const e = EVENTS[i]; if (!e) return;
  if (novaOn) novaExit();
  if (!ecOn) _ecSaved = { camMode, simDate:new Date(simDate.getTime()), pins:dnPinsVisible };
  if (ecRec) ecRecStop(false);
  ecIndex = i;
  playing = false; if (playBtn) playBtn.textContent = '▶';
  try{ setRealtime(false); }catch(_){}
  clearMeteors(); clearEventPins();
  if (camMode==='cinematic') setCamMode('explore');   // Event Cinema drives the camera itself
  ecFocusKey = ecFrameKeyFor(e);
  ecFocusOn = false;
  const fbtn = root && root.querySelector('#stEcFocus'); if (fbtn){ fbtn.classList.remove('on'); fbtn.setAttribute('aria-pressed','false'); }
  ecOn = true; ecPlaying = true; ecT = 0; ecT0 = performance.now()/1000; ecAng = Math.PI/2; ecPhase = ''; cineLastInput = 0;
  // per-type scene dressing
  if (e.type==='meteor') startMeteors();
  if (!e.cosmic && Array.isArray(e.where)) earthPin(e.where[0], e.where[1], 0xff5a7a, e.name, true);
  ecApply(0);
  // establishing shot: back off along +Z from the framed body, scaled to its size
  const rad = cineCenterOf(ecFocusKey, _cineA); const r = 6 + Math.max(rad,0.5)*3.2;
  camera.position.set(_cineA.x, _cineA.y + Math.max(3, r*0.34), _cineA.z + r);
  orbit.target.copy(_cineA);
  // keep the standalone badge hidden — the event's story lives in the bar now
  if (eventNoteEl) eventNoteEl.style.display = 'none';
  ecShowBar(true); ecUpdateUI();
  toast('Event Cinema · ' + e.name + ' — drag to change your view · ← → for another event · ✕ to exit');
}
function ecExit(){
  if (!ecOn) return;
  if (ecRec) ecRecStop(false);
  ecOn = false; ecPlaying = false; ecFocusOn = false;
  const fbtn = root && root.querySelector('#stEcFocus'); if (fbtn){ fbtn.classList.remove('on'); fbtn.setAttribute('aria-pressed','false'); }
  ecShowBar(false);
  clearMeteors(); clearEventPins();
  if (_ecSaved){ simDate = _ecSaved.simDate; try{ updatePlanets(); }catch(_){} if (_ecSaved.camMode) setCamMode(_ecSaved.camMode); }
  _ecSaved = null;
  toast('Returned to the 3D view');
}
function ecStep(dir){
  if (!ecOn){ if (ecIndex<0) return; ecEnter(ecIndex); return; }
  let j = ecIndex + (dir<0 ? -1 : 1);
  if (j < 0) j = EVENTS.length - 1;
  if (j >= EVENTS.length) j = 0;
  ecEnter(j);
  const sel = root && root.querySelector('#stEvent'); if (sel) sel.value = String(j);
}
function ecTogglePlay(){ if(!ecOn) return; if(!ecPlaying && ecT>=EC_DUR) ecT=0; ecPlaying=!ecPlaying; cineLastInput=0; ecUpdateUI(); }
function ecReplay(){ if(!ecOn) return; ecT=0; ecPlaying=true; cineLastInput=0; ecApply(0); ecUpdateUI(); }
function ecSeek(frac){ if(!ecOn) return; ecPlaying=false; ecT=_nvClamp(frac,0,1)*EC_DUR; ecApply(_nvClamp(frac,0,1)); ecUpdateUI(); }
function ecToggleFocus(){
  if (!ecOn) return;
  ecFocusOn = !ecFocusOn;
  const b = root && root.querySelector('#stEcFocus');
  if (b){ b.classList.toggle('on', ecFocusOn); b.setAttribute('aria-pressed', String(ecFocusOn)); }
  toast(ecFocusOn
    ? 'Focus lock on — holding on your selected object; the scene keeps playing'
    : 'Focus lock off — the camera resumes its cinematic auto-direction');
}
function ecTick(dt){
  if (ecPlaying){ ecT += dt; if (ecT>=EC_DUR){ ecT=EC_DUR; ecPlaying=false; } }
  ecApply(_nvClamp(ecT/EC_DUR, 0, 1));
  ecFrameCamera(dt);
  _ecUiAccum += dt; if (_ecUiAccum>0.1){ _ecUiAccum=0; ecUpdateUI(); }
  if (ecRec && !ecRec.finishing && !ecPlaying && ecT>=EC_DUR){
    ecRec.finishing = true;
    setTimeout(()=>{ ecRecStop(true); }, 450);
  }
}

/* Event Cinema — MP4 export (mirrors Sun's End: scene-only or scene + on-screen
   cards, records one full playthrough from the user's current POV, saves on
   completion; MP4 preferred, WebM fallback). */
function ecExportMenu(){
  if (ecRec){ ecRecStop(true); return; }
  if (!ecOn || !root) return;
  const host = root.querySelector('#stEcBar'); if (!host) return;
  const existing = root.querySelector('#stEcExpMenu');
  if (existing){ existing.remove(); return; }
  const m = document.createElement('div');
  m.id='stEcExpMenu'; m.className='nv-menu';
  m.innerHTML =
    `<button data-m="scene">\ud83c\udfac Scene only</button>`+
    `<button data-m="cards">\ud83d\uddc2 Scene + on-screen cards</button>`;
  host.appendChild(m);
  m.addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return; const mode=b.getAttribute('data-m'); m.remove(); ecRecStart(mode); });
  setTimeout(()=>{
    const off=(ev)=>{ if (!m.contains(ev.target) && ev.target.id!=='stEcExport'){ m.remove(); document.removeEventListener('pointerdown', off, true); } };
    document.addEventListener('pointerdown', off, true);
  }, 0);
}
function ecRecStart(mode){
  if (ecRec || !ecOn || !renderer) return;
  const mime = novaPickVideoMime();
  if (mime===null){ toast('Video export is not supported in this browser'); return; }
  const gl = renderer.domElement;
  const srcW = gl.width || gl.clientWidth, srcH = gl.height || gl.clientHeight;
  if (!srcW || !srcH){ toast('Nothing to record yet — try again in a moment'); return; }
  const capW = Math.min(1920, srcW), capH = Math.max(2, Math.round(capW * srcH/srcW));
  let stream;
  if (mode==='cards'){
    const cap = document.createElement('canvas'); cap.width=capW; cap.height=capH;
    const cctx = cap.getContext('2d', { alpha:false });
    cctx.fillStyle='#05060d'; cctx.fillRect(0,0,capW,capH);
    ecRecComp = { canvas:cap, ctx:cctx, capW, capH, overlay:null, building:false, lastBuild:0 };
    stream = cap.captureStream(30);
  } else {
    try{ stream = gl.captureStream(30); }
    catch(_){ toast('This browser blocked canvas capture — cannot export'); return; }
  }
  const chunks = [];
  let rec;
  try{ rec = mime ? new MediaRecorder(stream, { mimeType:mime, videoBitsPerSecond:8_000_000 }) : new MediaRecorder(stream); }
  catch(_){ try{ rec = new MediaRecorder(stream); }catch(e2){ toast('Could not start the video recorder'); ecRecComp=null; return; } }
  const ext = ((rec.mimeType||mime||'').indexOf('mp4')>=0) ? 'mp4' : 'webm';
  const evName = (EVENTS[ecIndex] && EVENTS[ecIndex].name || 'event').replace(/[^\w]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40) || 'event';
  rec.ondataavailable = e=>{ if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = ()=>{
    const save = !!(ecRec && ecRec.save);
    ecRecComp = null; ecRec = null; _ecRecRestoreUI();
    if (!save){ toast('Export cancelled'); return; }
    if (!chunks.length){ toast('Recording produced no data'); return; }
    const blob = new Blob(chunks, { type: chunks[0].type || mime || 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);
    a.href=url; a.download=`EWI-Cosmos-Event-${evName}-${mode==='cards'?'with-cards':'scene'}-${ts}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(_){} }, 5000);
    toast(ext==='mp4' ? 'Saved your event cinematic (MP4)' : 'Saved your event cinematic (WebM — this browser can’t record MP4)');
  };
  rec.onerror = ()=>{ ecRecComp=null; ecRec=null; _ecRecRestoreUI(); toast('Recording error — export stopped'); };
  ecRec = { rec, mode, save:false, finishing:false };
  ecT=0; ecPlaying=true; ecApply(0); ecUpdateUI();
  cineLastInput = performance.now();
  _ecRecSetUI(true);
  try{ rec.start(100); }catch(_){ try{ rec.start(); }catch(e3){ ecRecComp=null; ecRec=null; _ecRecRestoreUI(); toast('Could not start the video recorder'); return; } }
  toast(mode==='cards'
    ? 'Recording this event with your on-screen cards — it saves automatically when the scene ends'
    : 'Recording this event — it saves automatically when the scene ends');
}
function ecRecStop(save){
  if (!ecRec) return;
  ecRec.save = !!save;
  try{ ecRec.rec.stop(); }catch(_){ ecRecComp=null; ecRec=null; _ecRecRestoreUI(); }
}
function _ecRecSetUI(on){
  if (!root) return;
  const b = root.querySelector('#stEcExport');
  if (b){ b.classList.toggle('nv-rec', on); b.textContent = on ? '● Stop' : '⤓ MP4'; b.title = on ? 'Stop and save the recording now' : 'Export this event scene as an MP4 video'; }
  ['#stEcScrub','#stEcPlay','#stEcReplay','#stEcPrev','#stEcNext'].forEach(sel=>{ const el = root.querySelector(sel); if (el) el.disabled = on; });
}
function _ecRecRestoreUI(){ _ecRecSetUI(false); }
function ecRecComposite(){
  const c = ecRecComp; if (!c) return;
  try{
    c.ctx.drawImage(renderer.domElement, 0,0, c.capW, c.capH);
    if (c.overlay) c.ctx.drawImage(c.overlay, 0,0, c.capW, c.capH);
    const now = performance.now();
    if (!c.building && now-c.lastBuild>280){ c.lastBuild=now; novaRecBuildOverlay(c); }
  }catch(_){}
}

/* ---------------------------------------------------------------------------
   5c. Black holes — a gravitational-dynamics layer with its own cinematic.
   Create → configure/verify → lock-in → the cinematic begins and every body
   falls in under accurate Newtonian gravity. Each hole's characteristics
   (mass, size, X·Y·Z, spin, disk tilt, POV) are fully independent.
   ------------------------------------------------------------------------- */
// True Schwarzschild radius (km) for the honest scientific readout.
function bhTrueRsKm(massMsun){ return BH_RS_KM_PER_MSUN * massMsun; }
function bhFmtKm(km){
  if (km >= 9.461e12) return (km/9.461e12).toPrecision(3)+' ly';
  if (km >= 1.496e8)  return (km/1.496e8).toPrecision(3)+' AU';
  if (km >= 1e6)      return (km/1e6).toPrecision(3)+' Gm';
  return Math.round(km).toLocaleString()+' km';
}
// Suggested on-screen horizon radius (scene units) from mass — a gentle log map
// so a 1 M☉ stellar hole and a 10-billion-M☉ giant are both usably visible.
function bhSuggestRadius(massMsun){
  const l = Math.log10(Math.max(1, massMsun));         // 0 … 10
  return _nvClamp(0.6 + l*0.95, 0.5, 14);
}
// Scene gravitational parameter μ = G·M for this hole (linear in mass → a ∝ M,
// exactly as Newton's law requires; the shape of every trajectory is correct).
function bhMu(bh){ return BH_GM_REF * (bh.massMsun / BH_MASS_REF); }

function bhMakeDiskTexture(){
  if (bhDiskTex) return bhDiskTex;
  const s = 256, cv = document.createElement('canvas'); cv.width=cv.height=s;
  const g = cv.getContext('2d');
  const cx=s/2, cy=s/2;
  const grad = g.createRadialGradient(cx,cy, s*0.14, cx,cy, s*0.5);
  grad.addColorStop(0.00, 'rgba(255,255,255,0.00)');   // clear centre (the horizon shows through)
  grad.addColorStop(0.16, 'rgba(220,238,255,0.95)');   // hot inner edge — blue-white
  grad.addColorStop(0.34, 'rgba(255,232,180,0.92)');   // yellow
  grad.addColorStop(0.58, 'rgba(255,150,60,0.78)');    // orange
  grad.addColorStop(0.80, 'rgba(190,60,30,0.42)');     // cooler outer — red
  grad.addColorStop(1.00, 'rgba(90,20,10,0.00)');
  g.fillStyle = grad; g.beginPath(); g.arc(cx,cy,s*0.5,0,Math.PI*2); g.fill();
  // relativistic-beaming hint — one side brighter (approaching material blueshifts)
  const beam = g.createLinearGradient(0,0,s,0);
  beam.addColorStop(0, 'rgba(255,255,255,0.18)');
  beam.addColorStop(0.5,'rgba(255,255,255,0.00)');
  beam.addColorStop(1, 'rgba(10,10,20,0.14)');
  g.globalCompositeOperation='overlay'; g.fillStyle=beam;
  g.beginPath(); g.arc(cx,cy,s*0.5,0,Math.PI*2); g.fill();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  bhDiskTex = t; return t;
}
function bhMakeGlowTexture(){
  if (bhGlowTex) return bhGlowTex;
  const s = 128, cv = document.createElement('canvas'); cv.width=cv.height=s;
  const g = cv.getContext('2d'); const c=s/2;
  const grad = g.createRadialGradient(c,c,0, c,c,c);
  grad.addColorStop(0.00,'rgba(190,214,255,0.55)');
  grad.addColorStop(0.30,'rgba(150,120,255,0.22)');
  grad.addColorStop(0.70,'rgba(90,60,160,0.06)');
  grad.addColorStop(1.00,'rgba(0,0,0,0.00)');
  g.fillStyle=grad; g.fillRect(0,0,s,s);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  bhGlowTex = t; return t;
}
// Build (or rebuild) the visual for a black hole: pure-black event horizon, a
// thin photon ring, a rotating emissive accretion disk (hot inner → cool outer),
// an additive lensing-glow halo, a subtle disk light, and inspiralling particle
// streams.
function bhBuild(bh){
  const grp = new THREE.Group();
  grp.position.copy(bh.pos);
  const rs = bh.rs;
  // event horizon — an utterly black sphere that occludes everything behind it
  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(rs, 48, 32),
    new THREE.MeshBasicMaterial({ color:0x000000 })
  );
  horizon.renderOrder = 3;
  grp.add(horizon);
  // photon ring — a thin bright torus hugging the horizon, in the disk plane
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(rs*1.08, rs*0.03, 12, 96),
    new THREE.MeshBasicMaterial({ color:0xfff1cf, transparent:true, opacity:0.9,
      blending:THREE.AdditiveBlending, depthWrite:false })
  );
  ring.rotation.x = Math.PI/2;
  ring.renderOrder = 4;
  grp.add(ring);
  // accretion disk — emissive annulus painted with a hot radial gradient
  const disk = new THREE.Mesh(
    new THREE.RingGeometry(rs*1.5, rs*6.2, 128, 6),
    new THREE.MeshBasicMaterial({ map:bhMakeDiskTexture(), transparent:true, opacity:0.95,
      side:THREE.DoubleSide, blending:THREE.AdditiveBlending, depthWrite:false })
  );
  disk.rotation.x = Math.PI/2;
  disk.renderOrder = 2;
  grp.add(disk);
  // lensing-glow halo — a camera-facing additive sprite
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map:bhMakeGlowTexture(),
    transparent:true, blending:THREE.AdditiveBlending, depthWrite:false, opacity:0.85 }));
  glow.scale.setScalar(rs*11);
  glow.renderOrder = 1;
  grp.add(glow);
  // a faint warm light from the disk so approaching bodies catch its glow
  const light = new THREE.PointLight(0xffd9a8, 0.0, rs*60, 2.0);
  grp.add(light);
  // inspiralling particle streams
  const N = _bhReduce() ? 90 : 280;
  const pgeo = new THREE.BufferGeometry();
  const ppos = new Float32Array(N*3);
  const partData = new Array(N);
  for (let i=0;i<N;i++){
    const ang = Math.random()*Math.PI*2;
    const rad = rs*(1.6 + Math.random()*5.0);
    const z   = (Math.random()-0.5)*rs*0.5;
    partData[i] = { ang, rad, z, spd:0.5+Math.random()*0.9, drop:0.04+Math.random()*0.10, rad0:rad };
    ppos[i*3]=Math.cos(ang)*rad; ppos[i*3+1]=z; ppos[i*3+2]=Math.sin(ang)*rad;
  }
  pgeo.setAttribute('position', new THREE.BufferAttribute(ppos,3));
  const parts = new THREE.Points(pgeo, new THREE.PointsMaterial({ color:0xffcf9a, size:1.5,
    sizeAttenuation:false, transparent:true, opacity:0.8, blending:THREE.AdditiveBlending, depthWrite:false }));
  parts.renderOrder = 2;
  grp.add(parts);

  bh.group=grp; bh.horizon=horizon; bh.ring=ring; bh.disk=disk; bh.glow=glow; bh.light=light;
  bh.parts=parts; bh.partData=partData; bh.diskSpin=(bh.spin>=0?1:-1);
  bhApplyTilt(bh);
  scene.add(grp);
  return bh;
}
// Orient the disk / ring / particle plane to the hole's tilt (degrees).
function bhApplyTilt(bh){
  const t = (bh.tiltDeg||0)*DEG;
  bh.group.rotation.set(t, 0, 0);
}
// Resize an existing hole's meshes after a config change (draft editing / growth).
function bhUpdateMesh(bh){
  const rs = bh.rs;
  bh.horizon.geometry.dispose();
  bh.horizon.geometry = new THREE.SphereGeometry(rs, 48, 32);
  bh.ring.geometry.dispose();
  bh.ring.geometry = new THREE.TorusGeometry(rs*1.08, rs*0.03, 12, 96);
  bh.disk.geometry.dispose();
  bh.disk.geometry = new THREE.RingGeometry(rs*1.5, rs*6.2, 128, 6);
  bh.glow.scale.setScalar(rs*11);
  bh.captureR = rs*0.92;
  bh.group.position.copy(bh.pos);
  bhApplyTilt(bh);
}
function bhDispose(bh){
  if (!bh.group) return;
  scene.remove(bh.group);
  bh.group.traverse(o=>{ if(o.geometry) o.geometry.dispose(); if(o.material){ (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose&&m.dispose()); } });
  bh.group=null;
}
// Per-frame visual life — spin the disk, swirl the particles inward, pulse the
// glow, keep the disk light lit while the sim runs. Cheap; runs whenever holes
// exist. Honors reduced-motion.
function bhRenderTick(dt){
  bhSyncSelRing();                              // keep the selection halo on the chosen hole
  const holes = bhDraft ? blackHoles.concat([bhDraft]) : blackHoles;
  if (!holes.length) return;
  const calm = _bhReduce() ? 0.25 : 1;
  for (const bh of holes){
    if (!bh.group) continue;
    bh.disk.rotation.z += dt*0.6*calm*bh.diskSpin;
    bh.ring.rotation.z += dt*0.9*calm*bh.diskSpin;
    // glow shimmer
    const pulse = 0.72 + Math.sin(performance.now()*0.001 + bh.id.length)*0.10*calm;
    bh.glow.material.opacity = pulse;
    bh.light.intensity = bhSimOn ? 1.1 : 0.5;
    // inspiralling particles
    const pos = bh.parts.geometry.attributes.position.array;
    const pd = bh.partData; const rsMin = bh.rs*1.02;
    for (let i=0;i<pd.length;i++){
      const p = pd[i];
      p.ang += dt*p.spd*calm*bh.diskSpin;
      p.rad -= dt*p.drop*calm*(1 + (bh.rs/Math.max(p.rad,0.001)));
      if (p.rad <= rsMin){ p.rad = p.rad0; p.ang = Math.random()*Math.PI*2; }
      pos[i*3]=Math.cos(p.ang)*p.rad; pos[i*3+1]=p.z*(p.rad/p.rad0); pos[i*3+2]=Math.sin(p.ang)*p.rad;
    }
    bh.parts.geometry.attributes.position.needsUpdate = true;
  }
}

/* ---- Gravity integrator (symplectic Euler + Plummer softening) ---- */
function bhSnapshotBody(kind, ref, pos, mass){
  const o = kind==='planet' ? ref.group : (kind==='imported' ? ref.object3d : null);
  return { kind, ref, pos, vel:new THREE.Vector3(), mass, alive:true, baseScale:(o?o.scale.x:1), shred:0 };
}
function bhSimStart(){
  if (bhSimOn || !blackHoles.length) return;
  // snapshot everything we perturb, so removal restores the Solar System exactly
  _bhSaved = {
    simDate: new Date(simDate.getTime()), playing,
    planetVis: PLANETS.map(p=>({ key:p.key, vis: planetMeshes[p.key]?planetMeshes[p.key].group.visible:true, sc: planetMeshes[p.key]?planetMeshes[p.key].group.scale.x:1 })),
    importedPos: imported.map(im=>({ id:im.id, p:im.object3d.position.clone(), vis:im.object3d.visible, sc:im.object3d.scale.x })),
    beltVisible: asteroidBelt?asteroidBelt.visible:true,
    holes: blackHoles.map(bh=>({ id:bh.id, massMsun:bh.massMsun, rs:bh.rs, rs0:bh.rs0 })),
    sun: sun ? { scale:sun.scale.x, vis:sun.visible, col:sun.material.color.getHex(),
      lightI:sunLight?sunLight.intensity:3.2, lightC:sunLight?sunLight.color.getHex():0xfff4d8,
      glowO:sunGlow?sunGlow.material.opacity:0.14, glowC:sunGlow?sunGlow.material.color.getHex():0xffb020 } : null
  };
  bhBodies = [];
  for (const p of PLANETS){ const rec = planetMeshes[p.key]; if (!rec || !rec.group.visible) continue;
    bhBodies.push(bhSnapshotBody('planet', rec, rec.group.position, p.mass||1e-9)); }
  for (const im of imported){ if (!im.object3d.visible) continue;
    bhBodies.push(bhSnapshotBody('imported', im, im.object3d.position, 3e-6)); }
  // asteroid belt — integrate the whole point cloud. Bake its world transform into the
  // positions and zero the transform, so the infall and horizon test run in the same
  // world frame as the holes (the belt is rotationally symmetric, so this is visually
  // identical and fully reversible).
  if (asteroidBelt){
    asteroidBelt.updateMatrixWorld();
    const arr = asteroidBelt.geometry.attributes.position.array;
    const m = asteroidBelt.matrixWorld;
    for (let i=0;i<arr.length;i+=3){ _bhB.set(arr[i],arr[i+1],arr[i+2]).applyMatrix4(m);
      arr[i]=_bhB.x; arr[i+1]=_bhB.y; arr[i+2]=_bhB.z; }
    asteroidBelt.position.set(0,0,0); asteroidBelt.rotation.set(0,0,0); asteroidBelt.scale.set(1,1,1);
    asteroidBelt.updateMatrixWorld(); asteroidBelt.geometry.attributes.position.needsUpdate = true;
    bhBeltBase = Float32Array.from(arr);
    bhBeltVel = new Float32Array(arr.length);
    bhBeltAlive = new Uint8Array(arr.length/3).fill(1);
  }
  bhSeedVelocities();
  bhSunDrain = 0; bhSunFed = false; _bhSunShred = 0;   // reset the Sun's fate for this run
  playing = false; if (playBtn) playBtn.textContent='▶';
  try{ setRealtime(false); }catch(_){}
  bhSimOn = true;
}
// Seed each body with a sub-circular tangential velocity about the nearest hole,
// so bodies spiral gracefully inward (a decaying ellipse) rather than dropping
// radially — physically faithful and visually elegant.
function bhSeedVelocities(){
  const seed = (pos, vel) => {
    // nearest hole
    let bh=null, best=Infinity;
    for (const h of blackHoles){ const d=pos.distanceTo(h.pos); if(d<best){ best=d; bh=h; } }
    if (!bh) return;
    _bhA.copy(pos).sub(bh.pos);                 // radial (hole → body)
    const d = Math.max(_bhA.length(), 0.001);
    const vC = Math.sqrt(bhMu(bh)/d);           // local circular speed
    _bhTan.crossVectors(_bhUp, _bhA);           // a tangent in the ecliptic
    if (_bhTan.lengthSq()<1e-6) _bhTan.set(1,0,0);
    _bhTan.normalize();
    // Tangential (for the spiral) + an inward radial kick, so even the most distant
    // bodies begin their plunge at once and are drawn in and absorbed within the view.
    vel.copy(_bhTan).multiplyScalar(0.55*vC).addScaledVector(_bhA, -0.5*vC/d);
  };
  for (const b of bhBodies) seed(b.pos, b.vel);
  if (bhBeltBase && bhBeltVel){
    for (let i=0;i<bhBeltAlive.length;i++){
      _bhTmp.set(bhBeltBase[i*3], bhBeltBase[i*3+1], bhBeltBase[i*3+2]);
      const v = new THREE.Vector3(); seed(_bhTmp, v);
      bhBeltVel[i*3]=v.x; bhBeltVel[i*3+1]=v.y; bhBeltVel[i*3+2]=v.z;
    }
  }
}
// Net gravitational acceleration at `p` from all holes → out. Softened.
function bhAccel(p, out){
  out.set(0,0,0);
  for (const bh of blackHoles){
    _bhTmp.copy(bh.pos).sub(p);
    const soft = bh.rs*bh.rs*0.36;
    const r2 = _bhTmp.lengthSq() + soft;
    const inv = bhMu(bh) / (r2 * Math.sqrt(r2));
    out.addScaledVector(_bhTmp, inv);
  }
  return out;
}
function bhCapture(pos){
  for (const bh of blackHoles){ if (pos.distanceTo(bh.pos) <= bh.captureR) return bh; }
  return null;
}
function bhGrow(bh, addMassMsun){
  bh.massMsun += Math.max(0, addMassMsun);
  bh.rs = Math.min(bh.rs*1.012, bh.rs0*1.7);
  bhUpdateMesh(bh);
}
function bhIntegrate(dt){
  if (!bhSimOn) return;
  const steps = 4;
  const h = (dt*BH_RATE)/steps;
  for (let s=0;s<steps;s++){
    for (const b of bhBodies){
      if (!b.alive) continue;
      bhAccel(b.pos, _bhAcc);
      b.vel.addScaledVector(_bhAcc, h);
      // Nearest hole — drives both the accretion drag and the tidal destruction below.
      let near=null, nd=Infinity;
      for (const hb of blackHoles){ const d=b.pos.distanceTo(hb.pos); if(d<nd){ nd=d; near=hb; } }
      // Accretion inspiral — the body bleeds orbital energy to the hole (disk drag /
      // dynamical friction / gravitational radiation), so its orbit decays and it is
      // inevitably drawn to the horizon and absorbed, never left in a stable orbit.
      // Distance-scaled: a gentle drift far out, an accelerating plunge close in.
      if (near){ const drag = BH_DRAG*(1 + near.rs*2/Math.max(nd, near.rs));
        b.vel.multiplyScalar(Math.max(0, 1 - drag*h)); }
      b.pos.addScaledVector(b.vel, h);
      // Progressive tidal destruction — the body is torn apart (shrinks) and sheds a
      // debris stream toward the hole as it crosses into the tidal zone, then is
      // annihilated at the horizon. Faithful to spaghettification, cheap to draw.
      if (near){ const tidal=near.rs*4;
        if (nd<tidal){ const f=_nvClamp((tidal-nd)/(tidal-near.captureR),0,1);
          const o = b.kind==='planet'? b.ref.group : (b.kind==='imported'? b.ref.object3d : null);
          if (o) o.scale.setScalar(Math.max(0.03, b.baseScale*(1-0.92*f)));
          b.shred += h; if (b.shred>0.03){ b.shred=0; bhShred(b.pos, near, f); }
        }
      }
      const hole = bhCapture(b.pos);
      if (hole){
        b.alive=false;
        if (b.kind==='planet'){ b.ref.group.visible=false; if(b.ref.orbitLine) b.ref.orbitLine.visible=false; }
        else if (b.kind==='imported'){ b.ref.object3d.visible=false; }
        bhBurst(b.pos, hole);
        bhGrow(hole, b.mass);
      }
    }
    if (bhBeltBase && bhBeltVel){
      const arr = asteroidBelt.geometry.attributes.position.array;
      for (let i=0;i<bhBeltAlive.length;i++){
        if (!bhBeltAlive[i]) continue;
        _bhB.set(arr[i*3], arr[i*3+1], arr[i*3+2]);
        bhAccel(_bhB, _bhAcc);            // _bhB (not _bhTmp) — bhAccel uses _bhTmp as scratch, so aliasing would zero the pull
        bhBeltVel[i*3]  += _bhAcc.x*h; bhBeltVel[i*3+1]+= _bhAcc.y*h; bhBeltVel[i*3+2]+= _bhAcc.z*h;
        // Same accretion inspiral drag — each grain of the belt spirals in and is absorbed.
        { let bn=null, bnd=Infinity;
          for (const hb of blackHoles){ const d=_bhB.distanceTo(hb.pos); if(d<bnd){ bnd=d; bn=hb; } }
          if (bn){ const dr=Math.max(0, 1 - BH_DRAG*(1 + bn.rs*2/Math.max(bnd, bn.rs))*h);
            bhBeltVel[i*3]*=dr; bhBeltVel[i*3+1]*=dr; bhBeltVel[i*3+2]*=dr; } }
        arr[i*3]  += bhBeltVel[i*3]*h; arr[i*3+1]+= bhBeltVel[i*3+1]*h; arr[i*3+2]+= bhBeltVel[i*3+2]*h;
        _bhB.set(arr[i*3], arr[i*3+1], arr[i*3+2]);
        const hole = bhCapture(_bhB);
        if (hole){ bhBeltAlive[i]=0; arr[i*3]=hole.pos.x; arr[i*3+1]=hole.pos.y; arr[i*3+2]=hole.pos.z; }
      }
      asteroidBelt.geometry.attributes.position.needsUpdate = true;
    }
  }
}
// A brief additive flash where a body crosses the horizon.
const bhBurstList = [];
function bhBurst(pos, bh){
  const N = 24;
  const geo = new THREE.BufferGeometry();
  const pp = new Float32Array(N*3);
  const vv = [];
  for (let i=0;i<N;i++){ const a=Math.random()*Math.PI*2, e=(Math.random()-0.5)*Math.PI;
    const dir=new THREE.Vector3(Math.cos(a)*Math.cos(e), Math.sin(e), Math.sin(a)*Math.cos(e));
    pp[i*3]=pos.x; pp[i*3+1]=pos.y; pp[i*3+2]=pos.z; vv.push(dir.multiplyScalar(2+Math.random()*4)); }
  geo.setAttribute('position', new THREE.BufferAttribute(pp,3));
  const mat = new THREE.PointsMaterial({ color:0xfff4d8, size:3, sizeAttenuation:false, transparent:true,
    opacity:1, blending:THREE.AdditiveBlending, depthWrite:false });
  const pts = new THREE.Points(geo, mat); pts.renderOrder=5; scene.add(pts);
  const dur=0.7;
  const cleanup = ()=>{ scene.remove(pts); geo.dispose(); mat.dispose(); };
  bhBurstList.push({ life:0, dur, geo, mat, vv, N, cleanup });
}
function bhBurstTick(dt){
  for (let i=bhBurstList.length-1;i>=0;i--){
    const b=bhBurstList[i]; b.life+=dt;
    const arr=b.geo.attributes.position.array;
    for (let j=0;j<b.N;j++){ arr[j*3]+=b.vv[j].x*dt; arr[j*3+1]+=b.vv[j].y*dt; arr[j*3+2]+=b.vv[j].z*dt; }
    b.geo.attributes.position.needsUpdate=true; b.mat.opacity=Math.max(0,1-b.life/b.dur);
    if (b.life>=b.dur){ b.cleanup(); bhBurstList.splice(i,1); }
  }
}
// Put every perturbed body — planets, Sun, imported objects, the asteroid belt —
// back exactly where it was the instant the black hole was placed (the snapshot
// bhSimStart took). Reused by the Restart control (which keeps the sim running) and
// by bhSimStop (which tears it down). Never clears the snapshot itself.
function bhRestoreInitialState(){
  if (!_bhSaved) return;
  for (const pv of _bhSaved.planetVis){ const rec=planetMeshes[pv.key]; if(rec){ rec.group.visible=pv.vis; rec.group.scale.setScalar(pv.sc==null?1:pv.sc); if(rec.orbitLine) rec.orbitLine.visible=pv.vis; } }
  for (const ip of _bhSaved.importedPos){ const im=imported.find(x=>x.id===ip.id); if(im){ im.object3d.position.copy(ip.p); im.object3d.visible=ip.vis; im.object3d.scale.setScalar(ip.sc==null?1:ip.sc); } }
  if (asteroidBelt && bhBeltBase){ const arr=asteroidBelt.geometry.attributes.position.array; arr.set(bhBeltBase); asteroidBelt.geometry.attributes.position.needsUpdate=true; asteroidBelt.visible=_bhSaved.beltVisible; }
  const sb=_bhSaved.sun;
  if (sb && sun){ sun.visible=(sb.vis!==false); sun.scale.setScalar(sb.scale==null?1:sb.scale); sun.material.color.setHex(sb.col);
    if (sunLight){ sunLight.intensity=sb.lightI; sunLight.color.setHex(sb.lightC); }
    if (sunGlow){ sunGlow.material.opacity=sb.glowO; sunGlow.material.color.setHex(sb.glowC); } }
  simDate = new Date(_bhSaved.simDate.getTime()); try{ updatePlanets(); }catch(_){}
}
// Reset each hole to the mass and size it had at placement (accretion grows them as
// bodies fall in) so a replay reproduces the event identically.
function bhResetHoles(){
  if (!_bhSaved || !_bhSaved.holes) return;
  for (const hs of _bhSaved.holes){ const bh=blackHoles.find(x=>x.id===hs.id); if(!bh) continue; bh.massMsun=hs.massMsun; bh.rs=hs.rs; bh.rs0=hs.rs0; bhUpdateMesh(bh); }
}
// Restart the whole event — restore the system to the moment of placement and play
// the entire infall again from the top. The chosen main character (bhCineStar) and
// every black hole are preserved. `silent` suppresses the confirmation toast (used
// when a recording restarts the event so it captures the show from the first frame).
function bhReplayEvent(silent){
  if (!bhCineOn) return;
  if (bhSimOn && _bhSaved){
    bhRestoreInitialState();                     // planets / Sun / imported / belt back to placement
    bhResetHoles();                              // holes back to their placement mass + size
    bhBodies = [];                               // rebuild the movable set from the restored, fully-visible system
    for (const p of PLANETS){ const rec = planetMeshes[p.key]; if (!rec || !rec.group.visible) continue; bhBodies.push(bhSnapshotBody('planet', rec, rec.group.position, p.mass||1e-9)); }
    for (const im of imported){ if (!im.object3d.visible) continue; bhBodies.push(bhSnapshotBody('imported', im, im.object3d.position, 3e-6)); }
    if (bhBeltVel) bhBeltVel.fill(0);
    if (bhBeltAlive) bhBeltAlive.fill(1);
    bhSeedVelocities();
    bhSunDrain=0; bhSunFed=false; _bhSunShred=0;
    for (let i=bhBurstList.length-1;i>=0;i--){ bhBurstList[i].cleanup(); bhBurstList.splice(i,1); }
  }
  bhCineT=0; bhCinePlaying=true; cineLastInput=0; bhCineUpdateUI();
  if (!silent) toast('Restarted — every body is back where it began · watch the whole event again');
}
function bhSimStop(restore){
  if (!bhSimOn) return;
  bhSimOn = false;
  if (restore) bhRestoreInitialState();
  bhBodies = []; bhBeltVel=null; bhBeltAlive=null; bhBeltBase=null; _bhSaved=null;
  bhSunDrain=0; bhSunFed=false; _bhSunShred=0;
  for (let i=bhBurstList.length-1;i>=0;i--){ bhBurstList[i].cleanup(); bhBurstList.splice(i,1); }
}

/* ---- Black-hole cinematic — its own "Sun's End" ---- */
function bhCineFocusTarget(out){
  // A chosen "main character" always wins — Focus lock then holds on that object.
  if (bhCineStar && cineCenterOf(bhCineStar, out) >= 0) return;
  if (bhCineFocusOn && selected){
    if (selected.type==='planet'){ const rec=planetMeshes[selected.key]; if(rec&&rec.group.visible){ out.copy(rec.group.position); return; } }
    else if (selected.type==='imported' && selected.im && selected.im.object3d.visible){ out.copy(selected.im.object3d.position); return; }
    else if (selected.type==='bh' && selected.bh.group){ out.copy(selected.bh.pos); return; }
  }
  if (bhCineTarget && bhCineTarget.group) out.copy(bhCineTarget.pos); else out.set(0,0,0);
}
function bhCineTick(dt){
  if (bhCinePlaying){ bhCineT += dt; if (bhCineT>=BH_CINE_DUR){ bhCineT=BH_CINE_DUR; bhCinePlaying=false; } }
  const bh = bhCineTarget;
  if (bh && bh.group){
    bhCineFocusTarget(_bhA);
    if (bhCineFocusOn){ orbit.target.lerp(_bhA, 1-Math.pow(0.02,dt)); }
    else if (bhCineStar && cineCenterOf(bhCineStar, _bhStarP) >= 0){ bhStarShot(dt); }   // a Scene object is the "main character" → timed POV shots
    else if (performance.now()-cineLastInput >= 3200){
      const f = _nvClamp(bhCineT/BH_CINE_DUR, 0, 1);
      const rs = bh.rs;
      const calm = _bhReduce()?0.4:1;
      // scripted beats: wide establish → push in → close orbit on infall → pull back
      let dist, elev;
      if (f < 0.15){ dist = rs*16 + 20; elev = 0.5; }
      else if (f < 0.5){ const u=_nvEase((f-0.15)/0.35); dist=_nvLerp(rs*16+20, rs*7.5, u); elev=_nvLerp(0.5,0.28,u); }
      else if (f < 0.85){ dist = rs*7.5; elev = 0.28; }
      else { const u=_nvEase((f-0.85)/0.15); dist=_nvLerp(rs*7.5, rs*13+16, u); elev=_nvLerp(0.28,0.44,u); }
      // POV shaping
      if (bh.pov==='faceon') elev = 1.15;
      else if (bh.pov==='edgeon') elev = 0.06;
      else if (bh.pov==='wide') dist *= 1.6;
      const ang = bhCineT*0.14*calm;
      _bhB.set(bh.pos.x + Math.cos(ang)*dist, bh.pos.y + dist*elev, bh.pos.z + Math.sin(ang)*dist);
      camera.position.lerp(_bhB, 1-Math.pow(0.0018,dt));
      orbit.target.lerp(bh.pos, 1-Math.pow(0.004,dt));
    }
  }
  // A live MP4 export auto-saves the moment the cinematic completes (same as Sun's End).
  if (bhRec && !bhRec.finishing && !bhCinePlaying && bhCineT>=BH_CINE_DUR){
    bhRec.finishing = true;
    setTimeout(()=>{ bhRecStop(true); }, 450);
  }
  _bhCineUiAccum += dt; if (_bhCineUiAccum>0.1){ _bhCineUiAccum=0; bhCineUpdateUI(); }
}
// Main-character choreography: while the cinematic plays (or records), a chosen
// Scene object becomes the subject and the camera cuts through a repeating set of
// timed shots — hero close-up → subject + black-hole two-shot → a neighbouring
// body cameo (supporting cast) → a wide of the black hole with the subject in the
// field. Framing distances scale with each body's true size via cineCenterOf().
function bhStarShot(dt){
  const bh = bhCineTarget; if (!bh) return;
  const sr = cineCenterOf(bhCineStar, _bhStarP);           // subject world-pos → _bhStarP, apparent radius → sr
  if (sr < 0){ bhCineStar = null; return; }                // subject vanished (e.g. absorbed) → fall back to the hole
  if (performance.now()-cineLastInput < 3200) return;      // the user is steering — don't fight them
  const calm = _bhReduce()?0.5:1;
  const beatLen = 3.4;
  const beat = Math.floor(bhCineT/beatLen) % 4;
  const ang = bhCineT*0.16*calm;
  const camPos = _bhB, tgt = _bhStarQ;
  if (beat === 0){                       // hero close-up of the subject
    const d = sr*6 + 3;
    camPos.set(_bhStarP.x+Math.cos(ang)*d, _bhStarP.y+d*0.35, _bhStarP.z+Math.sin(ang)*d);
    tgt.copy(_bhStarP);
  } else if (beat === 1){                 // two-shot: subject in the foreground, black hole beyond
    _bhMid.copy(_bhStarP).add(bh.pos).multiplyScalar(0.5);
    const span = _bhStarP.distanceTo(bh.pos);
    _bhTan.copy(_bhStarP).sub(bh.pos).cross(_bhUp);
    if (_bhTan.lengthSq() < 1e-6) _bhTan.set(1,0,0);
    _bhTan.normalize();
    const d = span*0.9 + sr*4 + bh.rs*3;
    camPos.copy(_bhMid).addScaledVector(_bhTan, d).addScaledVector(_bhUp, d*0.3);
    tgt.copy(_bhMid);
  } else if (beat === 2){                 // supporting cast — the nearest neighbouring body
    const nb = bhStarNeighbour();
    if (nb >= 0){ const d = _bhNbR*6 + 4; camPos.set(_bhNbP.x+Math.cos(ang)*d, _bhNbP.y+d*0.4, _bhNbP.z+Math.sin(ang)*d); tgt.copy(_bhNbP); }
    else { const d = sr*7 + 4; camPos.set(_bhStarP.x+Math.cos(ang)*d, _bhStarP.y+d*0.4, _bhStarP.z+Math.sin(ang)*d); tgt.copy(_bhStarP); }
  } else {                                // a wide of the black hole, subject in the field
    const d = bh.rs*11 + 16;
    camPos.set(bh.pos.x+Math.cos(ang)*d, bh.pos.y+d*0.4, bh.pos.z+Math.sin(ang)*d);
    tgt.copy(bh.pos);
  }
  camera.position.lerp(camPos, 1-Math.pow(0.0022,dt));
  orbit.target.lerp(tgt, 1-Math.pow(0.006,dt));
}
// Nearest Scene body to the current subject (excluding the subject itself); its
// world-pos lands in _bhNbP and apparent radius in _bhNbR. Returns radius or -1.
function bhStarNeighbour(){
  let best = -1, bestD = Infinity;
  for (const id of cineFocusList()){
    if (id === bhCineStar) continue;
    const r = cineCenterOf(id, _bhA);
    if (r < 0) continue;
    const d = _bhA.distanceTo(_bhStarP);
    if (d < bestD){ bestD = d; best = r; _bhNbP.copy(_bhA); _bhNbR = r; }
  }
  return best;
}
// Make a Scene object the cinematic's "main character". Passing the hole's own id
// (or null) returns to the default black-hole-centred show.
function bhCineSetStar(id){
  if (id && bhCineTarget && id === bhCineTarget.id) id = null;
  bhCineStar = id;
  bhCineFocusOn = false;
  cineLastInput = 0;
  const b = root && root.querySelector('#stBhFocus');
  if (b){ b.classList.remove('on'); b.setAttribute('aria-pressed','false'); }
  bhSyncStarHighlight();
  bhCineUpdateUI();
  toast(id ? ('Now starring ' + cineName(id) + ' — timed shots of it, its neighbours and ' + (bhCineTarget?bhCineTarget.name:'the black hole'))
           : 'Back to the black hole as the main subject');
}
function bhCineUpdateUI(){
  if (!bhBar || !root || !bhCineTarget) return;
  const bh = bhCineTarget;
  const f = _nvClamp(bhCineT/BH_CINE_DUR, 0, 1);
  const phase = f<0.15 ? 'Approach — the system as it was'
    : f<0.5 ? 'Infall begins — bodies leave their orbits'
    : f<0.85 ? 'Accretion — matter spirals past the horizon'
    : 'Aftermath — a rearranged system';
  const remain = bhBodies.filter(b=>b.alive).length;
  const starName = bhCineStar ? cineName(bhCineStar) : null;
  const titleEl = root.querySelector('#stBhTitle'); if (titleEl) titleEl.textContent = starName ? (starName + ' ✦ ' + bh.name) : bh.name;
  const timeEl = root.querySelector('#stBhPhase'); if (timeEl) timeEl.textContent = (starName ? ('Starring ' + starName) : phase) + ' · ' + remain + ' bodies remain';
  const scrub = root.querySelector('#stBhScrub'); if (scrub){ scrub.value=String(Math.round(f*1000)); scrub.style.setProperty('--nvp',(f*100).toFixed(1)+'%'); }
  const play = root.querySelector('#stBhPlay'); if (play) play.textContent = bhCinePlaying?'⏸':'▶';
  const note = root.querySelector('#stBhNote');
  if (note){
    note.innerHTML = `<b>${bh.name}</b> · ${bh.massMsun.toLocaleString(undefined,{maximumSignificantDigits:4})} M☉ · `+
      `event horizon r<sub>s</sub> = 2GM/c² ≈ <b>${bhFmtKm(bhTrueRsKm(bh.massMsun))}</b>. `+
      `Bodies follow accurate Newtonian gravity (superposed inverse-square attraction) — exact conic-section trajectories for the simulated field; the timescale is compressed for viewing. `+
      `Newtonian mechanics hold outside the strong-field region; general relativity refines the motion near the horizon.`;
  }
}
function bhEnterCinema(bh){
  if (!bh) return;
  if (novaOn) novaExit();
  if (ecOn) ecExit();
  bhCineTarget = bh; bhCineOn = true; bhCinePlaying = true; bhCineT = 0; bhCineFocusOn = false; bhCineStar = null; cineLastInput = 0;
  if (camMode==='cinematic') setCamMode('explore');
  if (dnPinsVisible) dnTogglePins(false);
  bhSimStart();
  const fbtn = root && root.querySelector('#stBhFocus'); if (fbtn){ fbtn.classList.remove('on'); fbtn.setAttribute('aria-pressed','false'); }
  if (bhBar) bhBar.classList.add('on');
  bhCountRefresh();
  // establishing shot
  const d = bh.rs*16 + 22;
  camera.position.set(bh.pos.x, bh.pos.y + d*0.5, bh.pos.z + d);
  orbit.target.copy(bh.pos);
  bhSyncStarHighlight();
  bhCineUpdateUI();
  toast('Black-hole cinematic · '+bh.name+' — the simulation begins · drag to change your view · ✕ to exit');
}
function bhCineExit(){
  if (!bhCineOn) return;
  if (bhRec) bhRecStop(true);           // a recording in progress is saved, not discarded
  bhCineOn = false; bhCinePlaying = false; bhCineFocusOn = false; bhCineStar = null;
  if (bhBar) bhBar.classList.remove('on');
  bhSyncStarHighlight();
  bhCountRefresh();
  toast('Exited the cinematic — the black hole and its physics keep running in the 3D view');
}
function bhCineTogglePlay(){ if(!bhCineOn) return; if(!bhCinePlaying && bhCineT>=BH_CINE_DUR) bhCineT=0; bhCinePlaying=!bhCinePlaying; cineLastInput=0; bhCineUpdateUI(); }
function bhCineReplay(){ bhReplayEvent(false); }
function bhCineSeek(frac){ if(!bhCineOn) return; bhCinePlaying=false; bhCineT=_nvClamp(frac,0,1)*BH_CINE_DUR; bhCineUpdateUI(); }
function bhCineToggleFocus(){
  if (!bhCineOn) return;
  bhCineFocusOn = !bhCineFocusOn;
  const b = root && root.querySelector('#stBhFocus');
  if (b){ b.classList.toggle('on', bhCineFocusOn); b.setAttribute('aria-pressed', String(bhCineFocusOn)); }
  toast(bhCineFocusOn ? 'Focus lock on — holding on your selected object' : 'Focus lock off — the camera resumes its cinematic path');
}

/* ---- Black-hole cinematic — MP4 export (the exact same engine as Sun's End) ----
   Records the black-hole cinematic to a downloadable video in two flavours:
     • Scene only              — the bare 3D render (canvas capture stream).
     • Scene + on-screen cards — the render composited with whatever HUD cards
                                 are open. Recording starts from the current POV,
   plays the full timeline once, and saves automatically when it finishes. MP4 is
   preferred; WebM is the transparent fallback. Video-only (no audio) by design. */
function bhExportMenu(){
  if (bhRec){ bhRecStop(true); return; }        // clicking ● Stop finishes + saves
  if (!bhCineOn || !root) return;
  const host = root.querySelector('#stBhBar'); if (!host) return;
  const existing = root.querySelector('#stBhExpMenu');
  if (existing){ existing.remove(); return; }    // toggle the chooser off
  const m = document.createElement('div');
  m.id='stBhExpMenu'; m.className='nv-menu';
  m.innerHTML =
    `<button data-m="scene">\ud83c\udfac Scene only</button>`+
    `<button data-m="cards">\ud83d\uddc2 Scene + on-screen cards</button>`;
  host.appendChild(m);
  m.addEventListener('click', e=>{
    const b=e.target.closest('button'); if(!b) return;
    const mode=b.getAttribute('data-m'); m.remove(); bhRecStart(mode);
  });
  setTimeout(()=>{
    const off=(ev)=>{
      if (!m.contains(ev.target) && ev.target.id!=='stBhExport'){
        m.remove(); document.removeEventListener('pointerdown', off, true);
      }
    };
    document.addEventListener('pointerdown', off, true);
  }, 0);
}
function bhRecStart(mode){
  if (bhRec || !bhCineOn || !renderer) return;
  const mime = novaPickVideoMime();
  if (mime===null){ toast('Video export is not supported in this browser'); return; }
  const gl = renderer.domElement;
  const srcW = gl.width || gl.clientWidth, srcH = gl.height || gl.clientHeight;
  if (!srcW || !srcH){ toast('Nothing to record yet — try again in a moment'); return; }
  const capW = Math.min(1920, srcW), capH = Math.max(2, Math.round(capW * srcH/srcW));

  let stream;
  if (mode==='cards'){
    const cap = document.createElement('canvas'); cap.width=capW; cap.height=capH;
    const cctx = cap.getContext('2d', { alpha:false });
    cctx.fillStyle='#05060d'; cctx.fillRect(0,0,capW,capH);
    bhRecComp = { canvas:cap, ctx:cctx, capW, capH, overlay:null, building:false, lastBuild:0 };
    stream = cap.captureStream(30);
  } else {
    try{ stream = gl.captureStream(30); }
    catch(_){ toast('This browser blocked canvas capture — cannot export'); return; }
  }

  const chunks = [];
  let rec;
  try{
    rec = mime ? new MediaRecorder(stream, { mimeType:mime, videoBitsPerSecond:8_000_000 })
               : new MediaRecorder(stream);
  }catch(_){
    try{ rec = new MediaRecorder(stream); }
    catch(e2){ toast('Could not start the video recorder'); bhRecComp=null; return; }
  }
  const ext = ((rec.mimeType||mime||'').indexOf('mp4')>=0) ? 'mp4' : 'webm';

  rec.ondataavailable = e=>{ if (e.data && e.data.size) chunks.push(e.data); };
  rec.onstop = ()=>{
    const save = !!(bhRec && bhRec.save);
    bhRecComp = null; bhRec = null;
    _bhRecRestoreUI();
    if (!save){ toast('Export cancelled'); return; }
    if (!chunks.length){ toast('Recording produced no data'); return; }
    const blob = new Blob(chunks, { type: chunks[0].type || mime || 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);
    a.href=url; a.download=`EWI-Cosmos-Black-Hole-${mode==='cards'?'with-cards':'scene'}-${ts}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(_){} }, 5000);
    toast(ext==='mp4'
      ? 'Saved your black-hole cinematic (MP4)'
      : 'Saved your black-hole cinematic (WebM \u2014 this browser can\u2019t record MP4)');
  };
  rec.onerror = ()=>{ bhRecComp=null; bhRec=null; _bhRecRestoreUI(); toast('Recording error \u2014 export stopped'); };

  bhRec = { rec, mode, save:false, finishing:false };
  // Restart the whole event so the recording captures it from the very first frame,
  // then hold the user's current POV briefly and play it once through.
  bhReplayEvent(true);
  bhCinePlaying=true; cineLastInput = performance.now(); bhCineUpdateUI();
  _bhRecSetUI(true);
  try{ rec.start(100); }catch(_){ try{ rec.start(); }catch(e3){ bhRecComp=null; bhRec=null; _bhRecRestoreUI(); toast('Could not start the video recorder'); return; } }
  toast(mode==='cards'
    ? 'Recording the black-hole cinematic with your on-screen cards \u2014 it saves automatically when it ends'
    : 'Recording the black-hole cinematic \u2014 it saves automatically when it ends');
}
function bhRecStop(save){
  if (!bhRec) return;
  bhRec.save = !!save;
  try{ bhRec.rec.stop(); }
  catch(_){ bhRecComp=null; bhRec=null; _bhRecRestoreUI(); }
}
function _bhRecSetUI(on){
  if (!root) return;
  const b = root.querySelector('#stBhExport');
  if (b){
    b.classList.toggle('nv-rec', on);
    b.textContent = on ? '\u25cf Stop' : '\u2913 MP4';
    b.title = on ? 'Stop and save the recording now' : 'Export this black-hole cinematic as an MP4 video';
  }
  ['#stBhScrub','#stBhPlay','#stBhReplay'].forEach(sel=>{
    const el = root.querySelector(sel); if (el) el.disabled = on;
  });
}
function _bhRecRestoreUI(){ _bhRecSetUI(false); }
// Per-frame composite for the "scene + cards" export — reuses the exact overlay
// rasteriser Sun's End uses, so the two exports are pixel-for-pixel the same engine.
function bhRecComposite(){
  const c = bhRecComp; if (!c) return;
  try{
    c.ctx.drawImage(renderer.domElement, 0,0, c.capW, c.capH);
    if (c.overlay) c.ctx.drawImage(c.overlay, 0,0, c.capW, c.capH);
    const now = performance.now();
    if (!c.building && now-c.lastBuild>280){ c.lastBuild=now; novaRecBuildOverlay(c); }
  }catch(_){}
}

/* ---- Black-hole count card — a Warp-Tempo-style +/− pop-up ----
   Appears only while Black Hole mode is active. Lets you add, remove, or reset
   the number of black holes without hunting for the toolbar toggle — so you can
   never accidentally switch the whole mode off while you only meant to add or
   remove a hole. Draggable, and it remembers where you left it. */
function bhModeActive(){ return blackHoles.length>0 || !!bhDraft || bhCineOn; }
function bhCountRefresh(){
  const card = root && root.querySelector('#stBhCount');
  if (!card) return;
  const active = bhModeActive();
  card.hidden = !active;
  card.classList.toggle('on', active);
  const n = blackHoles.length + (bhDraft?1:0);
  const nEl = card.querySelector('#stBhCountN'); if (nEl) nEl.textContent = String(n);
  const minus = card.querySelector('#stBhCountMinus'); if (minus) minus.disabled = (blackHoles.length===0 && !bhDraft);
  const reset = card.querySelector('#stBhCountReset'); if (reset) reset.disabled = (blackHoles.length===0 && !bhDraft);
}
function bhCountPlus(){
  if (root && root.querySelector('#stBhForm')) return;   // a configure card is already open — finish that hole first
  bhOpenForm();                                          // opens the configure-and-lock-in flow for a new hole
  bhCountRefresh();
}
function bhCountMinus(){
  if (bhDraft){ bhCancelForm(); bhCountRefresh(); return; }   // cancel the in-progress (not-yet-added) hole
  if (!blackHoles.length) return;
  bhRemove(blackHoles[blackHoles.length-1]);                  // remove the most recently added hole
  bhCountRefresh();
}
function bhCountReset(){
  if (bhDraft) bhCancelForm();
  const had = blackHoles.length;
  for (let i=blackHoles.length-1; i>=0; i--) bhRemove(blackHoles[i]);
  bhCountRefresh();
  if (had) toast(had===1 ? 'Removed the black hole' : ('Removed all ' + had + ' black holes'));
}
// Drag-to-move (grip only), position persisted — like the Warp Tempo card.
function bhCountInitDrag(){
  const card = root && root.querySelector('#stBhCount'); if (!card) return;
  const grip = card.querySelector('#stBhCountGrip'); if (!grip) return;
  try{
    const st = JSON.parse(localStorage.getItem('ewiCosmosBhCountPos')||'null');
    if (st && st.left){ card.style.left=st.left; card.style.top=st.top; card.style.right='auto'; card.style.bottom='auto'; }
  }catch(_){}
  let dragging=false, ox=0, oy=0;
  const onMove=(e)=>{
    if (!dragging) return;
    const x = Math.max(6, Math.min(window.innerWidth  - card.offsetWidth  - 6, e.clientX - ox));
    const y = Math.max(6, Math.min(window.innerHeight - card.offsetHeight - 6, e.clientY - oy));
    card.style.left=x+'px'; card.style.top=y+'px'; card.style.right='auto'; card.style.bottom='auto';
  };
  const onUp=()=>{
    dragging=false;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    try{ localStorage.setItem('ewiCosmosBhCountPos', JSON.stringify({ left:card.style.left, top:card.style.top })); }catch(_){}
  };
  grip.addEventListener('pointerdown', (e)=>{
    dragging=true;
    const r=card.getBoundingClientRect();
    ox=e.clientX-r.left; oy=e.clientY-r.top;
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    e.preventDefault();
  });
}

/* ---- Create → configure → lock-in flow ---- */
function bhDefaultPos(){
  // a spot out beyond the orbit target, in the outer system
  const t = orbit ? orbit.target.clone() : new THREE.Vector3();
  if (t.length() < 2) t.set(18, 4, 10);
  return t;
}
function bhOpenForm(){
  if (bhCineOn) bhCineExit();
  const existing = root.querySelector('#stBhForm');
  if (existing){ bhCancelForm(); return; }
  // create a live draft the user can see and tune before locking in
  const p = bhDefaultPos();
  const massMsun = 1e6;
  bhDraft = { id:'bh'+(bhSeq), name:'Black Hole '+(bhSeq), massMsun, rs:bhSuggestRadius(massMsun),
    rs0:bhSuggestRadius(massMsun), spin:0.6, tiltDeg:18, pov:'orbit', pos:p.clone(), draft:true };
  bhDraft.captureR = bhDraft.rs*0.92;
  bhBuild(bhDraft);
  bhFormBuild();
  // frame the draft
  const d = bhDraft.rs*15 + 20;
  if (camMode==='cinematic') setCamMode('explore');
  camera.position.set(p.x, p.y + d*0.5, p.z + d);
  orbit.target.copy(p);
  bhCountRefresh();
  toast('Configure your black hole — set its mass, size, position, spin, tilt and POV, then Lock in & begin');
}
function bhFormBuild(){
  const d = bhDraft;
  const card = document.createElement('div');
  card.id='stBhForm'; card.className='st-bhform'; card.setAttribute('role','dialog');
  card.setAttribute('aria-label','Configure a new black hole');
  const rsKm = bhFmtKm(bhTrueRsKm(d.massMsun));
  card.innerHTML =
    `<div class="bhf-h"><span>◕ New black hole</span><button id="stBhCancel" class="bhf-x" type="button" title="Cancel" aria-label="Cancel">✕</button></div>`+
    `<label class="bhf-row"><span>Name</span><input id="bhfName" type="text" value="${d.name}" aria-label="Black hole name"></label>`+
    `<label class="bhf-row"><span>Mass — log₁₀(M☉)</span><input id="bhfMass" type="range" min="0" max="10" step="0.05" value="${Math.log10(d.massMsun).toFixed(2)}" aria-label="Mass, log base 10 of solar masses"></label>`+
    `<div class="bhf-read" id="bhfMassRead">${d.massMsun.toLocaleString(undefined,{maximumSignificantDigits:4})} M☉ · r<sub>s</sub> ≈ ${rsKm}</div>`+
    `<label class="bhf-row"><span>Size (scene)</span><input id="bhfSize" type="range" min="0.4" max="16" step="0.1" value="${d.rs.toFixed(1)}" aria-label="On-screen horizon size in scene units"></label>`+
    `<div class="bhf-note">Drag the hole directly in the 3D view to place it — X / Y / Z update as you move, so there's no need to type them.</div>`+
    `<div class="bhf-xyz">`+
      `<label><span>X</span><input id="bhfX" type="number" step="0.5" value="${d.pos.x.toFixed(1)}" aria-label="Position X"></label>`+
      `<label><span>Y</span><input id="bhfY" type="number" step="0.5" value="${d.pos.y.toFixed(1)}" aria-label="Position Y"></label>`+
      `<label><span>Z</span><input id="bhfZ" type="number" step="0.5" value="${d.pos.z.toFixed(1)}" aria-label="Position Z"></label>`+
    `</div>`+
    `<label class="bhf-row"><span>Spin a*</span><input id="bhfSpin" type="range" min="-0.998" max="0.998" step="0.002" value="${d.spin}" aria-label="Dimensionless spin"></label>`+
    `<label class="bhf-row"><span>Disk tilt°</span><input id="bhfTilt" type="range" min="0" max="90" step="1" value="${d.tiltDeg}" aria-label="Accretion disk tilt in degrees"></label>`+
    `<label class="bhf-row"><span>POV</span><select id="bhfPov" aria-label="Cinematic point of view">`+
      `<option value="orbit">Cinematic orbit</option><option value="edgeon">Edge-on</option><option value="faceon">Face-on / top</option><option value="wide">Wide</option></select></label>`+
    `<div class="bhf-note">Newtonian gravity drives every body toward the hole with exact inverse-square attraction; each hole's characteristics are independent. r<sub>s</sub> = 2GM/c². GR refines motion near the horizon.</div>`+
    `<div class="bhf-actions"><button id="stBhLock" class="bhf-go" type="button">Lock in &amp; begin ▸</button><button id="stBhCancel2" class="bhf-cancel" type="button">Cancel</button></div>`;
  root.appendChild(card);
  const q = s=>card.querySelector(s);
  const readMass = ()=>{ const m=Math.pow(10, parseFloat(q('#bhfMass').value)); q('#bhfMassRead').innerHTML = m.toLocaleString(undefined,{maximumSignificantDigits:4})+' M☉ · r<sub>s</sub> ≈ '+bhFmtKm(bhTrueRsKm(m)); return m; };
  q('#bhfName').addEventListener('input', ()=>bhApplyDraft());
  q('#bhfMass').addEventListener('input', ()=>{ readMass(); bhApplyDraft(true); });
  q('#bhfSize').addEventListener('input', ()=>bhApplyDraft());
  ['#bhfX','#bhfY','#bhfZ'].forEach(s=>q(s).addEventListener('input', ()=>bhApplyDraft()));
  q('#bhfSpin').addEventListener('input', ()=>bhApplyDraft());
  q('#bhfTilt').addEventListener('input', ()=>bhApplyDraft());
  q('#bhfPov').addEventListener('change', ()=>bhApplyDraft());
  q('#stBhLock').addEventListener('click', bhLockIn);
  q('#stBhCancel').addEventListener('click', bhCancelForm);
  q('#stBhCancel2').addEventListener('click', bhCancelForm);
}
function bhApplyDraft(massChanged){
  const d = bhDraft; if (!d) return; const card = root.querySelector('#stBhForm'); if (!card) return;
  const q = s=>card.querySelector(s);
  d.name = q('#bhfName').value || d.name;
  const newMass = Math.pow(10, parseFloat(q('#bhfMass').value)||0);
  if (massChanged){
    d.massMsun = newMass;
    // suggest a matching size unless the user has dragged Size themselves
    const suggested = bhSuggestRadius(newMass);
    q('#bhfSize').value = suggested.toFixed(1);
  } else {
    d.massMsun = newMass;
  }
  d.rs = parseFloat(q('#bhfSize').value)||d.rs; d.rs0 = d.rs;
  d.pos.set(parseFloat(q('#bhfX').value)||0, parseFloat(q('#bhfY').value)||0, parseFloat(q('#bhfZ').value)||0);
  d.spin = parseFloat(q('#bhfSpin').value)||0; d.diskSpin = d.spin>=0?1:-1;
  d.tiltDeg = parseFloat(q('#bhfTilt').value)||0;
  d.pov = q('#bhfPov').value || 'orbit';
  bhUpdateMesh(d);
}
function bhLockIn(){
  const d = bhDraft; if (!d) return;
  bhApplyDraft();
  d.draft = false;
  blackHoles.push(d);
  bhSeq++;
  bhDraft = null;
  const card = root.querySelector('#stBhForm'); if (card) card.remove();
  refreshObjList();
  bhEnterCinema(d);
}
function bhCancelForm(){
  const card = root.querySelector('#stBhForm'); if (card) card.remove();
  if (bhDraft){ bhDispose(bhDraft); bhDraft=null; }
  bhCountRefresh();
  toast('Cancelled');
}
function bhRemove(bh){
  const i = blackHoles.indexOf(bh); if (i<0) return;
  if (bhCineOn && bhCineTarget===bh) bhCineExit();
  bhDispose(bh);
  blackHoles.splice(i,1);
  if (selected && selected.type==='bh' && selected.bh===bh){ selected=null; if(inspectorEl) inspectorEl.innerHTML='<div class="st-note">Select a body or imported object to inspect and transform it.</div>'; }
  if (!blackHoles.length) bhSimStop(true);   // last hole gone → restore the Solar System
  refreshObjList();
  bhCountRefresh();
  toast('Removed '+bh.name+(blackHoles.length?'':' — Solar System restored'));
}
function selectBlackHole(bh){
  selected = { type:'bh', bh };
  if (transform) transform.detach();
  highlightList(bh.id);
  bhInspector(bh);
}
// Toggle-off: clicking the already-selected hole in the Scene list clears the selection
// (Finder-like), leaving every hole independently selectable.
function bhDeselect(){
  selected = null;
  highlightList('__none__');                    // clears the .sel highlight from every row
  if (inspectorEl) inspectorEl.innerHTML = '<div class="st-note">Select a body or imported object to inspect and transform it.</div>';
}
function focusBlackHole(bh){
  if (!bh.group) return;
  const d = bh.rs*14 + 16;
  orbit.target.copy(bh.pos);
  camera.position.set(bh.pos.x + d, bh.pos.y + d*0.5, bh.pos.z + d);
}
function bhInspector(bh){
  if (!inspectorEl) return;
  const rsKm = bhFmtKm(bhTrueRsKm(bh.massMsun));
  inspectorEl.innerHTML =
    `<div class="st-insp-bh">`+
    `<div class="ib-h">◕ ${bh.name}</div>`+
    `<div class="ib-row"><span>Mass</span><b>${bh.massMsun.toLocaleString(undefined,{maximumSignificantDigits:5})} M☉</b></div>`+
    `<div class="ib-row"><span>Schwarzschild r<sub>s</sub></span><b>${rsKm}</b></div>`+
    `<div class="ib-row"><span>Spin a*</span><b>${bh.spin.toFixed(3)}</b></div>`+
    `<div class="ib-row"><span>Position</span><b>${bh.pos.x.toFixed(1)}, ${bh.pos.y.toFixed(1)}, ${bh.pos.z.toFixed(1)}</b></div>`+
    `<div class="ib-actions"><button id="stBhInspPlay" class="bhf-go" type="button">▸ Cinematic</button><button id="stBhInspDel" class="bhf-cancel" type="button">Remove</button></div>`+
    `<div class="ib-note">r<sub>s</sub> = 2GM/c². Bodies fall in under accurate Newtonian gravity — exact conic-section paths for the simulated field; timescale compressed for viewing.</div>`+
    `</div>`;
  const pl = inspectorEl.querySelector('#stBhInspPlay'); if (pl) pl.addEventListener('click', ()=>bhEnterCinema(bh));
  const dl = inspectorEl.querySelector('#stBhInspDel'); if (dl) dl.addEventListener('click', ()=>bhRemove(bh));
}

/* ---- Direct manipulation: click a hole to select it, drag to move it through
   space, press Del to remove it. Runs in the capture phase, ahead of
   OrbitControls, so grabbing a hole never also spins the camera. ---- */
function bhGrabPointer(e){
  if (!open) return;
  if (!blackHoles.length && !bhDraft) return;                       // holes (or a live draft) must exist
  if (e.target !== renderer.domElement || e.button !== 0) return;   // primary click on the canvas only
  if (novaOn || ecOn) return;                                       // never interrupt a scripted cinematic
  if (transform && transform.dragging) return;
  const r = renderer.domElement.getBoundingClientRect();
  _bhPick.x = ((e.clientX - r.left)/r.width)*2 - 1;
  _bhPick.y = -((e.clientY - r.top)/r.height)*2 + 1;
  raycaster.setFromCamera(_bhPick, camera);
  const holes = bhDraft ? blackHoles.concat([bhDraft]) : blackHoles;
  const meshes = [];
  for (const bh of holes){ if (bh.horizon) meshes.push(bh.horizon); if (bh.disk) meshes.push(bh.disk); }
  const hit = raycaster.intersectObjects(meshes, false)[0];
  if (!hit) return;
  let bh = null;
  for (const h of holes){ if (h.horizon===hit.object || h.disk===hit.object){ bh=h; break; } }
  if (!bh) return;
  const isDraft = (bh===bhDraft);
  if (!isDraft) selectBlackHole(bh);            // dragging the draft keeps its configure form open
  orbit.enabled = false;
  cineLastInput = performance.now();            // pause any auto-direction while dragging
  camera.getWorldDirection(_bhDragN).normalize();
  _bhDragPlane.setFromNormalAndCoplanarPoint(_bhDragN, bh.pos);   // a camera-facing plane through the hole
  if (raycaster.ray.intersectPlane(_bhDragPlane, _bhDragHit)) _bhDragOff.copy(bh.pos).sub(_bhDragHit);
  else _bhDragOff.set(0,0,0);
  bhDrag = { bh, isDraft, moved:false, uiN:0 };
  renderer.domElement.style.cursor = 'grabbing';
  window.addEventListener('pointermove', bhDragMove, true);
  window.addEventListener('pointerup', bhDragEnd, true);
  e.stopImmediatePropagation(); e.preventDefault();
}
function bhDragMove(e){
  if (!bhDrag) return;
  const bh = bhDrag.bh;
  const r = renderer.domElement.getBoundingClientRect();
  _bhPick.x = ((e.clientX - r.left)/r.width)*2 - 1;
  _bhPick.y = -((e.clientY - r.top)/r.height)*2 + 1;
  raycaster.setFromCamera(_bhPick, camera);
  if (raycaster.ray.intersectPlane(_bhDragPlane, _bhDragHit)){
    bh.pos.copy(_bhDragHit).add(_bhDragOff);
    if (bh.group) bh.group.position.copy(bh.pos);
    bhDrag.moved = true;
    if (bhDrag.isDraft){
      // live-update the configure form's X / Y / Z so lock-in keeps the dragged spot
      const card = root.querySelector('#stBhForm');
      if (card){ const q=s=>card.querySelector(s);
        if (q('#bhfX')) q('#bhfX').value = bh.pos.x.toFixed(1);
        if (q('#bhfY')) q('#bhfY').value = bh.pos.y.toFixed(1);
        if (q('#bhfZ')) q('#bhfZ').value = bh.pos.z.toFixed(1);
      }
    } else if ((++bhDrag.uiN % 3)===0 && selected && selected.type==='bh' && selected.bh===bh){ bhInspector(bh); }
  }
  e.stopImmediatePropagation(); e.preventDefault();
}
function bhDragEnd(e){
  window.removeEventListener('pointermove', bhDragMove, true);
  window.removeEventListener('pointerup', bhDragEnd, true);
  const bh = bhDrag && bhDrag.bh;
  bhDrag = null;
  if (orbit) orbit.enabled = true;
  if (renderer) renderer.domElement.style.cursor = '';
  if (bh && selected && selected.type==='bh' && selected.bh===bh) bhInspector(bh);
  if (e) e.stopImmediatePropagation();
}
// A soft, camera-facing halo around the currently selected hole — clear visual
// confirmation of what a Del press (or Remove) will delete. Honors reduced-motion.
function bhSyncSelRing(){
  const sel = (selected && selected.type==='bh') ? selected.bh : null;
  if (!sel || !sel.group){ if (bhSelRing) bhSelRing.visible = false; return; }
  if (!bhSelRing){
    bhSelRing = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1.0, 64),
      new THREE.MeshBasicMaterial({ color:0x6cf0ff, transparent:true, opacity:0.9, side:THREE.DoubleSide,
        blending:THREE.AdditiveBlending, depthWrite:false, depthTest:false }));
    bhSelRing.renderOrder = 6; scene.add(bhSelRing);
  }
  bhSelRing.visible = true;
  bhSelRing.position.copy(sel.pos);
  const pulse = _bhReduce() ? 1 : (1 + Math.sin(performance.now()*0.004)*0.05);
  bhSelRing.scale.setScalar(sel.rs*2.2*pulse);
  bhSelRing.quaternion.copy(camera.quaternion);   // billboard toward the viewer
}
// A short-lived debris stream shed by a body as it is torn apart and drawn inward.
function bhShred(pos, bh, f){
  if (bhBurstList.length > 140) return;            // resilience: bound the particle budget
  const N = _bhReduce() ? 2 : 4;
  const geo = new THREE.BufferGeometry();
  const pp = new Float32Array(N*3);
  const vv = [];
  _bhTmp.copy(bh.pos).sub(pos); const L = _bhTmp.length()||1; _bhTmp.multiplyScalar(1/L);   // unit vector toward the hole
  for (let i=0;i<N;i++){
    pp[i*3]=pos.x; pp[i*3+1]=pos.y; pp[i*3+2]=pos.z;
    const jx=(Math.random()-0.5)*1.2, jy=(Math.random()-0.5)*1.2, jz=(Math.random()-0.5)*1.2;
    vv.push(new THREE.Vector3(_bhTmp.x*(2.4+3*f)+jx, _bhTmp.y*(2.4+3*f)+jy, _bhTmp.z*(2.4+3*f)+jz));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pp,3));
  const mat = new THREE.PointsMaterial({ color:0xffd8a8, size:2, sizeAttenuation:false, transparent:true,
    opacity:0.95, blending:THREE.AdditiveBlending, depthWrite:false });
  const pts = new THREE.Points(geo, mat); pts.renderOrder=5; scene.add(pts);
  const cleanup = ()=>{ scene.remove(pts); geo.dispose(); mat.dispose(); };
  bhBurstList.push({ life:0, dur:0.45, geo, mat, vv, N, cleanup });
}
// Stellar death: a star within a hole's reach bleeds energy to it — its light fades,
// its corona cools and reddens, it collapses in size and finally goes dark, its mass
// feeding the hole. Faithful in spirit to tidal disruption / accretion of a star.
function bhStellarTick(dt){
  if (!bhSimOn || novaOn || !sun) return;
  let near=null, nd=Infinity;
  for (const h of blackHoles){ const d=h.pos.distanceTo(sun.position); if(d<nd){ nd=d; near=h; } }
  if (near){
    const reach = near.rs*8 + 24;                 // envelope within which the star loses energy
    if (nd < reach){
      const prox = _nvClamp((reach-nd)/reach, 0, 1);   // 0 at the edge → 1 at contact
      bhSunDrain = _nvClamp(bhSunDrain + dt*(0.04 + prox*prox*0.5), 0, 1);   // dies faster the closer the hole
      _bhSunShred += dt;                                // a thin stream of plasma peels off toward the hole
      if (bhSunDrain>0.02 && bhSunDrain<1 && _bhSunShred>0.05){ _bhSunShred=0; bhShred(sun.position, near, 0.5+0.5*prox); }
    }
  }
  bhApplySunDrain(near);
}
function bhApplySunDrain(near){
  const b = _bhSaved && _bhSaved.sun; if (!b) return;
  const k = bhSunDrain, inv = 1-k;
  if (sunLight) sunLight.intensity = b.lightI*inv;                        // energy / light fades
  if (sunGlow) sunGlow.material.opacity = b.glowO*inv;                    // corona fades
  _bhSunCol.setHex(b.col).lerp(_bhSunColDead, k);                         // cools toward a cold ember
  if (sun){
    sun.material.color.copy(_bhSunCol);
    sun.scale.setScalar(Math.max(0.001, b.scale*(1-0.985*k)));           // collapses as it is devoured
    sun.visible = k < 1;
  }
  if (k>=1 && !bhSunFed && near){ bhGrow(near, 1.0); bhSunFed=true; toast('The Sun has died — its mass now feeds '+near.name); }
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
  if (m==='cinematic'){ transform.detach(); cineNextCut = 0; cineLastInput = 0; cineParked = false; }
  else { cineFocusOn = false; }
  cineUpdateDock();
}

/* Slide / truck mode — remaps the primary drag (and one-finger touch) from
   orbit to screen-space pan, so the user can glide the focal point (orbit.target)
   to any new X·Y·Z, decoupled from the currently-focused body. Zoom (wheel /
   pinch) and the secondary drag are unchanged, so nothing is lost when it's off.
   Toggled by the G key or the ✥ Slide button (tap / trackpad friendly). */
function setPanMode(on){
  panMode = !!on;
  if (orbit){
    orbit.screenSpacePanning = true;                 // pan in the view plane → free X·Y·Z glide
    orbit.mouseButtons.LEFT = panMode ? THREE.MOUSE.PAN   : THREE.MOUSE.ROTATE;
    orbit.touches.ONE       = panMode ? THREE.TOUCH.PAN   : THREE.TOUCH.ROTATE;
  }
  const btn = root && root.querySelector('#stPan');
  if (btn){ btn.classList.toggle('on', panMode); btn.setAttribute('aria-pressed', String(panMode)); }
  if (renderer) renderer.domElement.style.cursor = panMode ? 'move' : '';
  toast(panMode
    ? 'Slide mode on — drag or one-finger / trackpad to move the focal point (X·Y·Z); wheel / pinch still zooms'
    : 'Slide mode off — drag orbits the focused body again');
}

/* Align-to-plane views — snap the camera to look straight at a principal
   coordinate plane while keeping the current focal point (orbit.target) and
   distance: front = X·Y (down the Z axis), top = X·Z (down the Y axis),
   side = Y·Z (down the X axis). This is the CAD / engineering orientation
   convention (used across aerospace, robotics, gaming, manufacturing, GIS),
   layered on top of free orbit, Slide (pan) and zoom — nothing else changes.
   Pressing the same plane again flips to the opposite side. Keys 1 / 2 / 3. */
function alignViewPlane(plane){
  if (!orbit || !camera || !(plane==='xy'||plane==='xz'||plane==='yz')) return;
  if (navFlyEngaged){ navFlyEngaged=false; navUpdateFlyBtn(); }   // supersede a NAVLINQ fly-to
  const tgt = orbit.target.clone();
  const off = camera.position.clone().sub(tgt);
  const d   = Math.max(off.length(), orbit.minDistance*1.5, 1e-4);   // keep the current standoff
  // Keep the current hemisphere; a repeat press on the active plane flips it.
  const comp = plane==='xy' ? off.z : plane==='yz' ? off.x : off.y;
  let side = comp>=0 ? 1 : -1;
  if (viewPlane===plane) side = -viewPlaneSide;
  viewPlane = plane; viewPlaneSide = side;
  let dir;
  if (plane==='xy')      dir = new THREE.Vector3(0, 0, side);        // front — X → right, Y → up
  else if (plane==='yz') dir = new THREE.Vector3(side, 0, 0);        // side  — Z → right, Y → up
  else                   dir = new THREE.Vector3(0, side, 0.001);    // top — X → right, Z → up; a ~0.057° tilt (≈0.1% of the radius) keeps the azimuth defined, avoiding the exact pole singularity — imperceptible, so orbiting stays stable
  dir.normalize();
  const end = tgt.clone().addScaledVector(dir, d);
  zoom3D.active = false;
  dnFlight = { active:true, t:0, dur: Math.min(0.85, Math.max(0.35, dnTempoDur()*0.5)), tag:'plane',
    p0: camera.position.clone(), t0: orbit.target.clone(), p1: end, t1: tgt };
  updatePlaneBtns();
  const nm = plane==='xy' ? 'front (X·Y)' : plane==='xz' ? 'top-down (X·Z)' : 'side (Y·Z)';
  toast('Aligned to the '+nm+' view — drag to fine-tune the angle, wheel / pinch to zoom, ✥ Slide to reframe');
}
function updatePlaneBtns(){
  if (!root) return;
  [['xy','#stPlaneXY'],['xz','#stPlaneXZ'],['yz','#stPlaneYZ']].forEach(([p,sel])=>{
    const b = root.querySelector(sel);
    if (b){ b.classList.toggle('on', viewPlane===p); b.setAttribute('aria-pressed', String(viewPlane===p)); }
  });
}

function focusKey(key){
  const rec = planetMeshes[key]; if (!rec) return;
  const p = PLANETS.find(x=>x.key===key);
  const r = 5 + (p?p.size:1)*4;
  const tgt = rec.group.position.clone();
  orbit.target.copy(tgt);
  camera.position.set(tgt.x + r, tgt.y + r*0.5, tgt.z + r);
}
function focusMoon(){
  // The Moon isn't in planetMeshes (it orbits Earth as its own mesh), so it needs
  // a dedicated close focus for the Scene-list entry. Snap in tight, matching the
  // instant focus the other Scene-list rows use.
  if (!moon) return;
  const tgt = moon.mesh.getWorldPosition(new THREE.Vector3());
  const r = 0.6;
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
  // The teal offset pin explains why the dashed line appears — check it first
  // (it's the smaller, more specific target sitting beside the midpoint marker).
  if (navOffsetMarker){
    const offHit = raycaster.intersectObject(navOffsetMarker, false)[0];
    if (offHit){ navExplainOffset(); return; }
  }
  // The NAVLINQ midpoint marker is selectable — clicking it focuses/flies there.
  if (navMidMarker){
    const midHit = raycaster.intersectObject(navMidMarker, false)[0];
    if (midHit){ navFlyToMidpoint(); return; }
  }
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
    <div class="st-note"><b>${p?p.name:(key?String(key).charAt(0).toUpperCase()+String(key).slice(1):'Body')}</b></div>` +
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
  if (moon) rows.push(listRow('moon', 'Moon', 0xb388ff, false));   // Moon gets its own lavender Scene-list entry (matches its purple thumbtack)
  rows.push(bhListGroup());                                        // Black Holes — a parent row (＋ / − / count) with one deletable sub-row per hole
  for (const im of imported) rows.push(listRow(im.id, im.name, 0x7c5cff, true, im));
  objListEl.innerHTML = rows.join('');
  // Parent-row ＋ / − controls — add a hole (activating Black Hole mode) or remove the most recent one.
  objListEl.querySelectorAll('[data-bhact]').forEach(btn=>{
    btn.addEventListener('click', ev=>{
      ev.stopPropagation();
      const act = btn.getAttribute('data-bhact');
      if (act==='plus') bhCountPlus(); else if (act==='minus') bhCountMinus();
    });
  });
  objListEl.querySelectorAll('.st-item').forEach(el=>{
    el.addEventListener('click', ev=>{
      if (ev.target.closest('[data-bhact]')) return;               // the +/− buttons handle themselves
      if (ev.target.classList.contains('x')) return;
      if (el.dataset.bhhead){ bhCountPlus(); return; }             // clicking the "Black Holes" header adds a hole (activates the mode)
      const id = el.dataset.id;
      // While a black-hole cinematic is playing or recording, clicking any Scene
      // object makes it the "main character" of the shot instead of re-framing.
      if (bhCineOn){ bhCineSetStar(id); return; }
      const bh = blackHoles.find(x=>x.id===id);
      const im = imported.find(x=>x.id===id);
      if (bh){ if (selected && selected.type==='bh' && selected.bh===bh){ bhDeselect(); return; } cineHold(); focusBlackHole(bh); selectBlackHole(bh); return; }
      if (id==='moon'){ if (navMode){ navToggleBody('moon'); return; } cineHold(); focusMoon(); selectPlanet('moon'); return; }
      if (im){ cineHold(); focusObject(im.object3d); selectImported(im); }
      else if (id==='sun'){ if(navMode) return; cineHold(); selectPlanet('Sun'); focusKey('mercury'); }
      else if (navMode && planetMeshes[id]){ navToggleBody(id); }
      else { cineHold(); focusKey(id); selectPlanet(id); }
    });
    const x = el.querySelector('.x');
    if (x) x.addEventListener('click', ()=>{
      const bh = blackHoles.find(b=>b.id===el.dataset.id);
      if (bh){ bhRemove(bh); return; }
      const im=imported.find(i=>i.id===el.dataset.id); if (im) removeImported(im);
    });
  });
  cineListKey = undefined; cineSyncList();   // the list was re-rendered \u2014 re-apply the cinematic "now showing" highlight
  bhSyncStarHighlight();                      // and the black-hole "main character" highlight
}
// The Black Holes group: a parent header carrying a live count and ＋ / − buttons,
// followed by one indented, independently-deletable sub-row per hole. Adding a hole
// (count > 0) activates Black Hole mode; each sub-row's ✕ removes that specific hole.
function bhListGroup(){
  const n = blackHoles.length;
  const subs = blackHoles.map(bh=>{
    const star = (bhCineOn && bhCineStar===bh.id) ? ' bh-star' : '';
    return `<div class="st-item st-bhsub${star}" data-id="${bh.id}">`+
      `<span class="st-dot st-bhdot" style="background:#140a22" aria-hidden="true">◕</span>`+
      `<span>${bhEsc(bh.name)}</span>`+
      `<span class="x" title="Delete this black hole" aria-label="Delete ${bhEsc(bh.name)}">✕</span></div>`;
  }).join('');
  return `<div class="st-bhgroup">`+
    `<div class="st-item st-bhhead" data-bhhead="1" title="Add or remove black holes — adding one activates Black Hole mode">`+
      `<span class="st-dot st-bhdot" style="background:#140a22" aria-hidden="true">◕</span>`+
      `<span>Black Holes</span>`+
      `<span class="bhg-count" id="stBhListN" aria-label="${n} black hole${n===1?'':'s'}">${n}</span>`+
      `<span class="bhg-ctl">`+
        `<button class="bhg-btn" data-bhact="minus" type="button" title="Remove the most recent black hole" aria-label="Remove a black hole"${n?'':' disabled'}>−</button>`+
        `<button class="bhg-btn" data-bhact="plus" type="button" title="Add a black hole (activates Black Hole mode)" aria-label="Add a black hole">＋</button>`+
      `</span>`+
    `</div>`+ subs +
  `</div>`;
}
// Keep the Scene-list "main character" highlight in sync with bhCineStar.
function bhSyncStarHighlight(){
  if (!objListEl) return;
  const id = (bhCineOn && bhCineStar) ? String(bhCineStar) : null;
  objListEl.querySelectorAll('.st-item').forEach(el=> el.classList.toggle('bh-star', id!=null && el.dataset.id===id));
}
function bhEsc(s){ return String(s).replace(/[&<>"]/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }
function listRow(id,name,color,rm,im,isBH){
  const hex = '#'+color.toString(16).padStart(6,'0');
  const dot = isBH
    ? `<span class="st-dot st-bhdot" style="background:${hex}" aria-hidden="true">◕</span>`
    : `<span class="st-dot" style="background:${hex}"></span>`;
  return `<div class="st-item" data-id="${id}">
    ${dot}<span>${name}</span>${rm?'<span class="x" title="Remove">✕</span>':''}</div>`;
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
  // Don't hijack typing in the dwell field, event picker, or any text input.
  const ae = document.activeElement;
  if (ae && (ae.tagName==='INPUT' || ae.tagName==='SELECT' || ae.tagName==='TEXTAREA' || ae.isContentEditable)){
    if (e.key!=='Escape') return;
  }
  const k = e.key.toLowerCase();
  if (k==='escape'){ transform.detach(); selected=null; return; }
  if (k==='w'){ transform.setMode('translate'); }
  else if (k==='e'){ transform.setMode('rotate'); }
  else if (k==='r'){ transform.setMode('scale'); }
  else if (k==='f'){ if (selected?.type==='imported') focusObject(selected.im.object3d); else if (selected?.type==='planet') focusKey(selected.key); }
  else if (k==='delete'||k==='backspace'){ if (selected?.type==='imported') removeImported(selected.im); else if (selected?.type==='bh') bhRemove(selected.bh); }
  else if (k===' '){ playing=!playing; playBtn.textContent=playing?'⏸':'▶'; e.preventDefault(); }
  else if (k==='c'){ setCamMode(camMode==='cinematic'?'explore':'cinematic'); }
  else if (k==='g'){ setPanMode(!panMode); }
  else if (k==='h'){ toggleImmersive(); }
  else if (k==='1'){ alignViewPlane('xy'); }
  else if (k==='2'){ alignViewPlane('xz'); }
  else if (k==='3'){ alignViewPlane('yz'); }
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
  applyPanelPrefs();                            // device-aware: phones/tablets start uncluttered
  applyTimeDockPref();                          // device-aware: phones start with the collapsed time pill
  clock.start();
  // resume audio contexts after the user gesture that opened the studio
  if (listener.context.state==='suspended') listener.context.resume().catch(()=>{});
  if (!raf) animate();
  saveView('3d');                               // remember this view for the next visit
  if (!_restoringView) toast('3D Studio — drag to orbit, or press C for cinematic');
}
function close(){
  open = false; root.classList.remove('on');
  if (ecOn) ecExit();                           // leave Event Cinema cleanly
  if (novaOn) novaExit();                       // restore the Sun + planets before leaving 3D
  toggleSuiteChrome(false);
  syncViewSwitch(false);
  cancelAnimationFrame(raf); raf = 0;
  saveView('2d');                               // remember this view for the next visit
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
  // Restore the last view chosen on this device. Default is now 3D (no stored
  // value → first-time visitors land in the immersive 3D studio); only an
  // explicit prior '2d' choice keeps the flat physics sandbox. Auto-open is
  // silent; audio stays suspended until the first real gesture (browser
  // autoplay policy) — openStudio already tolerates that gracefully.
  // Deferred to the next tick so every top-level binding in this module (e.g.
  // dnInited, used by buildScene→initDeepNav) is fully initialised before the
  // studio builds — wireOpener can run mid-evaluation, so opening inline would
  // hit a temporal-dead-zone on those later declarations.
  if (readView()!=='2d'){
    setTimeout(()=>{
      if (open) return;
      _restoringView = true;
      try{ openStudio(); } finally { _restoringView = false; }
    }, 0);
  }
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
let dnTempoDock=null;                           // null (floating) | 'left' | 'right' | 'time' — which pop-up card the Warp-tempo card is integrated into
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
// Human-calendar ETA helpers (seconds → readable). Gregorian mean year/month.
const ETA_UNITS = [
  ['millennium','millennia', 3.1556952e10],
  ['century','centuries',    3.1556952e9],
  ['decade','decades',       3.1556952e8],
  ['year','years',           3.1556952e7],
  ['month','months',         2629746],      // 30.436875 d
  ['day','days',             86400],
  ['hour','hours',           3600],
  ['minute','minutes',       60],
  ['second','seconds',       1]
];
// Technical ETA: precise breakdown across the 3 largest non-zero calendar units
// (e.g. "3 years 2 months 14 days"). Sub-minute falls back to fmtSeconds.
function fmtDurTech(s){
  if (!isFinite(s) || s<=0) return '0 s';
  if (s<60) return fmtSeconds(s);
  let rem=s; const parts=[];
  for (const [sing,plur,size] of ETA_UNITS){
    if (rem>=size){
      const v=Math.floor(rem/size); rem-=v*size;
      if (v>0) parts.push(v+' '+(v===1?sing:plur));
      if (parts.length>=3) break;
    }
  }
  return parts.length ? parts.join(' ') : fmtSeconds(s);
}
// Layman ETA: one friendly, rounded phrase (e.g. "about 3 years", "just over 6 hours").
function fmtDurLay(s){
  if (!isFinite(s) || s<=0) return 'instant';
  if (s<60) return 'under a minute';
  for (const [sing,plur,size] of ETA_UNITS){
    if (size<60) break;
    if (s>=size){
      const v=s/size, r=Math.round(v*10)/10;
      const frac=r-Math.floor(r);
      const word=(r===1?sing:plur);
      const n=(r%1===0)?r.toFixed(0):r.toFixed(1);
      const lead = frac>0.05 && frac<0.35 ? 'just over ' : (frac>0.65 ? 'nearly ' : 'about ');
      return lead+n+' '+word;
    }
  }
  return 'about '+(s/60).toFixed(0)+' minutes';
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
  if(k==='moon') return moon ? { key:'moon', center:moon.mesh.getWorldPosition(new THREE.Vector3()), sceneR:0.095 } : null;
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
  // Keep the corner details card clear of a Warp-tempo card docked into the Scene (left) panel —
  // lift it to rest just above the docked card so the two never overlap (tracks its live height).
  dnHudEl.style.bottom = (dnTempoDock==='left' && dnTempoEl && dnTempoEl.offsetParent)
    ? (64 + dnTempoEl.offsetHeight + 10) + 'px' : '';
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
  // Moon — its own dedicated purple identifier thumbtack (clickable → flies to the
  // Moon; NAVLINQ-selectable). A distinct lavender (vs. the planets' indigo body
  // pins and the Sun's amber) so the Moon reads as its own marker beside Earth.
  if (moon) dnAddPin(moon.mesh, new THREE.Vector3(0,0.09*2.0,0), { kind:'body', key:'moon', name:'Moon', standoff:0.7 }, '#b388ff');
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
function dnFlyTo(destWorld, standoff, name, tag){
  // A fly-to some other destination supersedes an engaged midpoint toggle.
  if ((tag||null)!=='navmid' && navFlyEngaged){ navFlyEngaged=false; navUpdateFlyBtn(); }
  const dir=_dnV.copy(camera.position).sub(destWorld); if (dir.lengthSq()<1e-9) dir.set(0,0.4,1);
  dir.normalize();
  const end=destWorld.clone().add(dir.multiplyScalar(standoff));
  end.y += standoff*0.18;
  zoom3D.active=false;
  // Rich, realistic travel. The smootherstep ease-in-out below gives a natural
  // accelerate → cruise → decelerate arc (a first-/third-person journey rather
  // than a teleport), and the trip DURATION scales gently with how far we're
  // going — a hop to the Moon lands quickly; a cross-system leap takes longer —
  // clamped to a comfortable cinematic band (≈1.1–5.0 s) and still modulated by
  // the time-tempo slider so the pace stays "rich" for the user.
  const travel = camera.position.distanceTo(end);
  const tempoK = 0.7 + dnTempoFrac*0.8;                       // slider pace: 0.7×…1.5×
  const dur = Math.max(1.1, Math.min(5.0, (0.9 + Math.log10(1+travel)*1.4) * tempoK));
  // Arriving PARKS the camera on the destination: the cinematic auto-director
  // yields immediately and stays yielded until the user presses Auto/Focus, so
  // the POV holds right at the object and never "bounces back" on its own.
  cineParked = true; cineLastInput = performance.now();
  dnFlight={ active:true, t:0, dur, tag:tag||null,
    p0:camera.position.clone(), t0:orbit.target.clone(), p1:end, t1:destWorld.clone() };
  if (name) toast('→ '+name+' · rich travel · '+dur.toFixed(1)+'s');
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
  if (dnFlight.t>=1){
    dnFlight.active=false;
    // Arrived: release the toggle so a further click flies to the midpoint again.
    if (dnFlight.tag==='navmid'){ navFlyEngaged=false; navUpdateFlyBtn(); }
  }
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
  // ---- Apple-esque dock / undock: drag the Warp-tempo card by its grip into
  // one of the three pop-up cards (Scene · Inspector · Time) to INTEGRATE it,
  // or drag it back out to SEGREGATE it, with a smooth FLIP transition. The
  // free position and the dock choice both persist on-device. ----
  const TKEY='ewiCosmosDN_tempo';
  const grip=dnTempoEl.querySelector('.dn-grip');
  const DOCK_HOST={ left:'.st-left', right:'.st-right', time:'.st-time' };
  const DOCK_NAME={ left:'Scene', right:'Inspector', time:'Time' };
  const _dnClearHostFlags=()=>{ ['.st-left','.st-right'].forEach(s=>{ const el=root&&root.querySelector(s); if(el) el.classList.remove('dn-has-tempo'); }); };
  const _dnSetDockHint=(key)=>{ Object.values(DOCK_HOST).forEach(s=>{ const el=root&&root.querySelector(s); if(el) el.classList.remove('dn-dock-target'); });
    if(key){ const el=root&&root.querySelector(DOCK_HOST[key]); if(el) el.classList.add('dn-dock-target'); } };
  const _dnDropTargetAt=(x,y)=>{ const prev=dnTempoEl.style.pointerEvents; dnTempoEl.style.pointerEvents='none';
    let el=document.elementFromPoint(x,y); dnTempoEl.style.pointerEvents=prev; if(!el) return null;
    const host=el.closest('.st-left,.st-right,.st-time'); if(!host) return null;
    return host.classList.contains('st-left')?'left':host.classList.contains('st-right')?'right':'time'; };
  const _dnFlip=(el,mutate)=>{ if(_bhReduce()){ mutate(); return; }
    const first=el.getBoundingClientRect(); mutate(); const last=el.getBoundingClientRect();
    const dx=first.left-last.left, dy=first.top-last.top;
    const sx=last.width?first.width/last.width:1, sy=last.height?first.height/last.height:1;
    el.style.transformOrigin='top left'; el.style.transition='none';
    el.style.transform=`translate(${dx}px,${dy}px) scale(${sx},${sy})`;
    void el.getBoundingClientRect();
    el.style.transition='transform .34s cubic-bezier(.22,.61,.36,1)'; el.style.transform='';
    const done=()=>{ el.style.transition=''; el.style.transformOrigin=''; el.removeEventListener('transitionend',done); };
    el.addEventListener('transitionend',done); };
  const _dnPersist=()=>{ try{ localStorage.setItem(TKEY, JSON.stringify({ dock:dnTempoDock,
      x:parseFloat(dnTempoEl.style.left)||null, y:parseFloat(dnTempoEl.style.top)||null })); }catch(_){}; };
  function _dnDoDock(key, animate){
    const hostSel=DOCK_HOST[key]; const host=root&&root.querySelector(hostSel); if(!host) return;
    const apply=()=>{ _dnClearHostFlags();
      dnTempoEl.classList.add('dn-docked'); dnTempoEl.classList.toggle('dn-docked-time', key==='time');
      dnTempoEl.style.left=''; dnTempoEl.style.top=''; dnTempoEl.style.bottom=''; dnTempoEl.style.transform='';
      if(key!=='time') host.classList.add('dn-has-tempo');
      host.appendChild(dnTempoEl); };
    if(animate===false) apply(); else _dnFlip(dnTempoEl, apply);
    dnTempoDock=key; _dnPersist(); dnUpdateHUD();   // lift the corner details card clear at once
  }
  function _dnUndock(){ if(!dnTempoDock) return; const r=dnTempoEl.getBoundingClientRect();
    _dnClearHostFlags(); root.appendChild(dnTempoEl);
    dnTempoEl.classList.remove('dn-docked','dn-docked-time');
    dnTempoEl.style.transform='none'; dnTempoEl.style.bottom='auto';
    dnTempoEl.style.left=r.left+'px'; dnTempoEl.style.top=r.top+'px'; dnTempoDock=null; dnUpdateHUD(); }
  // restore saved dock / position
  try{ const st=JSON.parse(localStorage.getItem(TKEY)||'{}');
    if(st.dock && DOCK_HOST[st.dock]){ _dnDoDock(st.dock, false); }
    else if(st.x!=null){ dnTempoEl.style.left=st.x+'px'; dnTempoEl.style.top=st.y+'px'; dnTempoEl.style.bottom='auto'; dnTempoEl.style.transform='none'; }
  }catch(_){}
  let gx=0,gy=0,gdrag=false,gcand=null;
  grip.addEventListener('pointerdown',e=>{ gdrag=true; gcand=null;
    if(dnTempoDock) _dnUndock();                                     // segregate in place — no visual jump
    const r=dnTempoEl.getBoundingClientRect();
    dnTempoEl.style.transform='none'; dnTempoEl.style.bottom='auto'; dnTempoEl.style.left=r.left+'px'; dnTempoEl.style.top=r.top+'px';
    dnTempoEl.classList.add('dn-dragging');
    gx=e.clientX-r.left; gy=e.clientY-r.top; grip.style.cursor='grabbing'; try{grip.setPointerCapture(e.pointerId);}catch(_){}; e.preventDefault(); });
  grip.addEventListener('pointermove',e=>{ if(!gdrag) return; const w=window.innerWidth,h=window.innerHeight;
    const nx=Math.max(4,Math.min(w-dnTempoEl.offsetWidth-4,e.clientX-gx)), ny=Math.max(56,Math.min(h-40,e.clientY-gy));
    dnTempoEl.style.left=nx+'px'; dnTempoEl.style.top=ny+'px';
    gcand=_dnDropTargetAt(e.clientX,e.clientY); _dnSetDockHint(gcand); });
  grip.addEventListener('pointerup',e=>{ if(!gdrag) return; gdrag=false; grip.style.cursor='grab';
    dnTempoEl.classList.remove('dn-dragging'); _dnSetDockHint(null); try{grip.releasePointerCapture(e.pointerId);}catch(_){}
    if(gcand){ _dnDoDock(gcand, true); toast('Warp tempo docked into the '+DOCK_NAME[gcand]+' card — drag its ⠿ grip to pull it back out'); }
    else _dnPersist();
    gcand=null; });
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
  get navFlyEngaged(){ return navFlyEngaged; }, fmtDurTech:(s)=>fmtDurTech(s), fmtDurLay:(s)=>fmtDurLay(s),
  setPanMode:(on)=>setPanMode(on), get panMode(){ return panMode; },
  alignViewPlane:(p)=>alignViewPlane(p), get viewPlane(){ return viewPlane; }, get viewPlaneSide(){ return viewPlaneSide; },
  __tick:(dt)=>{ try{ deepNavTick(dt||0.016); orbit.update(); }catch(_){} },   // deterministic frame advance for automated validation (RAF-independent)
  get camDist(){ return camera ? +camera.position.distanceTo(orbit.target).toFixed(6) : null; },
  get camOffset(){ if(!camera) return null; const o=camera.position.clone().sub(orbit.target); return { x:+o.x.toFixed(6), y:+o.y.toFixed(6), z:+o.z.toFixed(6) }; },
  get navSelection(){ return [...navSel]; }, get realtime(){ return realtime; },
  get navMidpoint(){ const R=navComputeMidpoints(); if(!R) return null;
    return { count:R.nodes.length, interstellar:R.anyStar, scale:R.phys.scale,
      lon:+R.phys.lon.toFixed(3), lat:+R.phys.lat.toFixed(3), r:+R.phys.r.toFixed(5),
      span:+R.phys.span.toFixed(5), dominant:R.dom.name,
      offset:R.anyStar?null:+((R.phys.offKm)||0).toFixed(1) }; },
  get navTravel(){ const R=navComputeMidpoints(); if(!R||R.anyStar) return null; const T=navTravelCompute(R); if(!T) return null;
    return { count:T.rows.length, TspaceK:+T.Tspace.toFixed(1), rBaryAU:+T.rBary.toFixed(5), maxLightS:+T.maxLight.toFixed(1),
      rows:T.rows.map(r=>({ name:r.name, g:+r.g.toFixed(3), vescKms:+r.vesc.toFixed(3), epsMJ:+(r.eps/1e6).toFixed(2), fuelPct:+(r.propFrac*100).toFixed(2), distKm:+r.dkm.toFixed(0), tCruiseS:+r.tCruise.toFixed(1), launchOffsetS:+r.launchOffset.toFixed(1), tLightS:+r.tLight.toFixed(2), TsurfK:r.T })) }; },
  get imported(){return imported;},
  get cameraDistance(){ return (camera && orbit) ? camera.position.distanceTo(orbit.target) : null; },
  // deep-nav test hooks
  dnPanel:(id)=>dnPanel(id), dnParseZoom:(s)=>dnParseZoom(s), dnTogglePins:()=>dnTogglePins(),
  dnFlyToKey:(k)=>dnFlyToBodyKey(k), get dnFocus(){ return dnNearestBody()?.key||null; },
  get dnPinCount(){ return dnPins.length; }, get dnFlying(){ return !!(dnFlight&&dnFlight.active); },
  get dnTempoDock(){ return dnTempoDock; },
  // Sun's End (stellar-death cinematic) hooks
  novaToggle:()=>novaToggle(), novaEnter:()=>novaEnter(), novaExit:()=>novaExit(),
  novaSeek:(f)=>novaSeek(f), novaPlay:()=>novaTogglePlay(), novaReplay:()=>novaReplay(),
  get novaOn(){ return novaOn; }, get novaPlaying(){ return novaPlaying; },
  get novaFrac(){ return +(_nvClamp(novaT/NOVA_DUR,0,1)).toFixed(4); },
  get novaSunScale(){ return sun ? +sun.scale.x.toFixed(4) : null; },
  get novaReach(){ return +novaReach(_nvClamp(novaT/NOVA_DUR,0,1)).toFixed(3); },
  get novaVisiblePlanets(){ return PLANETS.filter(p=>planetMeshes[p.key]&&planetMeshes[p.key].group.visible).map(p=>p.key); },
  // Event Cinema hooks
  ecEnter:(i)=>ecEnter(i), ecExit:()=>ecExit(), ecStep:(d)=>ecStep(d), ecSeek:(f)=>ecSeek(f),
  ecPlay:()=>ecTogglePlay(), ecReplay:()=>ecReplay(), ecFocus:()=>ecToggleFocus(),
  get ecOn(){ return ecOn; }, get ecPlaying(){ return ecPlaying; }, get ecIndex(){ return ecIndex; },
  get ecFrac(){ return +(_nvClamp(ecT/EC_DUR,0,1)).toFixed(4); }, get ecFocusKey(){ return ecFocusKey; },
  ecTick:(dt)=>{ try{ ecTick(dt||0.016); }catch(_){} },
  // Cinematic playlist + dwell hooks
  get cineDwellSec(){ return cineDwellSec; }, setCineDwell:(s)=>{ cineDwellSec=Math.min(86400,Math.max(1,+s||1)); cineSavePrefs(); cineSyncDwellUI(); },
  get cinePlaylist(){ return (cineEnsurePlaylist()||[]).map(it=>({id:it.id,on:it.on})); },
  cineEnabledSeq:()=>cineEnabledSeq(), cinePlMove:(i,d)=>cinePlMove(i,d), cineAuto:()=>cineAuto(),
  cineTick:(dt)=>{ try{ tickCinematic(dt||0.016); }catch(_){} }, get cineFocusKey(){ return cineFocusKey; },
  get cineSunSafe(){ return cineSunSafe; }, setCineView:(f)=>cineToggleView(f),
  get cineListKey(){ return cineListKey; }, cineSyncList:()=>cineSyncList(),
  // Layout / immersive / mobile-zoom hooks
  panelShow:(side,show)=>panelShow(side,show), panelToggle:(side)=>panelToggle(side),
  get panelLeftHidden(){ return !!root && root.querySelector('.st-left').classList.contains('st-hidden'); },
  get panelRightHidden(){ return !!root && root.querySelector('.st-right').classList.contains('st-hidden'); },
  immersive:(f)=>toggleImmersive(f), get immersiveOn(){ return !!root && root.classList.contains('immersive'); },
  timeDock:(c)=>timeDockSet(c), timeDockToggle:()=>timeDockToggle(), get timeCollapsed(){ return !!root && root.classList.contains('time-collapsed'); },
  pinchZoom:(ratio)=>{ const curR=camera.position.distanceTo(orbit.target); const base=zoom3D.active?zoom3D.targetR:curR;
    zoom3D.targetR=Math.max(orbit.minDistance,Math.min(orbit.maxDistance, base*Math.max(0.5,Math.min(2,ratio||1)))); zoom3D.active=true; },
  get dnFlightActive(){ return !!dnFlightSim; }, get dnWorldSlow(){ return dnWorldSlow; }, get airportCount(){ return Object.keys(AIRPORTS).length; },
  // Black-hole (accretion / infall) hooks — RAF-independent validation of total consumption
  bhOpenForm:()=>bhOpenForm(), bhLockIn:()=>bhLockIn(),
  bhReplay:()=>bhCineReplay(), bhSetStar:(id)=>bhCineSetStar(id), get bhCineStar(){ return bhCineStar; }, get bhCineOn(){ return bhCineOn; },
  get bhCount(){ return blackHoles.length; }, get bhSimOn(){ return bhSimOn; },
  get bhBodiesAlive(){ return bhBodies.filter(b=>b.alive).length; }, get bhBodiesTotal(){ return bhBodies.length; },
  get bhBeltAliveCount(){ return bhBeltAlive ? bhBeltAlive.reduce((a,v)=>a+(v?1:0),0) : 0; },
  get bhBeltTotal(){ return bhBeltAlive ? bhBeltAlive.length : 0; },
  get bhSunDrain(){ return +bhSunDrain.toFixed(4); },
  bhTick:(dt)=>{ try{ bhIntegrate(dt||0.016); bhRenderTick(dt||0.016); bhStellarTick(dt||0.016); }catch(_){} } };
