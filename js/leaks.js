import * as THREE from 'three';
import { goToView } from './controls.js';

/* ═══════════════════════════════════════════════════════════════════════════
   leaks.js  —  Sistema de simulación de fugas con escena de emergencia 3D
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── Estado del módulo ────────────────────────────────────────────────────────
let scene;
let leakMarker, puddle, rippleRing;
let isLeakActive  = false;
let alertTimeout;
let autoResolveTimeout;
let baseLeakSize  = 1;
let activeLeakPos = null;
let leakStartTime = null;
let totalLeaks    = 0;
let leakHistory   = [];

let emergencyGroup = null;
let particles      = [];
let steamPuffs     = [];
let workers        = [];
let warningLight   = null;
let extraRipples   = [];
let brokenPipe     = null;

// ─── Puntos de fuga + dirección segura ───────────────────────────────────────
//
//  Cada punto lleva un campo `safe`: la dirección (en el plano XZ) donde HAY
//  espacio libre para estacionar la camioneta y colocar trabajadores sin que
//  choquen con cabañas ni con la casa principal.
//
//  Layout de referencia:
//    Cabañas fila norte  Z ≈  4,  X = -12, -5, +2, +9
//    Cabañas fila sur    Z ≈ 13,  X = -12, -5, +2, +9
//    Casa principal      Z ≈ -20, X ≈ 0
//    Planta              X ≈ 18
//    Calle (espacio libre) Z ≈ -6
//
// Zonas de exclusion — AABBs de todos los edificios (margen 1.5u)
const EXCLUSION_ZONES = [
  { minX: -13.5, maxX:  -3.5, minZ: -21.5, maxZ: -11.5 }, // Casa central distribución (-8,-16)
  // Fila Este de cabañas (X=9)
  { minX:   6.5, maxX:  11.5, minZ:  -6.5,  maxZ:  -1.0 }, // E1 (9,-4)
  { minX:   6.5, maxX:  11.5, minZ:   2.5,  maxZ:   7.5 }, // E2 (9,5)
  { minX:   6.5, maxX:  11.5, minZ:  11.5,  maxZ:  16.5 }, // E3 (9,14)
  { minX:   6.5, maxX:  11.5, minZ:  20.5,  maxZ:  25.5 }, // E4 (9,23)
  // Fila Oeste de cabañas (X=0)
  { minX:  -2.5, maxX:   2.5, minZ:  -6.5,  maxZ:  -1.0 }, // W1 (0,-4)
  { minX:  -2.5, maxX:   2.5, minZ:   2.5,  maxZ:   7.5 }, // W2 (0,5)
  { minX:  -2.5, maxX:   2.5, minZ:  11.5,  maxZ:  16.5 }, // W3 (0,14)
  { minX:  -2.5, maxX:   2.5, minZ:  20.5,  maxZ:  25.5 }, // W4 (0,23)
  { minX:  16.0, maxX:  25.0, minZ: -14.0,  maxZ:  -5.5 }, // Planta desalinizadora
  { minX: -29.0, maxX: -18.0, minZ:  -8.0,  maxZ:  12.0 }, // Parking + baños
];

function _isInsideBuilding(wx, wz) {
  return EXCLUSION_ZONES.some(z =>
    wx >= z.minX && wx <= z.maxX && wz >= z.minZ && wz <= z.maxZ
  );
}

function _safeDirFor(pos) {
  const candidates = [];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    let score = 0;
    [3, 5, 7].forEach(dist => {
      if (!_isInsideBuilding(pos.x + dx * dist, pos.z + dz * dist)) score += dist;
    });
    candidates.push({ dx, dz, score });
  }
  const best = candidates.reduce((a, b) => a.score > b.score ? a : b);
  return new THREE.Vector3(best.dx, 0, best.dz);
}

const pipePoints = [
  // Colector camino central Z=-6
  { name: 'Colector Principal',        sensor: 'SW-01', pos: new THREE.Vector3(-7,  0.28, -6),  safe: new THREE.Vector3( 0, 0,  1) },
  { name: 'Ramal Central Norte',       sensor: 'SW-02', pos: new THREE.Vector3( 0,  0.28, -6),  safe: new THREE.Vector3( 0, 0,  1) },
  { name: 'Ramal Este Entrada',        sensor: 'SW-03', pos: new THREE.Vector3( 7,  0.28, -6),  safe: new THREE.Vector3( 0, 0,  1) },
  // Ramales cabanas noroeste
  { name: 'Cabaña A1 — Noroeste',      sensor: 'SW-04', pos: new THREE.Vector3(-13, 0.28,  3),  safe: new THREE.Vector3( 1, 0, -1).normalize() },
  { name: 'Cabaña A2 — Noroeste',      sensor: 'SW-05', pos: new THREE.Vector3( -7, 0.28,  0),  safe: new THREE.Vector3( 0, 0, -1) },
  { name: 'Cabaña A3 — Noroeste',      sensor: 'SW-06', pos: new THREE.Vector3( -8, 0.28,  8),  safe: new THREE.Vector3( 1, 0, -1).normalize() },
  // Ramales cabanas centrales
  { name: 'Cabaña B1 — Sector Central',sensor: 'SW-07', pos: new THREE.Vector3(  0, 0.28,  4),  safe: new THREE.Vector3( 0, 0, -1) },
  { name: 'Cabaña B2 — Sector Central',sensor: 'SW-08', pos: new THREE.Vector3(  1, 0.28, 11),  safe: new THREE.Vector3( 0, 0, -1) },
  // Ramales cabanas este
  { name: 'Cabaña C1 — Sector Este',   sensor: 'SW-09', pos: new THREE.Vector3(  8, 0.28,  2),  safe: new THREE.Vector3( 1, 0, -1).normalize() },
  { name: 'Cabaña C2 — Sector Este',   sensor: 'SW-10', pos: new THREE.Vector3(  7, 0.28,  9),  safe: new THREE.Vector3( 1, 0, -1).normalize() },
  // Tuberia casa principal
  { name: 'Casa Central Distribución', sensor: 'SW-11', pos: new THREE.Vector3(  0, 0.28, -16), safe: new THREE.Vector3( 1, 0,  0) },
];

// ─── Tipos de fuga ────────────────────────────────────────────────────────────
const LEAK_TYPES = [
  { label: 'Goteo Leve',     size: 0.5, color: 0xffaa00, resolveMs: 15000, particles: 8,  steam: 3,  pipeColor: 0x336699, litersPerSec: 2  },
  { label: 'Fisura Media',   size: 1.0, color: 0xff5500, resolveMs: 10000, particles: 20, steam: 6,  pipeColor: 0x225588, litersPerSec: 8  },
  { label: 'Rotura Crítica', size: 1.5, color: 0xff0000, resolveMs:  6000, particles: 35, steam: 10, pipeColor: 0x113366, litersPerSec: 22 },
];

// Estado adicional
let litersLost         = 0;
let litersInterval     = null;
let activeLitersPerSec = 0;
let activeLeakType     = null;   // tipo activo para paneles
let activeLeakPoint    = null;   // punto activo (con nombre y sensor)
let brigadeInterval    = null;   // cuenta regresiva de brigada
let leaksByType        = { leve: 0, media: 0, critica: 0 };  // conteo por tipo
let totalLitersSession = 0;      // litros acumulados de toda la sesión
let responseScores     = [];     // puntuaciones de tiempo de respuesta
let _beaconAngle       = 0;      // ángulo de la baliza giratoria

// ─── NUEVAS MEJORAS: estado ───────────────────────────────────────────────────
// Sensor nodes 3D
let _sensorNodes     = [];       // {group, ring, dot, idx, phase}
let _activeSensorIdx = -1;       // índice del sensor con fuga activa

// Camión animado en ruta
let _routeTrucks     = [];       // [{mesh, startPos, targetPos, progress, speed, arrived}]

// Web Audio
let _audioCtx        = null;
let _audioNodes      = [];       // refs a osciladores activos
let _alarmIntervalId = null;     // ID del setInterval de patrones de beep

// Auto-mode
let _autoModeInterval = null;
export let autoModeActive = false;

// SCADA
let _scadaLitersInterval = null;

// ─── Materiales ───────────────────────────────────────────────────────────────
const MAT = {};
function _buildMaterials() {
  const m = (color, opts = {}) => new THREE.MeshBasicMaterial({ color, ...opts });
  MAT.alert      = m(0xff0000, { transparent: true, opacity: 0.85 });
  MAT.puddle     = m(0x1a4a66, { transparent: true, opacity: 0.65 });
  MAT.ripple     = m(0x55aadd, { transparent: true, opacity: 0.40, side: THREE.DoubleSide });
  MAT.wetFloor   = m(0x112233, { transparent: true, opacity: 0.50 });
  MAT.water      = m(0x44aaee, { transparent: true, opacity: 0.82 });
  MAT.steam      = m(0xaaccdd, { transparent: true, opacity: 0.00 });
  MAT.pipeBlue   = m(0x2266aa);
  MAT.pipeDark   = m(0x0a1f3a);
  MAT.crackEdge  = m(0x001133);
  MAT.rust       = m(0x663322);
  MAT.dirt       = m(0x7a5c3a);
  MAT.dirtDark   = m(0x5a3e22);
  MAT.asphaltCrk = m(0x222222);
  MAT.wetAsphalt = m(0x112233, { transparent: true, opacity: 0.50 });
  MAT.coneOrg    = m(0xff6600);
  MAT.coneWht    = m(0xffffff);
  MAT.coneBase   = m(0x1a1a1a);
  MAT.barrierRed = m(0xdd2200, { transparent: true, opacity: 0.80 });
  MAT.barrierYel = m(0xffdd00);
  MAT.helmet     = m(0xffcc00);
  MAT.helmetRed  = m(0xdd2200);
  MAT.skin       = m(0xf0c89a);
  MAT.vest       = m(0xff8800);
  MAT.vestBlue   = m(0x2244aa);
  MAT.pants      = m(0x334466);
  MAT.boots      = m(0x221100);
  MAT.tool       = m(0x888888);
  MAT.toolDark   = m(0x555555);
  MAT.truckBody  = m(0xdd8800);
  MAT.truckCab   = m(0xeeaa00);
  MAT.truckWheel = m(0x222222);
  MAT.glass      = m(0x99ccee, { transparent: true, opacity: 0.60 });
  MAT.lightYel   = m(0xffff88);
  MAT.beaconRed  = m(0xff1100, { transparent: true, opacity: 0.92 });
  MAT.beaconGlass= m(0xff4422, { transparent: true, opacity: 0.55 });
  MAT.sensorOk   = m(0x00ff88, { transparent: true, opacity: 0.85 });
  MAT.sensorWarn = m(0xffaa00, { transparent: true, opacity: 0.9 });
  MAT.sensorCrit = m(0xff0022, { transparent: true, opacity: 0.9 });
  MAT.sensorAntenna = m(0x556677);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
export function initLeaks(s) {
  scene = s;
  _buildMaterials();

  leakMarker = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 24), MAT.alert);
  leakMarker.visible = false;
  scene.add(leakMarker);

  puddle = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), MAT.puddle.clone());
  puddle.rotation.x = -Math.PI / 2;
  puddle.visible = false;
  scene.add(puddle);

  rippleRing = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.1, 32), MAT.ripple.clone());
  rippleRing.rotation.x = -Math.PI / 2;
  rippleRing.visible = false;
  scene.add(rippleRing);

  _injectHistoryPanel();
  _injectTimerBadge();
  _injectLitersCounter();
  _injectSessionStats();
  _injectSmartWaterPanel();
  _injectBrigadePanel();
  _injectScorePanel();
  _buildSensorNodes();
  _injectSCADAPanel();
  _injectAutoModeToggle();
}

// ─── Activar / desactivar fuga ────────────────────────────────────────────────
export function simulateLeak() {
  isLeakActive = !isLeakActive;

  const htmlAlert    = document.getElementById('alerta-fuga');
  const sonidoAlerta = document.getElementById('sonido-alerta');
  const btnFuga      = document.getElementById('btn-fuga');

  if (isLeakActive) {
    const point = pipePoints[Math.floor(Math.random() * pipePoints.length)];
    const type  = LEAK_TYPES[Math.floor(Math.random() * LEAK_TYPES.length)];
    const pos   = point.pos;
    const safe  = point.safe;   // ← dirección libre del espacio

    activeLeakPos  = pos;
    activeLeakType = type;
    activeLeakPoint= point;
    baseLeakSize   = type.size;
    leakStartTime  = performance.now();
    totalLeaks++;
    // Conteo por tipo
    if (type.size < 1)        leaksByType.leve++;
    else if (type.size < 1.5) leaksByType.media++;
    else                      leaksByType.critica++;

    MAT.alert.color.setHex(type.color);
    leakMarker.scale.setScalar(baseLeakSize);
    leakMarker.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0));
    leakMarker.visible = true;

    // Señal global para que scene.js detenga la animación del flujo
    window._leakActive   = true;
    window._leakSize     = type.size;   // MEJORA 11: scene.js lo usa para el contador de litros
    window._pressureDrop = true;

    puddle.material.color.setHex(0x1a4a66);
    puddle.scale.setScalar(0.05);
    puddle.position.copy(pos).add(new THREE.Vector3(0, -0.26, 0));
    puddle.visible = true;

    rippleRing.scale.setScalar(0.1);
    rippleRing.position.copy(pos).add(new THREE.Vector3(0, -0.25, 0));
    rippleRing.visible = true;

    _buildEmergencyScene(pos, safe, type);

    // ── NUEVAS MEJORAS: activar sensor 3D, sonido, SCADA ─────────────────────
    _activateSensorAtIndex(pipePoints.indexOf(point));
    _playAlarmSynth(type);
    _updateSCADAAlarm(point, type);

    htmlAlert.classList.remove('esquina', 'resuelto');
    htmlAlert.style.opacity = '';
    htmlAlert.style.display = 'block';
    document.getElementById('tipo-fuga').innerText =
      `${type.label} · ${point.name}`;
    // Colorear alerta según gravedad
    const htmlAlertEl = document.getElementById('alerta-fuga');
    htmlAlertEl.style.borderColor = `#${type.color.toString(16).padStart(6,'0')}`;
    // Mostrar estimación de pérdida
    const lossEl = document.getElementById('alert-loss-estimate');
    if (lossEl) lossEl.textContent = `Est. pérdida: ${type.litersPerSec} L/s`;

    sonidoAlerta.play().catch(() => {});
    // Silenciar el audio HTML para no superponer con el sintetizador Web Audio
    sonidoAlerta.volume = 0;
    window._pressureDrop = true;
    window._leakActive   = true;
    activeLitersPerSec = type.litersPerSec;
    litersLost = 0;
    _startLitersCounter(type.litersPerSec);

    clearTimeout(alertTimeout);
    alertTimeout = setTimeout(() => htmlAlert.classList.add('esquina'), 2500);

    clearTimeout(autoResolveTimeout);
    autoResolveTimeout = setTimeout(() => { if (isLeakActive) _autoResolve(); }, type.resolveMs);

    btnFuga.classList.add('fuga-activa');
    const _fl = btnFuga.querySelector('.sb-label');
    if (_fl) _fl.textContent = 'Detener Simulación';
    else btnFuga.innerHTML = '<span class="cam-icon">🛑</span> Detener Simulación';

    // Paneles nuevos
    _showSmartWaterPanel(point, type);
    _startBrigadeCountdown(type);

    // Cámara desde el lado seguro para ver la escena limpiamente
    const camDir = safe.clone().multiplyScalar(8).add(new THREE.Vector3(0, 6, 0));
    goToView('custom', pos, pos.clone().add(camDir));
    _startTimer();

  } else {
    _deactivateLeak(false);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   CONSTRUCTOR DE ESCENA DE EMERGENCIA
   Todos los objetos se posicionan usando `safe` como eje de referencia,
   así nunca invaden las cabañas que están en la dirección opuesta.
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildEmergencyScene(pos, safe, type) {
  _destroyEmergencyScene();

  emergencyGroup = new THREE.Group();
  emergencyGroup.position.copy(pos);
  scene.add(emergencyGroup);

  // Vector perpendicular a `safe` en el plano XZ (para flanquear la escena)
  const perp = new THREE.Vector3(-safe.z, 0, safe.x).normalize();

  // ── 1. Hoyo + tubo roto ───────────────────────────────────────────────────
  _makeExcavationPit(type);
  _makeBrokenPipe(type);

  // ── 2. Asfalto mojado ─────────────────────────────────────────────────────
  const wet = new THREE.Mesh(
    new THREE.PlaneGeometry(7 + type.size * 2, 6 + type.size * 2),
    MAT.wetAsphalt.clone()
  );
  wet.rotation.x = -Math.PI / 2;
  wet.position.y = -0.26;
  emergencyGroup.add(wet);

  // ── 3. Conos — en las 4 esquinas del perímetro de la barrera ─────────────
  // Usamos safe y perp para que los conos estén SIEMPRE en espacio abierto
  const R = 3.2;
  [
    safe.clone().multiplyScalar(R).add(perp.clone().multiplyScalar( R)),
    safe.clone().multiplyScalar(R).add(perp.clone().multiplyScalar(-R)),
    safe.clone().multiplyScalar(-R).add(perp.clone().multiplyScalar( R)),
    safe.clone().multiplyScalar(-R).add(perp.clone().multiplyScalar(-R)),
  ].forEach(offset => {
    const cone = _makeCone();
    cone.position.copy(offset);
    cone.position.y = 0;
    cone.rotation.y = Math.random() * 0.5 - 0.25;
    emergencyGroup.add(cone);
  });

  // ── 4. Barrera ────────────────────────────────────────────────────────────
  _makeBarrier(emergencyGroup, safe, perp, 3.2);

  // ── 5 & 6. Camioneta(s) — llegan animadas desde la carretera ────────────────
  const truckTargetPos = pos.clone().add(
    safe.clone().multiplyScalar(5.5).add(perp.clone().multiplyScalar(1.2))
  );
  truckTargetPos.y = 0;
  _spawnRouteTruck(truckTargetPos, false);

  if (type.size >= 1.5) {
    const truck2Target = pos.clone().add(
      safe.clone().multiplyScalar(6.0).add(perp.clone().multiplyScalar(-2.0))
    );
    truck2Target.y = 0;
    setTimeout(() => { if (isLeakActive) _spawnRouteTruck(truck2Target, true); }, 1800);
  }

  // ── 7. Partículas, vapor, ripples, luz ────────────────────────────────────
  _spawnWaterParticles(type.particles);
  _spawnSteam(type.steam);

  extraRipples = [];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.6, 24),
      new THREE.MeshBasicMaterial({ color: 0x55aadd, transparent: true, opacity: 0.25, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.24;
    emergencyGroup.add(ring);
    extraRipples.push({ mesh: ring, offset: i * 1.1 });
  }

  warningLight = new THREE.PointLight(0xff2200, 0, 10);
  warningLight.position.set(0, 2.5, 0);
  emergencyGroup.add(warningLight);

  // ── 8. Trabajadores — distribuidos en el arco del lado seguro ────────────
  workers = [];
  const workerCount = type.size < 1 ? 2 : 3;
  for (let i = 0; i < workerCount; i++) {
    const isForeman = (i === 0 && type.size >= 1.5);
    const w = _makeWorker(i, isForeman);

    // Arco de 120° centrado en la dirección `safe`
    // así los trabajadores siempre están del lado de la calle, nunca adentro de una cabaña
    const arcAngle = (i / (workerCount - 1 || 1) - 0.5) * (Math.PI * 0.7);
    const wDir = _rotateY(safe.clone(), arcAngle);
    const radius = 1.7 + Math.random() * 0.5;
    w.group.position.copy(wDir.multiplyScalar(radius));
    w.group.position.y = 0;

    // Mirar hacia el centro del hoyo
    w.group.lookAt(new THREE.Vector3(0, 0, 0));
    // Inclinar levemente hacia adelante (trabajando)
    w.group.rotation.x = 0.18;

    emergencyGroup.add(w.group);
    workers.push({ ...w, phase: i * 1.3 });
  }
}

// ─── Utilidad: rotar un Vector3 en Y ─────────────────────────────────────────
function _rotateY(v, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return new THREE.Vector3(
    v.x * cos + v.z * sin,
    0,
    -v.x * sin + v.z * cos
  );
}

// ─── Hoyo de excavación ───────────────────────────────────────────────────────
function _makeExcavationPit(type) {
  const w = 1.4 + type.size * 0.4;
  const d = 0.9 + type.size * 0.2;
  const depth = 0.55;

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MAT.dirtDark.clone());
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -depth;
  emergencyGroup.add(floor);

  [
    { pos: [0, -depth/2, -d/2], rot: [0, 0, 0],          size: [w, depth] },
    { pos: [0, -depth/2,  d/2], rot: [0, Math.PI, 0],    size: [w, depth] },
    { pos: [-w/2, -depth/2, 0], rot: [0, Math.PI/2, 0],  size: [d, depth] },
    { pos: [ w/2, -depth/2, 0], rot: [0, -Math.PI/2, 0], size: [d, depth] },
  ].forEach(({ pos, rot, size }) => {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(...size), MAT.dirt.clone());
    wall.position.set(...pos);
    wall.rotation.set(...rot);
    emergencyGroup.add(wall);
  });

  // Montones de tierra a los lados del hoyo (en X, nunca en Z donde están las cabañas)
  [[-w/2 - 0.5, 0.1, 0], [w/2 + 0.5, 0.05, 0.2]].forEach(([px, py, pz]) => {
    const pile = new THREE.Mesh(
      new THREE.ConeGeometry(0.5 + Math.random() * 0.15, 0.25, 7),
      MAT.dirt.clone()
    );
    pile.position.set(px, py, pz);
    pile.rotation.y = Math.random() * Math.PI;
    emergencyGroup.add(pile);
  });

  // Borde de asfalto roto
  [
    { pos: [0, 0, -d/2 - 0.07], size: [w + 0.3, 0.14] },
    { pos: [0, 0,  d/2 + 0.07], size: [w + 0.3, 0.14] },
    { pos: [-w/2 - 0.07, 0, 0], size: [0.14, d + 0.1] },
    { pos: [ w/2 + 0.07, 0, 0], size: [0.14, d + 0.1] },
  ].forEach(({ pos, size }) => {
    const edge = new THREE.Mesh(new THREE.PlaneGeometry(...size), MAT.asphaltCrk.clone());
    edge.rotation.x = -Math.PI / 2;
    edge.position.set(...pos);
    emergencyGroup.add(edge);
  });
}

// ─── Tubo HDPE roto ───────────────────────────────────────────────────────────
function _makeBrokenPipe(type) {
  const g      = new THREE.Group();
  g.position.y = -0.45;
  const r      = 0.18;
  const pMat   = new THREE.MeshBasicMaterial({ color: type.pipeColor });
  const dMat   = MAT.pipeDark.clone();

  const addCyl = (mat, rx, ry, rz, px, py, pz, rLen) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rLen, rLen, 1.2, 12), mat);
    mesh.rotation.set(rx, ry, rz);
    mesh.position.set(px, py, pz);
    g.add(mesh);
    return mesh;
  };

  addCyl(pMat,        0, 0, Math.PI/2, -0.70, 0,    0,    r);
  addCyl(dMat,        0, 0, Math.PI/2, -0.70, 0,    0,    r * 0.7);
  addCyl(pMat.clone(),0, 0, Math.PI/2,  0.70, 0.06, 0.05, r);
  addCyl(dMat.clone(),0, 0, Math.PI/2,  0.70, 0.06, 0.05, r * 0.7);

  // Bocas rotas (torus)
  [[-0.12, 0, 0], [0.15, 0.06, 0.05]].forEach(([px, py, pz]) => {
    const boca = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.035, 6, 12),
      MAT.crackEdge.clone()
    );
    boca.rotation.y = Math.PI / 2;
    boca.position.set(px, py, pz);
    g.add(boca);
  });

  // Mancha de óxido
  const rust = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), MAT.rust.clone());
  rust.scale.set(1, 0.3, 1);
  rust.position.set(0, 0.18, 0);
  g.add(rust);

  // Chorro animado
  const jet = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.08, 0.6, 8),
    new THREE.MeshBasicMaterial({ color: 0x55aaee, transparent: true, opacity: 0.70 })
  );
  jet.position.set(0, 0.35, 0);
  jet.name = 'waterJet';
  g.add(jet);

  emergencyGroup.add(g);
  brokenPipe = { group: g, jet };
}

// ─── Cono de señalización ─────────────────────────────────────────────────────
function _makeCone() {
  const g = new THREE.Group();
  const a = (geo, mat, py) => { const m = new THREE.Mesh(geo, mat); m.position.y = py; g.add(m); };
  a(new THREE.CylinderGeometry(0.24, 0.27, 0.06, 8), MAT.coneBase, 0.03);
  a(new THREE.CylinderGeometry(0.05, 0.21, 0.36, 8), MAT.coneOrg,  0.24);
  a(new THREE.CylinderGeometry(0.055,0.055, 0.06, 8), MAT.coneWht, 0.40);
  a(new THREE.CylinderGeometry(0.018,0.055, 0.24, 8), MAT.coneOrg, 0.56);
  a(new THREE.CylinderGeometry(0.006,0.018, 0.08, 8), MAT.coneWht, 0.72);
  return g;
}

// ─── Barrera (usa safe+perp para orientarse al espacio libre) ─────────────────
function _makeBarrier(parent, safe, perp, r) {
  const corners = [
    safe.clone().multiplyScalar(r).add(perp.clone().multiplyScalar( r)),
    safe.clone().multiplyScalar(r).add(perp.clone().multiplyScalar(-r)),
    safe.clone().multiplyScalar(-r).add(perp.clone().multiplyScalar(-r)),
    safe.clone().multiplyScalar(-r).add(perp.clone().multiplyScalar( r)),
  ].map(v => { v.y = 0; return v; });

  corners.forEach(c => {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 1.1, 6),
      MAT.barrierRed.clone()
    );
    pole.position.copy(c).add(new THREE.Vector3(0, 0.55, 0));
    parent.add(pole);
  });

  [[0,1],[1,2],[2,3],[3,0]].forEach(([a, b]) => {
    [0.5, 0.75].forEach(h => {
      const s = corners[a].clone().setY(h);
      const e = corners[b].clone().setY(h);
      const mid = s.clone().add(e).multiplyScalar(0.5);
      const len = s.distanceTo(e);
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, len, 4),
        MAT.barrierYel.clone()
      );
      band.position.copy(mid);
      band.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        e.clone().sub(s).normalize()
      );
      parent.add(band);
    });
  });
}

// ─── Camioneta ────────────────────────────────────────────────────────────────
function _makeTruck(isMaintenance = false) {
  const g    = new THREE.Group();
  const body = isMaintenance
    ? new THREE.MeshBasicMaterial({ color: 0x2255aa })
    : MAT.truckBody;
  const cab  = isMaintenance
    ? new THREE.MeshBasicMaterial({ color: 0x3366cc })
    : MAT.truckCab;

  const add = (geo, mat, px, py, pz, rx=0, ry=0, rz=0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.rotation.set(rx, ry, rz);
    g.add(m);
  };

  add(new THREE.BoxGeometry(1.8, 0.70, 1.00), body,  0,    0.65,  0);
  add(new THREE.BoxGeometry(1.0, 0.65, 0.95), cab,   0.70, 1.05,  0);
  add(new THREE.BoxGeometry(0.06,0.45, 0.75), MAT.glass, 1.18, 1.05, 0);
  [0.35, -0.35].forEach(z => {
    add(new THREE.BoxGeometry(0.06, 0.12, 0.18), MAT.lightYel, 1.22, 0.62, z);
  });
  // Ruedas — pegadas al suelo (y=0.28)
  [[ 0.55, 0.28,  0.58], [-0.55, 0.28,  0.58],
   [ 0.55, 0.28, -0.58], [-0.55, 0.28, -0.58]].forEach(([x, y, z]) => {
    add(new THREE.CylinderGeometry(0.28, 0.28, 0.22, 10), MAT.truckWheel, x, y, z, 0, 0, Math.PI/2);
  });
  // Barra de techo
  add(new THREE.BoxGeometry(0.8, 0.12, 0.15), MAT.barrierYel, 0.70, 1.42, 0);

  // ── Baliza giratoria en el techo ─────────────────────────────────────────
  const beaconBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.10, 0.12, 0.08, 8), MAT.truckWheel
  );
  beaconBase.position.set(0.70, 1.52, 0);
  g.add(beaconBase);
  const beaconDome = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    isMaintenance
      ? new THREE.MeshBasicMaterial({ color: 0x2266ff, transparent: true, opacity: 0.85 })
      : MAT.beaconGlass.clone()
  );
  beaconDome.position.set(0.70, 1.54, 0);
  beaconDome.name = 'beaconDome';
  g.add(beaconDome);
  // Brazo de luz giratoria (se anima en updateLeaks)
  const beaconArm = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.04, 0.04),
    isMaintenance
      ? new THREE.MeshBasicMaterial({ color: 0x4488ff })
      : MAT.beaconRed.clone()
  );
  beaconArm.position.set(0.70, 1.60, 0);
  beaconArm.name = 'beaconArm';
  g.add(beaconArm);

  return g;
}

// ─── Trabajador ───────────────────────────────────────────────────────────────
function _makeWorker(idx, isForeman = false) {
  const g   = new THREE.Group();
  const add = (geo, mat, px, py, pz, rx=0, ry=0, rz=0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(px, py, pz);
    mesh.rotation.set(rx, ry, rz);
    g.add(mesh);
    return mesh;
  };
  const hMat = isForeman ? MAT.helmetRed : MAT.helmet;
  const vMat = isForeman ? MAT.helmetRed : MAT.vest;

  // Botas
  [-0.09, 0.09].forEach(x => add(new THREE.BoxGeometry(0.12,0.10,0.16), MAT.boots, x, 0.05, 0.02));
  // Piernas
  add(new THREE.BoxGeometry(0.12,0.38,0.13), MAT.pants, -0.09, 0.29, 0);
  add(new THREE.BoxGeometry(0.12,0.38,0.13), MAT.pants,  0.09, 0.29, 0);
  // Torso + chaleco
  add(new THREE.BoxGeometry(0.30,0.36,0.18), MAT.vestBlue, 0, 0.67, 0);
  add(new THREE.BoxGeometry(0.32,0.34,0.10), vMat, 0, 0.67, 0.06);
  // Brazos (indices 5 y 6 para animar)
  const armL = add(new THREE.BoxGeometry(0.10,0.30,0.11), MAT.vestBlue, -0.22, 0.61, 0, 0, 0,  0.55);
  const armR = add(new THREE.BoxGeometry(0.10,0.30,0.11), MAT.vestBlue,  0.22, 0.61, 0, 0, 0, -0.55);
  // Manos
  add(new THREE.BoxGeometry(0.09,0.09,0.09), MAT.skin, -0.28, 0.46, 0);
  add(new THREE.BoxGeometry(0.09,0.09,0.09), MAT.skin,  0.28, 0.46, 0);
  // Cabeza
  add(new THREE.BoxGeometry(0.22,0.22,0.20), MAT.skin, 0, 1.01, 0);
  // Casco
  add(new THREE.CylinderGeometry(0.145,0.125,0.13,8), hMat, 0, 1.17, 0);
  add(new THREE.CylinderGeometry(0.185,0.185,0.035,8), hMat, 0, 1.10, 0);
  // Herramienta
  if (idx === 0) {
    add(new THREE.BoxGeometry(0.18,0.07,0.07), MAT.tool,  0.36, 0.48, 0.08, 0, 0, -0.3);
    add(new THREE.BoxGeometry(0.06,0.38,0.06), MAT.tool,  0.32, 0.48, 0.08, 0, 0, -0.3);
  } else if (idx === 1) {
    add(new THREE.BoxGeometry(0.06,0.60,0.06), MAT.toolDark, 0.32, 0.55, 0.10, 0, 0, -0.25);
    add(new THREE.BoxGeometry(0.16,0.20,0.04), MAT.tool,     0.36, 0.26, 0.10, 0, 0, -0.25);
  } else {
    // Tercer trabajador: tablet / walkie talkie
    add(new THREE.BoxGeometry(0.14,0.20,0.03), MAT.toolDark, -0.30, 0.62, 0.05, 0, 0, 0.4);
  }

  return { group: g, armL, armR };
}

// ─── Partículas de agua ───────────────────────────────────────────────────────
function _spawnWaterParticles(count) {
  particles = [];
  for (let i = 0; i < count; i++) {
    const sz   = 0.035 + Math.random() * 0.055;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(sz, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0x44aaee, transparent: true, opacity: 0.75 + Math.random() * 0.2 })
    );
    mesh.position.set(
      (Math.random() - 0.5) * 0.35,
      Math.random() * 1.2,
      (Math.random() - 0.5) * 0.35
    );
    mesh._vy = 0.025 + Math.random() * 0.04;
    mesh._vx = (Math.random() - 0.5) * 0.022;
    mesh._vz = (Math.random() - 0.5) * 0.022;
    mesh._g  = 0.003 + Math.random() * 0.003;
    emergencyGroup.add(mesh);
    particles.push(mesh);
  }
}

// ─── Nubes de vapor ───────────────────────────────────────────────────────────
function _spawnSteam(count) {
  steamPuffs = [];
  for (let i = 0; i < count; i++) {
    const sz   = 0.08 + Math.random() * 0.12;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(sz, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xaaccdd, transparent: true, opacity: 0 })
    );
    mesh.position.set((Math.random()-0.5)*0.5, -0.2 + Math.random()*0.3, (Math.random()-0.5)*0.5);
    mesh._vy   = 0.005 + Math.random() * 0.008;
    mesh._life = Math.random();
    mesh._maxOp= 0.15 + Math.random() * 0.15;
    emergencyGroup.add(mesh);
    steamPuffs.push(mesh);
  }
}

// ─── Desactivación ────────────────────────────────────────────────────────────
function _deactivateLeak(wasAutoResolved) {
  isLeakActive = false;

  const htmlAlert    = document.getElementById('alerta-fuga');
  const sonidoAlerta = document.getElementById('sonido-alerta');
  const btnFuga      = document.getElementById('btn-fuga');

  if (leakStartTime !== null) {
    const duration = ((performance.now() - leakStartTime) / 1000).toFixed(1);
    const tipo     = document.getElementById('tipo-fuga')?.innerText ?? '—';
    leakHistory.push({ tipo, duration, liters: Math.round(litersLost), auto: wasAutoResolved });
    _updateHistoryPanel();
    _updateSessionStats();
    leakStartTime = null;
    window.dispatchEvent(new CustomEvent('leak:state:change'));
  }

  leakMarker.visible = false;
  puddle.visible     = false;
  rippleRing.visible = false;
  activeLeakPos      = null;

  // Restaurar flujo y presión
  window._leakActive   = false;
  window._pressureDrop = false;

  _destroyEmergencyScene();

  clearTimeout(alertTimeout);
  htmlAlert.classList.remove('esquina');

  if (wasAutoResolved) {
    htmlAlert.classList.add('resuelto');
    setTimeout(() => {
      htmlAlert.style.opacity = '0';
      setTimeout(() => {
        htmlAlert.style.display = 'none';
        htmlAlert.style.opacity = '';
        htmlAlert.classList.remove('resuelto');
      }, 400);
    }, 1800);
  } else {
    htmlAlert.style.opacity = '0';
    setTimeout(() => { htmlAlert.style.display = 'none'; htmlAlert.style.opacity = ''; }, 400);
  }

  sonidoAlerta.pause();
  sonidoAlerta.currentTime = 0;
  sonidoAlerta.volume = 1;  // Restaurar para la próxima fuga
  clearTimeout(autoResolveTimeout);
  _stopLitersCounter();
  _hideSmartWaterPanel();
  _hideBrigadePanel();
  // ── NUEVAS MEJORAS: limpiar sensor, audio, SCADA, camiones ────────────────
  _stopAlarmSynth();
  _resetSensorNodes();
  _destroyAllRouteTrucks();
  _clearSCADAAlarm();
  // Calcular puntuación de respuesta
  if (leakStartTime !== null) {
    // leakStartTime ya se usó arriba, usamos el duration del último evento
  }
  const lastEvent = leakHistory[leakHistory.length - 1];
  if (lastEvent) {
    totalLitersSession += lastEvent.liters ?? 0;
    _showScorePanel(lastEvent);
  }
  _updateSessionStats();

  btnFuga.classList.remove('fuga-activa');
  btnFuga.innerHTML = '<span class="cam-icon">🚨</span> Simular Fuga';
  _stopTimer();
  // Update session stats section in sidebar
  _updateSessionStats();
  goToView('general');
}

// ─── Destruir y liberar memoria ───────────────────────────────────────────────
function _destroyEmergencyScene() {
  if (!emergencyGroup) return;
  emergencyGroup.traverse(obj => {
    if (obj.isMesh) {
      obj.geometry.dispose();
      Array.isArray(obj.material)
        ? obj.material.forEach(m => m.dispose())
        : obj.material?.dispose();
    }
  });
  scene.remove(emergencyGroup);
  emergencyGroup = null;
  particles      = [];
  steamPuffs     = [];
  workers        = [];
  warningLight   = null;
  extraRipples   = [];
  brokenPipe     = null;
}

// ─── Auto-resolución ──────────────────────────────────────────────────────────
function _autoResolve() {
  const htmlAlert = document.getElementById('alerta-fuga');
  htmlAlert.querySelector('h3').textContent = '✅ Fuga Controlada';
  htmlAlert.querySelector('p').textContent  = 'Sistema cerrado automáticamente.';
  _deactivateLeak(true);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   LOOP DE ANIMACIÓN
   ═══════════════════════════════════════════════════════════════════════════ */
