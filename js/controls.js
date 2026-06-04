import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ═══════════════════════════════════════════════════════════════════════════
   controls.js  v2.0  —  Sistema de cámara con animación cinematográfica,
   vistas predefinidas, tour automático, minimap y atajos de teclado.

   Mejoras v2.0:
   · Easing easeInOutQuint — movimientos más suaves y con peso
   · Blend desde posición intermedia — no más saltos al cambiar vista
   · _setActiveButton corregido para sidebar (.sb-btn)
   · _setTourButtonState corregido para sidebar
   · 2 vistas nuevas: cabins + main
   · Tour con todas las vistas (5 paradas)
   · Minimap reubicado (esquina inf-izq del canvas, no centrado)
   · Zoom suavizado en la animación
   · Shake de cámara opcional para eventos de fuga
   · Panel de atajos accesible desde teclado (?)
   ═══════════════════════════════════════════════════════════════════════════ */

// ─── Estado ───────────────────────────────────────────────────────────────────
let controls, camera;

const destPos    = new THREE.Vector3();
const destTarget = new THREE.Vector3();
const fromPos    = new THREE.Vector3();
const fromTarget = new THREE.Vector3();

let isAnimating  = false;
let animProgress = 0;
let animDuration = 1.8;   // segundos (se recalcula por distancia)
let animElapsed  = 0;

// Shake de cámara
let shakeIntensity = 0;
const _shakeOffset = new THREE.Vector3();

// ─── Tour automático ──────────────────────────────────────────────────────────
let tourActive = false;
let tourIndex  = 0;
let tourTimer  = 0;
const TOUR_PAUSE = 5.0;   // segundos en cada vista

// 5 paradas: todas las vistas del proyecto
const TOUR_SEQUENCE = ['general', 'plant', 'network', 'main', 'cabins'];

// ─── Historial de cámara ──────────────────────────────────────────────────────
const camHistory  = [];
const CAM_HISTORY_MAX = 8;

// ─── Vistas predefinidas ──────────────────────────────────────────────────────
const VIEWS = {
  general: {
    pos:    new THREE.Vector3(0, 52, 70),
    target: new THREE.Vector3(0, 0, 15),
    label:  'Vista General',
  },
  plant: {
    pos:    new THREE.Vector3(36, 14, 5),
    target: new THREE.Vector3(22, 2, -10),
    label:  'Planta Desalinizadora',
  },
  network: {
    pos:    new THREE.Vector3(-8, 20, -8),
    target: new THREE.Vector3(0, 3, -26),
    label:  'Cerro y Estanque',
  },
  // ── Nuevas vistas v2 ────────────────────────────────────────────────────
  cabins: {
    pos:    new THREE.Vector3(1, 18, 45),
    target: new THREE.Vector3(1, 0, 18),
    label:  'Zona de Cabañas',
  },
  main: {
    pos:    new THREE.Vector3(4, 10, -8),
    target: new THREE.Vector3(-8, 1, -16),
    label:  'Casa Central de Distribución',
  },
  lobby: {
    pos:    new THREE.Vector3(2, 6, -10),
    target: new THREE.Vector3(0, 1, -20),
    label:  'Acceso Principal',
  },
};

// ─── Inicialización ───────────────────────────────────────────────────────────
export function initControls(cam, rendererDom) {
  // Expose for external access
  window._controls = { registerView };
  camera = cam;

  controls = new OrbitControls(camera, rendererDom);
  controls.enableDamping   = true;
  controls.dampingFactor   = 0.06;
  controls.minDistance     = 4;
  controls.maxDistance     = 100;
  controls.maxPolarAngle   = Math.PI / 2 - 0.02;  // no puede ir bajo suelo
  controls.enablePan       = true;
  controls.panSpeed        = 0.5;
  controls.rotateSpeed     = 0.45;
  controls.zoomSpeed       = 0.8;
  controls.screenSpacePanning = true;   // pan más intuitivo
  controls.target.set(0, 0, -5);
  controls.update();

  destPos.copy(VIEWS.general.pos);
  destTarget.copy(VIEWS.general.target);

  // Dispatch camera:arrived so the loader overlay dismisses on first render
  requestAnimationFrame(() => requestAnimationFrame(() =>
    window.dispatchEvent(new CustomEvent('camera:arrived'))
  ));

  // Cancelar animación al tomar control manual (pero hacer blend suave)
  controls.addEventListener('start', _onUserInteractionStart);

  // Ocultar tooltip al primer toque
  controls.addEventListener('start', _hideCanvasTooltip, { once: true });

  // Atajos de teclado globales
  window.addEventListener('keydown', _handleKeydown);

  // Minimap
  _buildMinimap(rendererDom.parentElement);

  // Panel de atajos (tecla ?)
  _buildShortcutHint(rendererDom.parentElement);

  // Escuchar evento de fuga para shake de cámara
  window.addEventListener('leak:started', () => triggerCameraShake(0.06, 0.8));
}