export function updateLeaks() {
  if (!isLeakActive) return;
  const time = performance.now() * 0.005;

  if (leakMarker?.visible)
    leakMarker.scale.setScalar(baseLeakSize + Math.sin(time) * 0.07);

  // Charco proporcional a litros perdidos (Mejora 7)
  if (puddle?.visible) {
    const targetS = Math.min(0.5 + (litersLost / 80) * baseLeakSize, baseLeakSize * 4.5);
    if (puddle.scale.x < targetS)
      puddle.scale.setScalar(Math.min(puddle.scale.x + 0.002, targetS));
  }

  if (rippleRing?.visible) {
    const t = (time % 3) / 3;
    rippleRing.scale.setScalar(0.4 + t * baseLeakSize * 3.5);
    rippleRing.material.opacity = 0.5 * (1 - t);
  }

  if (!emergencyGroup) return;

  // Luz pulsante con velocidad según gravedad
  const blinkSpeed = baseLeakSize < 1 ? 2.5 : baseLeakSize < 1.5 ? 4.5 : 8.0;
  if (warningLight)
    warningLight.intensity = (Math.sin(time * blinkSpeed) * 0.5 + 0.5) * 3 * baseLeakSize;

  // Balizas giratorias en todas las camionetas (Mejora 8)
  _beaconAngle += 0.08;
  emergencyGroup.traverse(obj => {
    if (obj.name === 'beaconArm') obj.rotation.y = _beaconAngle;
    if (obj.name === 'beaconDome') {
      const pulse = Math.sin(time * blinkSpeed) * 0.5 + 0.5;
      obj.material.opacity = 0.4 + pulse * 0.5;
    }
  });

  // Ripples secundarios
  extraRipples.forEach(r => {
    const t = ((time + r.offset) % 3) / 3;
    r.mesh.scale.setScalar(0.2 + t * baseLeakSize * 2.5);
    r.mesh.material.opacity = 0.25 * (1 - t);
  });

  // Chorro del tubo
  if (brokenPipe?.jet) {
    const j = brokenPipe.jet;
    j.scale.y = 0.8 + Math.sin(time * 6) * 0.2;
    j.position.y = 0.3 + Math.sin(time * 4) * 0.05;
    j.material.opacity = 0.5 + Math.sin(time * 7) * 0.2;
  }

  // Partículas de agua
  particles.forEach(p => {
    p._vy -= p._g;
    p.position.y += p._vy;
    p.position.x += p._vx;
    p.position.z += p._vz;
    if (p.position.y < -0.44) {
      p.position.set((Math.random()-0.5)*0.35, -0.42 + Math.random()*0.1, (Math.random()-0.5)*0.35);
      p._vy = 0.025 + Math.random() * 0.04;
      p._vx = (Math.random()-0.5) * 0.022;
      p._vz = (Math.random()-0.5) * 0.022;
    }
  });

  // Vapor
  steamPuffs.forEach(s => {
    s._life += 0.008;
    s.position.y += s._vy;
    const phase = s._life % 1;
    s.material.opacity = phase < 0.5 ? phase * 2 * s._maxOp : (1-phase) * 2 * s._maxOp;
    s.scale.setScalar(0.6 + phase * 1.4);
    if (s.position.y > 1.5)
      s.position.set((Math.random()-0.5)*0.5, -0.2, (Math.random()-0.5)*0.5);
  });

  // Trabajadores: brazos oscilantes
  workers.forEach(w => {
    const swing = Math.sin(time * 2.8 + w.phase) * 0.3;
    if (w.armL) w.armL.rotation.z =  0.55 + swing;
    if (w.armR) w.armR.rotation.z = -0.55 - swing;
    w.group.rotation.z = Math.sin(time * 1.2 + w.phase) * 0.04;
  });

  // ── NUEVAS MEJORAS: animar sensores 3D y camiones en ruta ─────────────────
  _updateSensorNodes(time);
  _updateRouteTrucks();
}

// ─── Panel Smart Water (Mejora 6) ─────────────────────────────────────────────
function _injectSmartWaterPanel() {
  if (document.getElementById('sw-panel')) return;
  const el = document.createElement('div');
  el.id = 'sw-panel';
  el.style.cssText = `
    display:none; position:absolute; top:1.2rem; left:50%; transform:translateX(-50%);
    background:rgba(5,18,35,.95); color:#aee6ff;
    font-family:'Courier New',monospace; font-size:.78rem; line-height:1.7;
    padding:1rem 1.4rem; border-radius:8px; min-width:280px;
    border:1px solid rgba(0,180,255,.4);
    box-shadow:0 0 18px rgba(0,180,255,.18); z-index:60;`;
  el.innerHTML = `
    <div style="color:#00cfff;font-size:.92rem;font-weight:700;letter-spacing:.12em;margin-bottom:.5rem">
      📡 CENTRO DE CONTROL · SMART WATER
    </div>
    <div class="sw-row"><span class="sw-lbl">Sensor</span><span id="sw-sensor" class="sw-val">—</span></div>
    <div class="sw-row"><span class="sw-lbl">Sector</span><span id="sw-sector" class="sw-val">—</span></div>
    <div class="sw-row"><span class="sw-lbl">Caudal</span><span id="sw-flow" class="sw-val">—</span></div>
    <div class="sw-row"><span class="sw-lbl">Presión</span><span id="sw-pressure" class="sw-val">—</span></div>
    <div style="margin-top:.5rem">
      <div style="font-size:.7rem;color:#88aacc;margin-bottom:.2rem">ESTADO DEL SISTEMA</div>
      <span id="sw-status" style="font-weight:700;font-size:.9rem">—</span>
    </div>
    <div style="margin-top:.6rem;font-size:.7rem;color:#557799">
      Red HDPE · Osmosis Inversa · Monitoreo Digital
    </div>`;
  // CSS de filas
  const style = document.createElement('style');
  style.textContent = `
    .sw-row{display:flex;justify-content:space-between;gap:1.5rem;border-bottom:1px solid rgba(0,180,255,.1);padding:.15rem 0}
    .sw-lbl{color:#557799;font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}
    .sw-val{color:#aee6ff;font-weight:600}`;
  document.head.appendChild(style);
  document.querySelector('.canvas-wrap')?.appendChild(el);
}