// ─── Loop principal ───────────────────────────────────────────────────────────
export function updateControls(delta = 0.016) {

  // ── Animación de cámara ──────────────────────────────────────────────────
  if (isAnimating) {
    animElapsed = Math.min(animElapsed + delta, animDuration);
    const t = _easeInOutQuint(animElapsed / animDuration);

    camera.position.lerpVectors(fromPos, destPos, t);
    controls.target.lerpVectors(fromTarget, destTarget, t);

    if (animElapsed >= animDuration) {
      isAnimating  = false;
      animElapsed  = 0;
      animProgress = 0;
      camera.position.copy(destPos);
      controls.target.copy(destTarget);
      _dispatchCameraArrived();
    }
  }

  // ── Shake ────────────────────────────────────────────────────────────────
  if (shakeIntensity > 0) {
    shakeIntensity *= 0.88;
    _shakeOffset.set(
      (Math.random() - 0.5) * shakeIntensity,
      (Math.random() - 0.5) * shakeIntensity * 0.5,
      (Math.random() - 0.5) * shakeIntensity
    );
    camera.position.add(_shakeOffset);
    if (shakeIntensity < 0.001) shakeIntensity = 0;
  }

  // ── Tour automático ──────────────────────────────────────────────────────
  if (tourActive && !isAnimating && !window._leakActive) {
    tourTimer -= delta;
    if (tourTimer <= 0) {
      tourIndex = (tourIndex + 1) % TOUR_SEQUENCE.length;
      goToView(TOUR_SEQUENCE[tourIndex]);
      tourTimer = TOUR_PAUSE;
    }

    // Progress bar del tour (si existe)
    const pb = document.getElementById('tour-progress-bar');
    if (pb) {
      const pct = ((TOUR_PAUSE - Math.max(tourTimer, 0)) / TOUR_PAUSE) * 100;
      pb.style.width = pct + '%';
    }
  }

  // ── Minimap ──────────────────────────────────────────────────────────────
  _updateMinimap();

  controls.update();
}

// ─── Ir a una vista ───────────────────────────────────────────────────────────
export function goToView(name, customTarget = null, customPos = null) {
  _pushHistory();

  // Blend desde posición actual (no desde el destino anterior)
  fromPos.copy(camera.position);
  fromTarget.copy(controls.target);

  if (name === 'custom') {
    destPos.copy(customPos);
    destTarget.copy(customTarget);
  } else {
    if (!VIEWS[name]) {
      console.warn(`goToView: vista "${name}" no existe.`);
      return;
    }
    destPos.copy(VIEWS[name].pos);
    destTarget.copy(VIEWS[name].target);
    _setActiveButton(name);
    _showViewLabel(VIEWS[name].label);
  }

  // Duración proporcional a la distancia — movimientos más cortos son más rápidos
  const dist     = fromPos.distanceTo(destPos);
  animDuration   = THREE.MathUtils.clamp(0.9 + dist * 0.022, 0.9, 2.6);
  isAnimating    = true;
  animElapsed    = 0;
  animProgress   = 0;
}