function _showSmartWaterPanel(point, type) {
  const el = document.getElementById('sw-panel');
  if (!el) return;
  const pressures = { 0.5: '1.8 bar ⚠️', 1.0: '0.9 bar 🔴', 1.5: '0.2 bar 🚨' };
  const statuses  = { 0.5: '⚠️ ALERTA', 1.0: '🔴 EMERGENCIA', 1.5: '🚨 CRÍTICO' };
  const colors    = { 0.5: '#ffcc00', 1.0: '#ff7700', 1.5: '#ff2200' };
  document.getElementById('sw-sensor').textContent    = point.sensor;
  document.getElementById('sw-sector').textContent    = point.name;
  document.getElementById('sw-flow').textContent      = `${type.litersPerSec * 60} L/min`;
  document.getElementById('sw-pressure').textContent  = pressures[type.size] ?? '—';
  const statusEl = document.getElementById('sw-status');
  statusEl.textContent  = statuses[type.size] ?? 'ALARMA';
  statusEl.style.color  = colors[type.size] ?? '#ff2200';
  el.style.borderColor  = `${colors[type.size]}66`;
  el.style.display      = 'block';
}

function _hideSmartWaterPanel() {
  const el = document.getElementById('sw-panel');
  if (el) el.style.display = 'none';
}