// ─── Volver a la vista anterior ───────────────────────────────────────────────
export function goBack() {
  if (camHistory.length === 0) return;
  const prev = camHistory.pop();
  fromPos.copy(camera.position);
  fromTarget.copy(controls.target);
  destPos.copy(prev.pos);
  destTarget.copy(prev.target);
  const dist   = fromPos.distanceTo(destPos);
  animDuration = THREE.MathUtils.clamp(0.8 + dist * 0.018, 0.7, 2.0);
  isAnimating  = true;
  animElapsed  = 0;
  _updateBackButton();
}

// ─── Tour automático ──────────────────────────────────────────────────────────
export function startTour() {
  if (window._leakActive) return;
  tourActive = true;
  tourIndex  = 0;
  tourTimer  = 0;
  goToView(TOUR_SEQUENCE[0]);
  _setTourButtonState(true);
  _injectTourProgressBar();
}

export function stopTour() {
  tourActive = false;
  _setTourButtonState(false);
  _removeTourProgressBar();
}

export function isTourActive() { return tourActive; }

// ─── Shake de cámara ─────────────────────────────────────────────────────────
// intensity: magnitud máxima (0.01 = sutil, 0.1 = fuerte)
// duration: segundos (solo controla la amplitud inicial, el decay es automático)
export function triggerCameraShake(intensity = 0.05, duration = 0.5) {
  shakeIntensity = intensity;
  // Reducir en base a duration: asignar un decay más rápido o lento
  // El decay (0.88 por frame a 60fps) tarda ~1.5s en llegar a 0 con intensidad=0.05
  // Con duration podemos escalar la intensidad inicial
  shakeIntensity = intensity * Math.min(duration * 2, 1.5);
}

// ─── Getters públicos ─────────────────────────────────────────────────────────
export function isCameraAnimating()  { return isAnimating; }
export function getCameraPosition()  { return camera?.position.clone(); }
export function getCameraTarget()    { return controls?.target.clone(); }

export function registerView(name, pos, target, label = name) {
  VIEWS[name] = {
    pos:    new THREE.Vector3().copy(pos),
    target: new THREE.Vector3().copy(target),
    label,
  };
}

// ─── Privados: interacción ────────────────────────────────────────────────────
function _onUserInteractionStart() {
  if (isAnimating) {
    // Blend suave: el destino queda donde iba pero paramos la animación
    // La cámara "aterriza" donde está en ese momento
    isAnimating = false;
    animElapsed = 0;
    // No copiamos destPos a la posición — simplemente dejamos de mover
    // OrbitControls continúa desde aquí con damping natural
  }
  if (tourActive) stopTour();
}

function _handleKeydown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const key = e.key;

  // Vistas numéricas
  if (key === '1') { goToView('general');  return; }
  if (key === '2') { goToView('plant');    return; }
  if (key === '3') { goToView('network');  return; }
  if (key === '4') { goToView('cabins');   return; }
  if (key === '5') { goToView('main');     return; }
  if (key === '6') { goToView('lobby');    return; }

  // Reset
  if (key === 'r' || key === 'R') { goToView('general'); return; }

  // Volver atrás
  if (key === 'Backspace' || key === 'b' || key === 'B') { goBack(); return; }

  // Tour
  if (key === 't' || key === 'T') {
    tourActive ? stopTour() : startTour();
    return;
  }

  // Zoom suave con teclado
  if ((key === '+' || key === '=') && camera) {
    _smoothZoom(-3);
    return;
  }
  if (key === '-' && camera) {
    _smoothZoom(3);
    return;
  }

  // Pantalla completa del canvas
  if (key === 'f' || key === 'F') {
    const canvas = document.getElementById('three-canvas');
    if (canvas) {
      if (!document.fullscreenElement) canvas.requestFullscreen?.();
      else document.exitFullscreen?.();
    }
    return;
  }

  // Panel de atajos
  if (key === '?') {
    const panel = document.getElementById('shortcut-panel');
    if (panel) {
      const visible = panel.style.display !== 'none';
      panel.style.display = visible ? 'none' : 'block';
    }
  }
}

function _smoothZoom(amount) {
  if (!camera || !controls) return;
  const dir = amount < 0
    ? controls.target.clone().sub(camera.position).normalize()
    : camera.position.clone().sub(controls.target).normalize();
  camera.position.addScaledVector(dir, Math.abs(amount));
  controls.update();
}

// ─── Privados: historial ──────────────────────────────────────────────────────
function _pushHistory() {
  if (!camera) return;
  camHistory.push({
    pos:    camera.position.clone(),
    target: controls.target.clone(),
  });
  if (camHistory.length > CAM_HISTORY_MAX) camHistory.shift();
  _updateBackButton();
}

function _updateBackButton() {
  const btn = document.getElementById('btn-cam-back');
  if (!btn) return;
  const hasHistory = camHistory.length > 0;
  btn.style.opacity = hasHistory ? '1' : '0.35';
  btn.disabled = !hasHistory;
}

// ─── Privados: UI ─────────────────────────────────────────────────────────────
function _hideCanvasTooltip() {
  const tip = document.getElementById('canvas-tooltip');
  if (tip) {
    tip.style.transition = 'opacity 1.2s ease';
    tip.style.opacity = '0';
    setTimeout(() => tip.classList.add('hidden'), 1200);
  }
}

// Actualiza el botón activo en la sidebar (.sb-btn) y el antiguo (.cam-btn)
function _setActiveButton(name) {
  const idMap = {
    general: 'btn-general',
    plant:   'btn-plant',
    network: 'btn-network',
    cabins:  'btn-cabins',
    main:    'btn-main',
  };

  // Quitar activo de vistas (no tocar btn-fuga, btn-xray, etc.)
  const viewIds = Object.values(idMap);
  viewIds.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.classList.remove('active', 'sb-active');
  });

  const target = document.getElementById(idMap[name]);
  if (target) target.classList.add('sb-active', 'active');
}

// Toast flotante con el nombre de la vista
let _labelTimeout;
function _showViewLabel(label) {
  let toast = document.getElementById('cam-view-label');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'cam-view-label';
    toast.style.cssText = `
      position:absolute; bottom:2.5rem; left:50%; transform:translateX(-50%);
      background:rgba(15,28,20,.88); color:#ddb85a;
      font-family:'Playfair Display',serif; font-size:0.8rem;
      letter-spacing:0.15em; text-transform:uppercase;
      padding:0.38rem 1.3rem; border-radius:20px;
      border:1px solid rgba(184,144,58,.35);
      pointer-events:none; z-index:20;
      opacity:0; transition:opacity 0.25s ease;
      white-space:nowrap;
    `;
    document.querySelector('.canvas-wrap')?.appendChild(toast);
  }
  toast.textContent = label;
  toast.style.opacity = '1';
  clearTimeout(_labelTimeout);
  _labelTimeout = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
}

// Sincroniza el botón de tour con la sidebar
function _setTourButtonState(active) {
  const btn = document.getElementById('btn-tour');
  if (!btn) return;
  btn.classList.toggle('sb-active', active);
  const label = btn.querySelector('.sb-label');
  const icon  = btn.querySelector('.sb-icon');
  if (label) label.textContent = active ? 'Detener Tour' : 'Tour Automático';
  if (icon)  icon.textContent  = active ? '⏹' : '▶';
  // Fallback si no tiene estructura sb-btn
  if (!label) btn.innerHTML = active ? '⏹ Detener Tour' : '▶ Tour Automático';
}

function _dispatchCameraArrived() {
  window.dispatchEvent(new CustomEvent('camera:arrived'));
}

// ─── Barra de progreso del tour ───────────────────────────────────────────────
function _injectTourProgressBar() {
  if (document.getElementById('tour-progress-bar')) return;
  const wrap = document.querySelector('.canvas-wrap');
  if (!wrap) return;

  const bar = document.createElement('div');
  bar.style.cssText = `
    position:absolute; bottom:0; left:0; right:0; height:2px;
    background:rgba(184,144,58,.15); z-index:25; pointer-events:none;
  `;
  const inner = document.createElement('div');
  inner.id = 'tour-progress-bar';
  inner.style.cssText = `
    height:100%; width:0%;
    background:rgba(184,144,58,.7);
    transition:width 0.1s linear;
  `;
  bar.appendChild(inner);
  wrap.appendChild(bar);
  bar.id = 'tour-progress-wrap';
}

function _removeTourProgressBar() {
  document.getElementById('tour-progress-wrap')?.remove();
}