// ─── Panel Brigada (Mejora 5) ─────────────────────────────────────────────────
function _injectBrigadePanel() {
  if (document.getElementById('brigade-panel')) return;
  const el = document.createElement('div');
  el.id = 'brigade-panel';
  el.style.cssText = `
    display:none; position:absolute; bottom:4.5rem; left:1.2rem;
    background:rgba(27,61,45,.95); color:#fff;
    font-family:'Crimson Pro',serif; font-size:.85rem; line-height:1.6;
    padding:.8rem 1.1rem; border-radius:8px; min-width:170px;
    border:1px solid rgba(255,136,0,.4); z-index:60;`;
  el.innerHTML = `
    <div style="color:#ffaa00;font-weight:700;font-size:.88rem;margin-bottom:.3rem">🚛 Brigada en Camino</div>
    <div style="font-size:.72rem;opacity:.7;margin-bottom:.3rem">Tiempo estimado de llegada</div>
    <div id="brigade-countdown" style="font-size:1.8rem;font-weight:700;color:#ffdd88;letter-spacing:.05em">00:30</div>
    <div id="brigade-status" style="font-size:.75rem;margin-top:.3rem;opacity:.8">En ruta al sector…</div>`;
  document.querySelector('.canvas-wrap')?.appendChild(el);
}

function _startBrigadeCountdown(type) {
  clearInterval(brigadeInterval);
  const el = document.getElementById('brigade-panel');
  const countdown = document.getElementById('brigade-countdown');
  const status    = document.getElementById('brigade-status');
  if (!el) return;
  // Tiempo de llegada según gravedad
  const arrivalSecs = type.size < 1 ? 30 : type.size < 1.5 ? 20 : 12;
  let remaining = arrivalSecs;
  el.style.display = 'block';
  if (countdown) countdown.textContent = `00:${String(remaining).padStart(2,'0')}`;
  if (status) status.textContent = 'En ruta al sector…';

  brigadeInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(brigadeInterval);
      if (countdown) countdown.textContent = '00:00';
      if (status) { status.textContent = '✅ Brigada en sitio'; status.style.color = '#88ff88'; }
      return;
    }
    if (countdown) countdown.textContent = `00:${String(remaining).padStart(2,'0')}`;
  }, 1000);
}

function _hideBrigadePanel() {
  clearInterval(brigadeInterval);
  const el = document.getElementById('brigade-panel');
  if (el) el.style.display = 'none';
}

// ─── Panel de puntuación (Mejora 10) ──────────────────────────────────────────
function _injectScorePanel() {
  if (document.getElementById('score-panel')) return;
  const el = document.createElement('div');
  el.id = 'score-panel';
  el.style.cssText = `
    display:none; position:absolute; top:50%; right:1.2rem; transform:translateY(-50%);
    background:rgba(27,61,45,.97); color:#fff;
    font-family:'Playfair Display',serif; text-align:center;
    padding:1.2rem 1.6rem; border-radius:10px; min-width:160px;
    border:1px solid rgba(184,144,58,.5); z-index:60;
    animation:toastIn .4s ease both;`;
  el.innerHTML = `
    <div style="color:#ddb85a;font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.4rem">
      Respuesta
    </div>
    <div id="score-time" style="font-size:1.5rem;font-weight:700;color:#aee6ff">—</div>
    <div id="score-value" style="font-size:2.4rem;font-weight:700;color:#ddb85a;line-height:1">—</div>
    <div id="score-label" style="font-size:.9rem;margin-top:.3rem;color:#aaa">—</div>`;
  document.querySelector('.canvas-wrap')?.appendChild(el);
}

function _showScorePanel(event) {
  const el = document.getElementById('score-panel');
  if (!el) return;
  const secs = parseFloat(event.duration);
  // Puntuación: base 100, -2 por segundo de respuesta, mínimo 20
  const score = Math.max(20, Math.round(100 - secs * 2));
  const label = score >= 85 ? '⭐ Excelente' : score >= 60 ? '👍 Aceptable' : '📉 Mejorable';
  const color = score >= 85 ? '#88ff88' : score >= 60 ? '#ffcc44' : '#ff6644';
  document.getElementById('score-time').textContent  = `${secs}s`;
  document.getElementById('score-value').textContent = `${score}/100`;
  document.getElementById('score-value').style.color = color;
  document.getElementById('score-label').textContent = label;
  el.style.display = 'block';
  setTimeout(() => {
    el.style.transition = 'opacity .5s';
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; el.style.opacity = ''; el.style.transition = ''; }, 500);
  }, 4500);
}

// ─── Actualizar _updateSessionStats con desglose por tipo y litros acumulados ─
// (override the existing function below)

// ─── Getter público ───────────────────────────────────────────────────────────
// MEJORA 12 — Exponer estado globalmente para que scene.js lo consuma sin import circular
window._getLeakState = () => ({ isActive: isLeakActive, position: activeLeakPos, totalLeaks, history: [...leakHistory] });

export function getLeakState() {
  return { isActive: isLeakActive, position: activeLeakPos, totalLeaks, litersLost, history: [...leakHistory] };
}