// ─── Minimap ──────────────────────────────────────────────────────────────────
let minimapDot, minimapEl;

function _buildMinimap(wrapper) {
  if (!wrapper) return;

  const map = document.createElement('div');
  map.id = 'cam-minimap';
  // Pegado al canvas a la izquierda abajo (no centrado — evita solaparse con tooltip)
  map.style.cssText = `
    position:absolute; bottom:1.0rem; left:0.8rem;
    width:110px; height:75px;
    background:rgba(8,15,10,.78);
    border:1px solid rgba(184,144,58,.3);
    border-radius:5px; z-index:10;
    overflow:hidden; pointer-events:none;
  `;

  map.innerHTML = `
    <svg width="110" height="75" viewBox="-40 -35 80 75" style="position:absolute;inset:0">
      <!-- Mar -->
      <rect x="19" y="-35" width="25" height="75" fill="rgba(25,80,120,.55)" rx="0"/>
      <!-- Calles -->
      <rect x="-40" y="-9" width="58" height="4.5" fill="rgba(70,65,55,.6)"/>
      <rect x="-16" y="-20" width="3.5" height="55" fill="rgba(70,65,55,.6)"/>
      <!-- Casitas fila norte -->
      <rect x="-12" y="2" width="4" height="4" fill="rgba(235,228,208,.45)" rx="0.8"/>
      <rect x="-5"  y="2" width="4" height="4" fill="rgba(235,228,208,.45)" rx="0.8"/>
      <rect x="3"   y="2" width="4" height="4" fill="rgba(235,228,208,.45)" rx="0.8"/>
      <!-- Casitas fila sur -->
      <rect x="-12" y="11" width="4" height="4" fill="rgba(235,228,208,.45)" rx="0.8"/>
      <rect x="-5"  y="11" width="4" height="4" fill="rgba(235,228,208,.45)" rx="0.8"/>
      <rect x="3"   y="11" width="4" height="4" fill="rgba(235,228,208,.45)" rx="0.8"/>
      <!-- Casa principal -->
      <rect x="-5" y="-18" width="10" height="7" fill="rgba(245,240,228,.5)" rx="0.8"/>
      <!-- Planta desalinizadora -->
      <rect x="10" y="-10" width="8" height="5" fill="rgba(205,195,178,.5)" rx="0.8"/>
      <!-- Montaña/cerro -->
      <ellipse cx="0" cy="-34" rx="10" ry="7" fill="rgba(170,148,98,.45)"/>
      <!-- Estanque -->
      <circle cx="0" cy="-34" r="2.5" fill="rgba(74,124,111,.75)"/>
    </svg>

    <!-- Punto de cámara -->
    <div id="minimap-dot" style="
      position:absolute; width:6px; height:6px;
      background:#ddb85a; border-radius:50%;
      border:1px solid rgba(255,220,100,.9);
      box-shadow:0 0 5px rgba(221,184,90,.7);
      transform:translate(-50%,-50%);
      transition:left 0.12s ease, top 0.12s ease;
      pointer-events:none;
    "></div>

    <!-- Etiqueta de posición de cámara -->
    <div id="minimap-label" style="
      position:absolute; bottom:2px; right:4px;
      font-size:8px; color:rgba(184,144,58,.6);
      font-family:'Crimson Pro',serif;
      pointer-events:none; letter-spacing:.04em;
    "></div>
  `;

  wrapper.appendChild(map);
  minimapDot = document.getElementById('minimap-dot');
  minimapEl  = map;
}

function _updateMinimap() {
  if (!minimapDot || !camera) return;

  // Rango de escena: X [-40, 22], Z [-38, 40] → canvas 110×75
  const nx = (camera.position.x + 40) / 62;
  const nz = (camera.position.z + 38) / 78;

  const px = Math.max(4, Math.min(106, nx * 110));
  const py = Math.max(4, Math.min(71,  nz * 75));

  minimapDot.style.left = px + 'px';
  minimapDot.style.top  = py + 'px';

  // Mostrar altitude como opacidad del dot
  const alt = THREE.MathUtils.clamp((camera.position.y - 5) / 40, 0, 1);
  minimapDot.style.opacity = 0.5 + alt * 0.5;

  // Label altura
  const lbl = document.getElementById('minimap-label');
  if (lbl) lbl.textContent = `↑${camera.position.y.toFixed(0)}m`;
}

// ─── Panel de atajos ──────────────────────────────────────────────────────────
function _buildShortcutHint(wrapper) {
  if (!wrapper) return;

  const btn = document.createElement('button');
  btn.id    = 'btn-shortcuts';
  btn.textContent = '?';
  btn.title = 'Atajos de teclado (tecla ?)';
  btn.style.cssText = `
    position:absolute; top:0.6rem; right:0.6rem;
    width:26px; height:26px; border-radius:50%;
    background:rgba(15,28,20,.80); color:rgba(184,144,58,.85);
    border:1px solid rgba(184,144,58,.35);
    font-size:0.82rem; font-weight:700; cursor:pointer;
    z-index:20; display:flex; align-items:center; justify-content:center;
    transition:background .18s, color .18s;
    font-family:'Playfair Display',serif;
  `;

  const panel = document.createElement('div');
  panel.id = 'shortcut-panel';
  panel.style.cssText = `
    position:absolute; top:2.4rem; right:0.6rem;
    background:rgba(8,18,12,.94);
    border:1px solid rgba(184,144,58,.3);
    border-radius:6px; padding:0.8rem 1.1rem;
    color:rgba(240,234,216,.8); font-family:'Crimson Pro',serif;
    font-size:0.8rem; line-height:2;
    z-index:21; display:none; min-width:210px;
    pointer-events:none;
    box-shadow:0 8px 24px rgba(0,0,0,.4);
  `;
  panel.innerHTML = `
    <div style="color:#ddb85a;font-family:'Playfair Display',serif;font-size:.74rem;
      letter-spacing:.12em;text-transform:uppercase;margin-bottom:.35rem;
      padding-bottom:.35rem;border-bottom:1px solid rgba(184,144,58,.2)">
      Atajos de Teclado
    </div>
    <div><kbd>1</kbd> Vista General</div>
    <div><kbd>2</kbd> Planta Desalinizadora</div>
    <div><kbd>3</kbd> Cerro y Estanque</div>
    <div><kbd>4</kbd> Zona de Cabañas</div>
    <div><kbd>5</kbd> Casa Principal</div>
    <div><kbd>6</kbd> Acceso Principal</div>
    <div style="margin-top:.3rem;padding-top:.3rem;border-top:1px solid rgba(184,144,58,.1)">
      <kbd>R</kbd> Resetear cámara
    </div>
    <div><kbd>B</kbd> Vista anterior</div>
    <div><kbd>T</kbd> Tour automático</div>
    <div><kbd>N</kbd> Noche / Día</div>
    <div><kbd>U</kbd> Simular fuga</div>
    <div><kbd>X</kbd> Radiografía tuberías</div>
    <div><kbd>P</kbd> Mostrar/ocultar tuberías</div>
    <div><kbd>F</kbd> Pantalla completa</div>
    <div><kbd>+</kbd> / <kbd>−</kbd> Zoom</div>
    <div><kbd>?</kbd> Mostrar/ocultar esto</div>
  `;

  // Toggle al hacer hover O al hacer click (más accesible)
  let pinned = false;
  btn.addEventListener('click', () => {
    pinned = !pinned;
    panel.style.display = pinned ? 'block' : 'none';
    btn.style.background = pinned ? 'rgba(184,144,58,.25)' : 'rgba(15,28,20,.80)';
  });
  btn.addEventListener('mouseenter', () => { if (!pinned) panel.style.display = 'block'; });
  btn.addEventListener('mouseleave', () => { if (!pinned) panel.style.display = 'none'; });

  wrapper.appendChild(btn);
  wrapper.appendChild(panel);
}

// ─── Easing v2 ────────────────────────────────────────────────────────────────
// easeInOutQuint — más suave en la salida y llegada que el cúbico original
function _easeInOutQuint(t) {
  return t < 0.5
    ? 16 * t * t * t * t * t
    : 1 - Math.pow(-2 * t + 2, 5) / 2;
}