export function getTotalLiters() {
  return leakHistory.reduce((a, e) => a + (e.liters ?? 0), 0);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   UI  —  historial + timer
   ═══════════════════════════════════════════════════════════════════════════ */
function _injectHistoryPanel() {
  // If the right sidebar already has #lh-list, skip injection
  if (document.getElementById('lh-list')) return;
  const panel = document.createElement('div');
  panel.id = 'leak-history-panel';
  panel.innerHTML = `
    <div class="lh-header">
      <span>📋 Registro de Fugas</span>
      <span id="lh-count">0 eventos</span>
    </div>
    <ul id="lh-list"><li class="lh-empty">Sin eventos en esta sesión.</li></ul>`;
  document.querySelector('.canvas-wrap')?.appendChild(panel);
}

function _updateHistoryPanel() {
  const list  = document.getElementById('lh-list');
  const count = document.getElementById('lh-count');
  if (!list) return;
  count.textContent = `${leakHistory.length} evento${leakHistory.length !== 1 ? 's' : ''}`;
  list.innerHTML = leakHistory.slice().reverse().map((e, i) => `
    <li class="lh-item ${e.auto ? 'auto' : 'manual'}">
      <span class="lh-idx">#${leakHistory.length - i}</span>
      <span class="lh-tipo">${e.tipo}</span>
      <span class="lh-dur">${e.duration}s · ${e.liters ?? '?'}L · ${e.auto ? '⚙️ auto' : '👤 manual'}</span>
    </li>`).join('');
}

let _timerInterval = null;

function _injectTimerBadge() {
  const badge = document.createElement('div');
  badge.id = 'leak-timer-badge';
  badge.style.display = 'none';
  badge.textContent = '00:00';
  document.querySelector('.canvas-wrap')?.appendChild(badge);
}

function _startTimer() {
  const badge = document.getElementById('leak-timer-badge');
  if (!badge) return;
  badge.style.display = 'block';
  let elapsed = 0;
  clearInterval(_timerInterval);
  _timerInterval = setInterval(() => {
    elapsed++;
    badge.textContent = `⏱ ${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(elapsed%60).padStart(2,'0')}`;
  }, 1000);
}

function _stopTimer() {
  clearInterval(_timerInterval);
  const badge = document.getElementById('leak-timer-badge');
  if (badge) badge.style.display = 'none';
}

// ─── Contador de litros perdidos ─────────────────────────────────────────────
function _injectLitersCounter() {
  // Use the #liters-section in the right sidebar if it exists
  if (document.getElementById('liters-section')) return;
  // Fallback: inject into canvas-wrap
  const el = document.createElement('div');
  el.id = 'liters-counter';
  el.style.display = 'none';
  el.innerHTML = `
    <span class="lc-label">💧 Litros perdidos</span>
    <span id="lc-value">0 L</span>`;
  document.querySelector('.canvas-wrap')?.appendChild(el);
}

function _startLitersCounter(lps) {
  litersLost = 0;
  // Support both sidebar #liters-section and fallback #liters-counter
  const container = document.getElementById('liters-section') || document.getElementById('liters-counter');
  const val = document.getElementById('lc-value');
  if (container) container.style.display = '';
  clearInterval(litersInterval);
  litersInterval = setInterval(() => {
    litersLost += lps / 10;
    if (val) {
      val.textContent = litersLost < 1000
        ? `${litersLost.toFixed(1)} L`
        : `${(litersLost / 1000).toFixed(2)} m³`;
      val.classList.toggle('critical', litersLost > 50);
    }
  }, 100);
}

function _stopLitersCounter() {
  clearInterval(litersInterval);
  const container = document.getElementById('liters-section') || document.getElementById('liters-counter');
  if (container) container.style.display = 'none';
  // Reset value display
  const val = document.getElementById('lc-value');
  if (val) { val.textContent = '0 L'; val.classList.remove('critical'); }
}

// ─── Panel de estadísticas globales de sesión ─────────────────────────────────
function _injectSessionStats() {
  // Use #session-stats-section in the right sidebar if it exists
  if (document.getElementById('session-stats-section')) return;
  // Fallback: inject into canvas-wrap
  const el = document.createElement('div');
  el.id = 'session-stats';
  el.innerHTML = `
    <div class="ss-title">📊 Estadísticas de Sesión</div>
    <div class="ss-row">
      <span class="ss-label">Total fugas</span>
      <span class="ss-val" id="ss-total">0</span>
    </div>
    <div class="ss-row">
      <span class="ss-label">Agua perdida</span>
      <span class="ss-val" id="ss-water">0 L</span>
    </div>
    <div class="ss-row">
      <span class="ss-label">Tiempo resp. prom.</span>
      <span class="ss-val" id="ss-avgtime">—</span>
    </div>
    <div class="ss-row">
      <span class="ss-label">Auto-resueltas</span>
      <span class="ss-val" id="ss-auto">0</span>
    </div>`;
  document.querySelector('.canvas-wrap')?.appendChild(el);
}

function _updateSessionStats() {
  const panel = document.getElementById('session-stats-section') || document.getElementById('session-stats');
  if (panel && leakHistory.length > 0) {
    panel.style.display = '';
    panel.classList.add('has-data');
  }
  const totalEl = document.getElementById('ss-total');
  const waterEl = document.getElementById('ss-water');
  const avgEl   = document.getElementById('ss-avgtime');
  const autoEl  = document.getElementById('ss-auto');
  if (!totalEl) return;

  const totalWater = leakHistory.reduce((a, e) => a + (e.liters ?? 0), 0);
  const avgTime    = leakHistory.length
    ? (leakHistory.reduce((a, e) => a + parseFloat(e.duration), 0) / leakHistory.length).toFixed(1)
    : '—';
  const autoCount  = leakHistory.filter(e => e.auto).length;
  const efficiency = leakHistory.length
    ? Math.max(0, Math.round(100 - (totalWater / Math.max(leakHistory.length, 1)) / 5)).toString() + '%'
    : '—';

  totalEl.textContent = `${leakHistory.length} (🟡${leaksByType.leve} 🟠${leaksByType.media} 🔴${leaksByType.critica})`;
  waterEl.textContent = totalWater < 1000
    ? `${totalWater} L · $${(totalWater * 0.8).toFixed(0)} CLP`
    : `${(totalWater/1000).toFixed(2)} m³ · $${(totalWater * 0.8).toFixed(0)} CLP`;
  avgEl.textContent   = leakHistory.length ? `${avgTime}s` : '—';
  if (autoEl) autoEl.textContent = `${autoCount} · Eficiencia: ${efficiency}`;
}
/* ═══════════════════════════════════════════════════════════════════════════════
   MEJORA A — SENSORES 3D PARPADEANTES
   Pequeños nodos de monitoreo visibles en todos los puntos de tubería.
   Verde pulsante en reposo → rojo/naranja intenso en fuga activa.
   ═══════════════════════════════════════════════════════════════════════════ */
function _buildSensorNodes() {
  // Limpiar anteriores
  _sensorNodes.forEach(n => scene?.remove(n.group));
  _sensorNodes = [];

  pipePoints.forEach((pt, idx) => {
    const group = new THREE.Group();
    group.position.copy(pt.pos).add(new THREE.Vector3(0, 0.45, 0));

    // Aro exterior (torus horizontal)
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.20, 0.035, 6, 18),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.75 })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // Punto interior
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.90 })
    );
    group.add(dot);

    // Antena vertical pequeña
    const ant = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.22, 5),
      MAT.sensorAntenna
    );
    ant.position.y = 0.11;
    group.add(ant);

    // Cabeza de antena
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 5, 4),
      new THREE.MeshBasicMaterial({ color: 0x00ff88, transparent: true, opacity: 0.9 })
    );
    head.position.y = 0.23;
    group.add(head);

    scene.add(group);
    _sensorNodes.push({ group, ring, dot, head, idx, phase: idx * 0.62 });
  });
}

function _activateSensorAtIndex(idx) {
  _activeSensorIdx = idx;
}

function _resetSensorNodes() {
  _activeSensorIdx = -1;
}

function _updateSensorNodes(time) {
  _sensorNodes.forEach(n => {
    if (n.idx === _activeSensorIdx) {
      // Parpadeo rápido con color según gravedad
      const blinkSpeed = baseLeakSize < 1 ? 5 : baseLeakSize < 1.5 ? 10 : 20;
      const pulse      = Math.sin(time * blinkSpeed) * 0.5 + 0.5;
      const hex        = baseLeakSize < 1 ? 0xffaa00 : baseLeakSize < 1.5 ? 0xff5500 : 0xff0022;
      n.ring.material.color.setHex(hex);
      n.dot.material.color.setHex(hex);
      n.head.material.color.setHex(hex);
      n.ring.material.opacity = 0.25 + pulse * 0.75;
      n.dot.material.opacity  = 0.25 + pulse * 0.75;
      n.head.material.opacity = 0.25 + pulse * 0.75;
      n.group.scale.setScalar(1.0 + pulse * 0.40);
    } else {
      // Pulso verde suave en reposo
      const pulse = Math.sin(time * 1.8 + n.phase) * 0.5 + 0.5;
      n.ring.material.color.setHex(0x00ff88);
      n.dot.material.color.setHex(0x00ff88);
      n.head.material.color.setHex(0x00ff88);
      n.ring.material.opacity = 0.45 + pulse * 0.30;
      n.dot.material.opacity  = 0.55 + pulse * 0.35;
      n.head.material.opacity = 0.55 + pulse * 0.35;
      n.group.scale.setScalar(1.0 + pulse * 0.06);
    }
  });
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MEJORA B — CAMIÓN ANIMADO EN RUTA
   El camión aparece en el acceso de la carretera y viaja hacia el punto de fuga
   con aceleración suave. Gira para orientarse hacia el destino.
   ═══════════════════════════════════════════════════════════════════════════ */

// Punto de entrada desde la carretera (zona del parking -24,-8 aprox.)
const ROAD_ENTRY = new THREE.Vector3(-30, 0, -8);

function _spawnRouteTruck(targetWorldPos, isMaintenance = false) {
  const truck = _makeTruck(isMaintenance);

  // Elegir punto de salida alternativo para el segundo camión
  const entry = ROAD_ENTRY.clone().add(
    new THREE.Vector3(0, 0, isMaintenance ? 3 : 0)
  );

  truck.position.copy(entry);
  truck.position.y = 0;

  // Orientar hacia el destino al salir
  const dir = targetWorldPos.clone().sub(entry);
  dir.y = 0;
  if (dir.length() > 0.01) {
    truck.rotation.y = Math.atan2(dir.x, dir.z);
  }

  scene.add(truck);

  _routeTrucks.push({
    mesh       : truck,
    startPos   : entry.clone(),
    targetPos  : targetWorldPos.clone(),
    progress   : 0,
    speed      : 0.012,       // progreso por frame (~3-4 s de viaje)
    arrived    : false,
    isMaintenance,
  });
}

function _updateRouteTrucks() {
  _routeTrucks.forEach(rt => {
    if (rt.arrived) return;

    rt.progress = Math.min(1, rt.progress + rt.speed);

    // Ease-in-out cuadrático
    const p = rt.progress;
    const t = p < 0.5 ? 2 * p * p : -1 + (4 - 2 * p) * p;

    rt.mesh.position.lerpVectors(rt.startPos, rt.targetPos, t);
    // Bache de vibración mientras rueda
    rt.mesh.position.y = Math.abs(Math.sin(rt.progress * 60)) * 0.03;

    // Girar gradualmente hacia el destino mientras avanza
    const dir = rt.targetPos.clone().sub(rt.mesh.position);
    dir.y = 0;
    if (dir.length() > 0.3) {
      const targetAngle = Math.atan2(dir.x, dir.z);
      const currentAngle = rt.mesh.rotation.y;
      // Interpolación de ángulo
      let diff = targetAngle - currentAngle;
      while (diff >  Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      rt.mesh.rotation.y += diff * 0.12;
    }

    if (rt.progress >= 1) {
      rt.arrived = true;
      rt.mesh.position.copy(rt.targetPos);
      rt.mesh.position.y = 0;
      // Orientar cabina hacia la fuga
      if (activeLeakPos) {
        const faceDir = activeLeakPos.clone().sub(rt.targetPos);
        faceDir.y = 0;
        if (faceDir.length() > 0.1)
          rt.mesh.rotation.y = Math.atan2(faceDir.x, faceDir.z);
      }
    }
  });
}

function _destroyAllRouteTrucks() {
  _routeTrucks.forEach(rt => {
    rt.mesh.traverse(obj => {
      if (obj.isMesh) {
        obj.geometry.dispose();
        Array.isArray(obj.material)
          ? obj.material.forEach(m => m.dispose())
          : obj.material?.dispose();
      }
    });
    scene.remove(rt.mesh);
  });
  _routeTrucks = [];
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MEJORA C — WEB AUDIO: SONIDOS DISTINTOS POR GRAVEDAD
   Sin archivos externos. Usa la Web Audio API para sintetizar:
     • Goteo Leve    → doble-bip suave cada 2 s (880 Hz)
     • Fisura Media  → triple-bip urgente cada 1.5 s (1 100-1 300 Hz)
     • Rotura Crítica → sirena de barrido continuo (sawtooth 400-1 200 Hz)
   ═══════════════════════════════════════════════════════════════════════════ */
function _getAudioCtx() {
  if (!_audioCtx) {
    try {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return null; }
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function _stopAlarmSynth() {
  clearInterval(_alarmIntervalId);
  _alarmIntervalId = null;
  _audioNodes.forEach(n => { try { n.stop(); } catch(e) {} });
  _audioNodes = [];
}

function _playAlarmSynth(type) {
  _stopAlarmSynth();
  const ctx = _getAudioCtx();
  if (!ctx) return;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.28, ctx.currentTime);
  master.connect(ctx.destination);

  const beep = (freq, delayS, durS, vol = 0.22) => {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0, now + delayS);
    g.gain.linearRampToValueAtTime(vol, now + delayS + 0.01);
    g.gain.setValueAtTime(vol, now + delayS + durS - 0.025);
    g.gain.linearRampToValueAtTime(0, now + delayS + durS);
    osc.connect(g);
    g.connect(master);
    osc.start(now + delayS);
    osc.stop(now + delayS + durS);
    _audioNodes.push(osc);
  };

  if (type.size < 1) {
    // ── Goteo Leve: doble bip suave ──────────────────────────────────────────
    const pattern = () => { beep(880, 0.0, 0.18); beep(880, 0.35, 0.18); };
    pattern();
    _alarmIntervalId = setInterval(() => { if (isLeakActive) pattern(); else _stopAlarmSynth(); }, 2000);

  } else if (type.size < 1.5) {
    // ── Fisura Media: triple bip urgente ─────────────────────────────────────
    const pattern = () => {
      beep(1100, 0.00, 0.14, 0.26);
      beep(1100, 0.22, 0.14, 0.26);
      beep(1320, 0.44, 0.14, 0.26);
    };
    pattern();
    _alarmIntervalId = setInterval(() => { if (isLeakActive) pattern(); else _stopAlarmSynth(); }, 1500);

  } else {
    // ── Rotura Crítica: sirena de barrido continuo ────────────────────────────
    const osc = ctx.createOscillator();
    const g   = ctx.createGain();
    osc.type = 'sawtooth';
    g.gain.setValueAtTime(0.22, ctx.currentTime);
    osc.connect(g);
    g.connect(master);
    osc.start();
    _audioNodes.push(osc);

    const sweep = () => {
      if (!isLeakActive) { try { osc.stop(); } catch(e) {} return; }
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.linearRampToValueAtTime(1250, now + 0.65);
      osc.frequency.linearRampToValueAtTime(420,  now + 1.30);
      setTimeout(sweep, 1300);
    };
    sweep();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MEJORA D — PANEL SCADA
   Overlay de control industrial con: diagrama de red SVG, tabla de sensores,
   KPIs en tiempo real, log deslizante. Botón toggle en el lienzo.
   ═══════════════════════════════════════════════════════════════════════════ */

// Mapeo 3D → SVG (viewBox 460×340)
function _w2svg(wx, wz) {
  return {
    x: Math.round(230 + wx  * 7.2),
    y: Math.round(170 + wz  * 5.2),
  };
}

function _injectSCADAPanel() {
  if (document.getElementById('scada-panel')) return;

  // ── Líneas de tuberías en SVG ─────────────────────────────────────────────
  const connections = [
    // Colector principal Z=-6
    [0,1],[1,2],
    // Casa central → colector
    [10,1],
    // Ramales noroeste
    [0,3],[0,4],[4,5],
    // Ramales centrales
    [1,6],[6,7],
    // Ramales este
    [2,8],[8,9],
  ];

  const pipeLines = connections.map(([a,b]) => {
    const pa = _w2svg(pipePoints[a].pos.x, pipePoints[a].pos.z);
    const pb = _w2svg(pipePoints[b].pos.x, pipePoints[b].pos.z);
    return `<line x1="${pa.x}" y1="${pa.y}" x2="${pb.x}" y2="${pb.y}"
              stroke="#0d3a55" stroke-width="2.5" stroke-linecap="round"/>`;
  }).join('');

  // Nodos de sensores SVG
  const sensorSVG = pipePoints.map((pt, i) => {
    const s = _w2svg(pt.pos.x, pt.pos.z);
    return `
      <g id="scada-sv-node-${i}" class="scada-sv-node" transform="translate(${s.x},${s.y})" style="cursor:pointer">
        <circle r="9"  fill="#071828" stroke="#00cc66" stroke-width="1.5" id="scada-sv-ring-${i}"/>
        <circle r="4"  fill="#00cc66" id="scada-sv-dot-${i}"/>
        <text dy="-14" text-anchor="middle" fill="#335566" font-size="7.5" font-family="Courier New">${pt.sensor}</text>
      </g>`;
  }).join('');

  // Iconos de infraestructura
  const icons = `
    <text x="${_w2svg(20,-10).x}" y="${_w2svg(20,-10).y}" text-anchor="middle" fill="#1a4466" font-size="20">🏭</text>
    <text x="${_w2svg(20,-10).x}" y="${_w2svg(20,-10).y+14}" text-anchor="middle" fill="#1a4466" font-size="7">PLANTA OI</text>
    <text x="${_w2svg(-8,-16).x}" y="${_w2svg(-8,-16).y}" text-anchor="middle" fill="#1a4466" font-size="17">🏠</text>
    <text x="${_w2svg(-8,-16).x}" y="${_w2svg(-8,-16).y+13}" text-anchor="middle" fill="#1a4466" font-size="7">CASA</text>
    <text x="${_w2svg(4,30).x}" y="${_w2svg(4,30).y}" text-anchor="middle" fill="#1a3355" font-size="9">⛱ PLAYA</text>
  `;

  // Filas de la tabla de sensores
  const sensorRows = pipePoints.map((p, i) => `
    <tr id="scada-tr-${i}">
      <td>${p.sensor}</td>
      <td style="color:#aaccdd">${p.name}</td>
      <td id="scada-td-pres-${i}">2.4 bar</td>
      <td id="scada-td-flow-${i}">—</td>
      <td><span id="scada-td-st-${i}" style="color:#00cc66">● OK</span></td>
    </tr>`).join('');

  const el = document.createElement('div');
  el.id = 'scada-panel';
  el.innerHTML = `
    <div class="scada-inner">

      <!-- ENCABEZADO -->
      <div class="scada-header">
        <div>
          <div class="scada-title">⚡ SISTEMA SCADA · RED HDPE · PLAYA LA VIRGEN</div>
          <div class="scada-subtitle">SUPERVISORY CONTROL AND DATA ACQUISITION · MONITOREO EN TIEMPO REAL</div>
        </div>
        <div style="display:flex;gap:.6rem;align-items:center">
          <div id="scada-global-badge" class="scada-badge ok">● SISTEMA NORMAL</div>
          <div id="scada-clock" class="scada-clock">--:--:--</div>
          <button class="scada-close-btn" onclick="document.getElementById('scada-panel').style.display='none'">✕</button>
        </div>
      </div>

      <!-- CUERPO -->
      <div class="scada-body">

        <!-- DIAGRAMA DE RED -->
        <div class="scada-card" style="flex:1.4">
          <div class="scada-card-title">📡 DIAGRAMA DE RED · HDPE</div>
          <svg id="scada-net-svg" viewBox="0 0 460 340" style="width:100%;height:calc(100% - 1.8rem)">
            <defs>
              <pattern id="sgrid" width="23" height="23" patternUnits="userSpaceOnUse">
                <path d="M23 0L0 0 0 23" fill="none" stroke="rgba(0,180,255,.05)" stroke-width="0.5"/>
              </pattern>
              <filter id="sensorGlow">
                <feGaussianBlur stdDeviation="2" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <rect width="460" height="340" fill="url(#sgrid)"/>
            <!-- Línea de playa decorativa -->
            <path d="M0 310 Q230 285 460 310 L460 340 L0 340Z" fill="rgba(0,80,150,.08)"/>
            <!-- Tuberías -->
            ${pipeLines}
            <!-- Íconos infraestructura -->
            ${icons}
            <!-- Nodos sensores -->
            <g filter="url(#sensorGlow)">${sensorSVG}</g>
          </svg>
        </div>

        <!-- PANEL DERECHO -->
        <div style="display:flex;flex-direction:column;gap:.7rem;width:390px;min-width:340px">

          <!-- TABLA SENSORES -->
          <div class="scada-card" style="flex:1;overflow:hidden">
            <div class="scada-card-title">🔍 ESTADO DE SENSORES</div>
            <div style="overflow-y:auto;height:calc(100% - 1.8rem)">
              <table class="scada-table">
                <thead><tr><th>ID</th><th>Sector</th><th>Presión</th><th>Caudal</th><th>Estado</th></tr></thead>
                <tbody>${sensorRows}</tbody>
              </table>
            </div>
          </div>

          <!-- KPIs -->
          <div class="scada-card">
            <div class="scada-card-title">📊 KPIs DEL SISTEMA</div>
            <div class="scada-kpi-grid">
              <div class="scada-kpi"><span class="skl">Presión promedio</span><span class="skv" id="scada-kpi-pres">2.4 bar</span></div>
              <div class="scada-kpi"><span class="skl">Eficiencia red</span><span class="skv" id="scada-kpi-eff">98.5%</span></div>
              <div class="scada-kpi"><span class="skl">Producción OI</span><span class="skv" id="scada-kpi-oi">35 m³/día</span></div>
              <div class="scada-kpi"><span class="skl">Pérdidas sesión</span><span class="skv" id="scada-kpi-loss">0 L</span></div>
              <div class="scada-kpi"><span class="skl">Fugas detectadas</span><span class="skv" id="scada-kpi-leaks">0</span></div>
              <div class="scada-kpi"><span class="skl">Estado general</span><span class="skv" id="scada-kpi-status" style="color:#00cc66">NOMINAL</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- LOG DESLIZANTE -->
      <div class="scada-log-bar">
        <span style="color:#00cc66;margin-right:.5rem">▶</span>
        <div class="scada-log-scroll" id="scada-log-text">
          SISTEMA INICIALIZADO · RED HDPE ACTIVA · OSMOSIS INVERSA 35 m³/DÍA · TODOS LOS SENSORES OK ·
          MONITOREO CONTINUO ACTIVADO · PRESIÓN NOMINAL 2.4 bar · SIN ANOMALÍAS DETECTADAS ·
        </div>
      </div>
    </div>

    <style>
      #scada-panel {
        display:none; position:absolute; inset:0; z-index:90;
        background:rgba(2,7,18,.96); color:#7ab8d4;
        font-family:'Courier New',monospace; font-size:.73rem;
        overflow:hidden;
      }
      .scada-inner { display:flex; flex-direction:column; height:100%; padding:.9rem 1.1rem; gap:.7rem; }
      .scada-header { display:flex; justify-content:space-between; align-items:flex-start;
        border-bottom:1px solid rgba(0,180,255,.25); padding-bottom:.6rem; }
      .scada-title   { color:#00d4ff; font-size:1rem; font-weight:700; letter-spacing:.14em; }
      .scada-subtitle{ color:#1a4060; font-size:.65rem; letter-spacing:.09em; margin-top:.15rem; }
      .scada-badge   { padding:.28rem .7rem; border-radius:4px; font-weight:700; font-size:.8rem; }
      .scada-badge.ok    { color:#00cc66; border:1px solid #00cc66; }
      .scada-badge.warn  { color:#ffaa00; border:1px solid #ffaa00; animation:scadaBlink 1s infinite; }
      .scada-badge.alert { color:#ff5500; border:1px solid #ff5500; animation:scadaBlink .6s infinite; }
      .scada-badge.crit  { color:#ff1100; border:1px solid #ff1100; animation:scadaBlink .3s infinite; }
      .scada-clock   { color:#335566; font-size:.8rem; letter-spacing:.05em; }
      .scada-close-btn { background:transparent; border:1px solid #223344; color:#557799;
        padding:.25rem .55rem; border-radius:4px; cursor:pointer; font-size:.82rem; }
      .scada-close-btn:hover { border-color:#ff5500; color:#ff5500; }
      .scada-body { display:flex; gap:.7rem; flex:1; min-height:0; }
      .scada-card { background:rgba(0,15,30,.6); border:1px solid rgba(0,180,255,.15);
        border-radius:6px; padding:.6rem .8rem; }
      .scada-card-title { color:#00a0cc; font-size:.68rem; letter-spacing:.12em;
        text-transform:uppercase; margin-bottom:.4rem; border-bottom:1px solid rgba(0,180,255,.1);
        padding-bottom:.25rem; }
      .scada-table { width:100%; border-collapse:collapse; font-size:.68rem; }
      .scada-table th { color:#1a5070; padding:3px 5px; text-align:left;
        border-bottom:1px solid rgba(0,180,255,.15); }
      .scada-table td { padding:3px 5px; border-bottom:1px solid rgba(0,180,255,.06); }
      .scada-table tr.scada-alarm td { background:rgba(255,0,0,.08); }
      .scada-kpi-grid { display:grid; grid-template-columns:1fr 1fr; gap:.4rem; }
      .scada-kpi { display:flex; flex-direction:column; background:rgba(0,20,40,.5);
        border:1px solid rgba(0,180,255,.10); border-radius:4px; padding:.3rem .5rem; }
      .skl { font-size:.60rem; color:#1a5070; text-transform:uppercase; letter-spacing:.06em; }
      .skv { font-size:.88rem; font-weight:700; color:#8ad4ff; margin-top:.1rem; }
      .scada-log-bar { display:flex; align-items:center;
        border:1px solid rgba(0,180,255,.12); border-radius:4px; padding:.25rem .6rem;
        overflow:hidden; height:1.8rem; }
      .scada-log-scroll { white-space:nowrap; color:#1a5070; letter-spacing:.06em;
        animation:scadaScroll 28s linear infinite; }
      @keyframes scadaScroll { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
      @keyframes scadaBlink  { 0%,100%{opacity:1} 50%{opacity:.2} }
      .scada-sv-node { transition:transform .1s; }

      /* Botón toggle SCADA en lienzo */
      #scada-toggle-btn {
        position:absolute; bottom:1rem; right:1rem; z-index:50;
        background:rgba(2,18,35,.9); color:#00d4ff;
        border:1px solid rgba(0,180,255,.4); border-radius:6px;
        padding:.45rem .85rem; cursor:pointer; font-family:'Courier New',monospace;
        font-size:.75rem; letter-spacing:.07em;
        box-shadow:0 0 12px rgba(0,180,255,.15);
        transition:all .2s;
      }
      #scada-toggle-btn:hover { background:rgba(0,40,80,.95); border-color:#00d4ff; }
    </style>`;

  document.querySelector('.canvas-wrap')?.appendChild(el);

  // Reloj en tiempo real
  setInterval(() => {
    const cl = document.getElementById('scada-clock');
    if (cl) cl.textContent = new Date().toLocaleTimeString('es-CL');
  }, 1000);
}

// Botón de toggle visible en el lienzo
function _injectSCADAToggleBtn() {
  if (document.getElementById('scada-toggle-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'scada-toggle-btn';
  btn.innerHTML = '🖥 SCADA';
  btn.addEventListener('click', () => {
    const p = document.getElementById('scada-panel');
    if (p) p.style.display = p.style.display === 'none' || !p.style.display ? 'block' : 'none';
  });
  document.querySelector('.canvas-wrap')?.appendChild(btn);
}

// Actualizar SCADA cuando hay fuga
function _updateSCADAAlarm(point, type) {
  const idx = pipePoints.indexOf(point);

  // Badge global
  const badge = document.getElementById('scada-global-badge');
  if (badge) {
    const cls  = type.size < 1 ? 'warn' : type.size < 1.5 ? 'alert' : 'crit';
    const txt  = type.size < 1 ? '⚠ ADVERTENCIA' : type.size < 1.5 ? '🔴 EMERGENCIA' : '🚨 CRÍTICO';
    badge.className = `scada-badge ${cls}`;
    badge.textContent = txt;
  }

  // Fila en tabla
  pipePoints.forEach((_, i) => {
    const tr  = document.getElementById(`scada-tr-${i}`);
    const st  = document.getElementById(`scada-td-st-${i}`);
    const pr  = document.getElementById(`scada-td-pres-${i}`);
    const fl  = document.getElementById(`scada-td-flow-${i}`);
    const dot = document.getElementById(`scada-sv-dot-${i}`);
    const ring= document.getElementById(`scada-sv-ring-${i}`);
    if (i === idx) {
      if (tr)  tr.classList.add('scada-alarm');
      if (st) { st.textContent = type.size < 1 ? '⚠ ALERTA' : type.size < 1.5 ? '🔴 FUGA' : '🚨 CRÍTICO';
                st.style.color = `#${type.color.toString(16).padStart(6,'0')}`; }
      if (pr)  pr.textContent = type.size < 1 ? '1.8 bar' : type.size < 1.5 ? '0.9 bar' : '0.2 bar';
      if (fl)  fl.textContent = `${type.litersPerSec} L/s`;
      if (dot) { dot.setAttribute('fill', `#${type.color.toString(16).padStart(6,'0')}`); }
      if (ring){ ring.setAttribute('stroke', `#${type.color.toString(16).padStart(6,'0')}`); }
    }
  });

  // KPIs
  const kpiPres = document.getElementById('scada-kpi-pres');
  const kpiEff  = document.getElementById('scada-kpi-eff');
  const kpiSt   = document.getElementById('scada-kpi-status');
  const kpiLoss = document.getElementById('scada-kpi-loss');
  const kpiLk   = document.getElementById('scada-kpi-leaks');
  if (kpiPres) kpiPres.textContent = type.size < 1 ? '1.8 bar' : type.size < 1.5 ? '0.9 bar' : '0.2 bar';
  if (kpiEff)  kpiEff.textContent  = type.size < 1 ? '91%' : type.size < 1.5 ? '73%' : '42%';
  if (kpiSt)  { kpiSt.textContent  = type.size < 1 ? 'ALERTA' : type.size < 1.5 ? 'EMERGENCIA' : 'CRÍTICO';
                kpiSt.style.color  = `#${type.color.toString(16).padStart(6,'0')}`; }
  if (kpiLk)   kpiLk.textContent   = String(totalLeaks);

  // Actualizar litros perdidos continuamente durante la fuga
  clearInterval(_scadaLitersInterval);
  _scadaLitersInterval = setInterval(() => {
    if (!isLeakActive) { clearInterval(_scadaLitersInterval); return; }
    const total = leakHistory.reduce((a,e) => a+(e.liters??0), 0) + Math.round(litersLost);
    if (kpiLoss) kpiLoss.textContent = total < 1000 ? `${total} L` : `${(total/1000).toFixed(2)} m³`;
  }, 500);
}

function _clearSCADAAlarm() {
  clearInterval(_scadaLitersInterval);
  const badge = document.getElementById('scada-global-badge');
  if (badge) { badge.className = 'scada-badge ok'; badge.textContent = '● SISTEMA NORMAL'; }

  pipePoints.forEach((_, i) => {
    const tr  = document.getElementById(`scada-tr-${i}`);
    const st  = document.getElementById(`scada-td-st-${i}`);
    const pr  = document.getElementById(`scada-td-pres-${i}`);
    const fl  = document.getElementById(`scada-td-flow-${i}`);
    const dot = document.getElementById(`scada-sv-dot-${i}`);
    const ring= document.getElementById(`scada-sv-ring-${i}`);
    if (tr)  tr.classList.remove('scada-alarm');
    if (st) { st.textContent = '● OK'; st.style.color = '#00cc66'; }
    if (pr)  pr.textContent = '2.4 bar';
    if (fl)  fl.textContent = '—';
    if (dot) dot.setAttribute('fill', '#00cc66');
    if (ring) ring.setAttribute('stroke', '#00cc66');
  });

  const kpiPres = document.getElementById('scada-kpi-pres');
  const kpiEff  = document.getElementById('scada-kpi-eff');
  const kpiSt   = document.getElementById('scada-kpi-status');
  const kpiLk   = document.getElementById('scada-kpi-leaks');
  if (kpiPres) kpiPres.textContent = '2.4 bar';
  if (kpiEff)  kpiEff.textContent  = '98.5%';
  if (kpiSt)  { kpiSt.textContent  = 'NOMINAL'; kpiSt.style.color = '#00cc66'; }
  if (kpiLk)   kpiLk.textContent   = String(totalLeaks);
}

/* ═══════════════════════════════════════════════════════════════════════════════
   MEJORA E — MODO AUTOMÁTICO
   Toggle que activa detecciones automáticas de fuga cada 15-25 s.
   ═══════════════════════════════════════════════════════════════════════════ */
function _injectAutoModeToggle() {
  if (document.getElementById('auto-mode-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'auto-mode-btn';
  btn.innerHTML = '⚙ AUTO OFF';
  btn.style.cssText = `
    position:absolute; bottom:1rem; left:50%; transform:translateX(-50%); z-index:50;
    background:rgba(5,20,35,.9); color:#557799;
    border:1px solid rgba(0,100,150,.3); border-radius:6px;
    padding:.4rem .8rem; cursor:pointer; font-family:'Courier New',monospace;
    font-size:.72rem; letter-spacing:.07em; transition:all .25s;`;

  btn.addEventListener('click', () => {
    autoModeActive = !autoModeActive;
    if (autoModeActive) {
      btn.innerHTML  = '⚙ AUTO ON';
      btn.style.color       = '#00cc66';
      btn.style.borderColor = 'rgba(0,204,100,.5)';
      _scheduleAutoLeak();
    } else {
      btn.innerHTML  = '⚙ AUTO OFF';
      btn.style.color       = '#557799';
      btn.style.borderColor = 'rgba(0,100,150,.3)';
      clearTimeout(_autoModeInterval);
    }
  });

  document.querySelector('.canvas-wrap')?.appendChild(btn);
}

function _scheduleAutoLeak() {
  if (!autoModeActive) return;
  const delay = 12000 + Math.random() * 14000; // 12-26 s
  _autoModeInterval = setTimeout(() => {
    if (!autoModeActive) return;
    if (!isLeakActive) simulateLeak();   // lanza fuga
    // Reprogramar después de que termine
    const check = setInterval(() => {
      if (!isLeakActive) {
        clearInterval(check);
        if (autoModeActive) _scheduleAutoLeak();
      }
    }, 1000);
  }, delay);
}
