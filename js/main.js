import { initThree }    from './scene.js';
import { simulateLeak } from './leaks.js';
import { goToView, goBack, startTour, stopTour, isTourActive } from './controls.js';

/* ═══════════════════════════════════════════════════════════════════════════
   main.js  —  Orquestador único de pestañas, botones y eventos globales.
   Los atajos de teclado y sidebars viven en el <script> inline del HTML
   para evitar dependencias de módulos.
   ═══════════════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  //  PESTAÑAS
  // ═══════════════════════════════════════════════════════════════════════════
  const tabs     = document.querySelectorAll('.nav-tab');
  // FIX: Use explicit IDs — querySelectorAll('.section') also selects
  // sidebar sb-section elements and breaks the tab switcher
  const SECTION_IDS = ['section-comic', 'section-3d', 'section-cdm'];
  let threeReady = false;

  const TAB_MAP = {
    'tab-comic': 'section-comic',
    'tab-3d':    'section-3d',
    'tab-cdm':   'section-cdm',
  };

  function switchTab(tabId) {
    const targetId = TAB_MAP[tabId];
    if (!targetId) return;

    // Only touch the three main content sections — never the sidebar sections
    tabs.forEach(t => t.classList.remove('active'));
    SECTION_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });

    document.getElementById(tabId)?.classList.add('active');
    document.getElementById(targetId)?.classList.add('active');

    // Inicializar Three.js solo la primera vez que se abre la pestaña 3D
    if (targetId === 'section-3d' && !threeReady) {
      threeReady = true;

      // Loader visual
      const wrap = document.querySelector('.canvas-wrap');
      if (wrap) {
        const loader = document.createElement('div');
        loader.id = 'three-loader';
        loader.style.cssText = [
          'position:absolute;inset:0;z-index:50;',
          'background:rgba(27,61,45,.92);',
          'display:flex;flex-direction:column;',
          'align-items:center;justify-content:center;gap:1rem;',
          'transition:opacity 0.5s ease;',
        ].join('');
        loader.innerHTML = `
          <div style="width:40px;height:40px;border-radius:50%;
            border:3px solid rgba(184,144,58,.3);border-top-color:#ddb85a;
            animation:spin .8s linear infinite;"></div>
          <div style="color:#ddb85a;font-family:'Playfair Display',serif;
            font-size:.9rem;letter-spacing:.1em;">Cargando Maqueta 3D…</div>`;

        if (!document.getElementById('spin-kf')) {
          const s = document.createElement('style');
          s.id = 'spin-kf';
          s.textContent = '@keyframes spin{to{transform:rotate(360deg)}}';
          document.head.appendChild(s);
        }
        wrap.appendChild(loader);

        window.addEventListener('camera:arrived', () => {
          loader.style.opacity = '0';
          setTimeout(() => loader.remove(), 500);
        }, { once: true });
      }

      // Pequeño delay para que el layout se estabilice
      setTimeout(initThree, 120);
    }

    // Guardar pestaña en URL
    history.replaceState(null, '', `#${tabId}`);
  }

  tabs.forEach(tab => tab.addEventListener('click', () => switchTab(tab.id)));

  // Restaurar pestaña desde hash al cargar
  const hashTab = location.hash.replace('#', '');
  if (hashTab && TAB_MAP[hashTab]) {
    switchTab(hashTab);
  }

  // Navegación con flechas izquierda / derecha entre pestañas
  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const allTabs = [...tabs];
    const active  = document.querySelector('.nav-tab.active');
    const idx     = allTabs.indexOf(active);
    const next    = e.key === 'ArrowRight'
      ? allTabs[(idx + 1) % allTabs.length]
      : allTabs[(idx - 1 + allTabs.length) % allTabs.length];
    next?.click();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ATAJOS DE TECLADO (solo los que necesitan importaciones de módulos)
  //  El resto (ripple, sidebar, observer) está en el script inline del HTML
  // ═══════════════════════════════════════════════════════════════════════════
  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    // Vistas de cámara — solo si Three.js está listo
    if (!threeReady) return;

    const viewMap = { '1':'general', '2':'plant', '3':'network', '4':'cabins', '5':'main', '6':'lobby' };
    if (viewMap[e.key]) { goToView(viewMap[e.key]); return; }

    // N → modo noche/día
    if (e.key === 'n' || e.key === 'N') {
      document.getElementById('btn-day-night')?.click(); return;
    }
    // T → tour  (controls.js también maneja T y actualiza el estado del botón,
    //             eliminamos el handler duplicado aquí para evitar doble toggle)
    // F → fuga  (controls.js usa F para fullscreen; usamos U para fUga)
    if (e.key === 'u' || e.key === 'U') {
      document.getElementById('btn-fuga')?.click(); return;
    }
    // X → radiografía / x-ray  (controls.js usa R para resetear cámara)
    if (e.key === 'x' || e.key === 'X') {
      document.getElementById('btn-xray')?.click(); return;
    }
    // Tuberías
    if (e.key === 'p' || e.key === 'P') {
      document.getElementById('btn-toggle-pipes')?.click(); return;
    }
    // ESC → vista general o detener fuga/tour
    if (e.key === 'Escape') {
      if (window._leakActive) { document.getElementById('btn-fuga')?.click(); return; }
      if (isTourActive())     { stopTour(); return; }
      goToView('general');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BOTONES DE CÁMARA
  // ═══════════════════════════════════════════════════════════════════════════
  document.getElementById('btn-general')?.addEventListener('click', () => goToView('general'));
  document.getElementById('btn-plant')?.addEventListener('click',   () => goToView('plant'));
  document.getElementById('btn-network')?.addEventListener('click', () => goToView('network'));
  document.getElementById('btn-cabins')?.addEventListener('click',  () => goToView('cabins'));
  document.getElementById('btn-main')?.addEventListener('click',    () => goToView('main'));
  document.getElementById('btn-lobby')?.addEventListener('click',   () => goToView('lobby'));
  document.getElementById('btn-fuga')?.addEventListener('click', simulateLeak);

  // Botones extra del sidebar
  document.getElementById('btn-cam-back')?.addEventListener('click', goBack);
  document.getElementById('btn-tour')?.addEventListener('click', () => {
    const active = isTourActive();
    active ? stopTour() : startTour();
    const btn = document.getElementById('btn-tour');
    if (btn) {
      btn.classList.toggle('sb-active', !active);
      const label = btn.querySelector('.sb-label');
      if (label) label.textContent = active ? 'Tour Automático' : 'Detener Tour';
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ONBOARDING — primera carga de la sesión
  // ═══════════════════════════════════════════════════════════════════════════
  if (!sessionStorage.getItem('plv_onboarding_seen')) {
    sessionStorage.setItem('plv_onboarding_seen', '1');

    if (!document.getElementById('toast-kf')) {
      const s = document.createElement('style');
      s.id = 'toast-kf';
      s.textContent = `@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(12px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}`;
      document.head.appendChild(s);
    }

    const toast = document.createElement('div');
    toast.style.cssText = [
      'position:fixed;bottom:2rem;left:50%;transform:translateX(-50%);',
      'background:rgba(27,61,45,.95);color:#fff;',
      "font-family:'Crimson Pro',serif;font-size:.95rem;line-height:1.6;",
      'padding:1rem 2rem;border-radius:8px;text-align:center;',
      'border:1px solid rgba(184,144,58,.5);',
      'box-shadow:0 8px 32px rgba(0,0,0,.3);',
      'z-index:9999;max-width:520px;width:90%;',
      'animation:toastIn .4s ease both;',
    ].join('');
    toast.innerHTML = `
      <div style="color:#ddb85a;font-family:'Playfair Display',serif;font-weight:700;font-size:1.05rem;margin-bottom:.3rem">
        Bienvenido al Sistema Hídrico 3D
      </div>
      Explora el complejo turístico Playa La Virgen · Navega las pestañas
      para ver el cómic, la maqueta interactiva y el análisis CDM.
      <div style="margin-top:.5rem;font-size:.78rem;opacity:.6">
        Usa ← → para cambiar de pestaña · ? para ver atajos de teclado
      </div>`;
    document.body.appendChild(toast);

    const dismiss = () => {
      toast.style.transition = 'opacity .4s';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 400);
      document.removeEventListener('click', dismiss);
    };
    setTimeout(dismiss, 6000);
    document.addEventListener('click', dismiss);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  EXPORTACIÓN  Ctrl+Shift+P → PNG  |  Ctrl+P → PDF
  // ═══════════════════════════════════════════════════════════════════════════
  function _toast(title, body, ms = 2500) {
    const el = document.getElementById('status-toast');
    if (el) el.remove();
    const t = document.createElement('div');
    t.id = 'status-toast';
    t.style.cssText = [
      'position:fixed;top:1.5rem;left:50%;transform:translateX(-50%);',
      'background:rgba(27,61,45,.97);color:#fff;',
      "font-family:'Crimson Pro',serif;font-size:.9rem;line-height:1.5;",
      'padding:.9rem 1.8rem;border-radius:8px;text-align:center;',
      'border:1px solid rgba(184,144,58,.5);',
      'box-shadow:0 6px 24px rgba(0,0,0,.35);',
      'z-index:99999;max-width:420px;width:90%;',
      'animation:toastIn .3s ease both;',
    ].join('');
    t.innerHTML = `<div style="color:#ddb85a;font-family:'Playfair Display',serif;font-weight:700;margin-bottom:.25rem">${title}</div><div style="font-size:.82rem;opacity:.85">${body}</div>`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.transition='opacity .35s'; t.style.opacity='0'; setTimeout(()=>t.remove(),350); }, ms);
  }

  document.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    if (e.shiftKey && e.key === 'P') {
      e.preventDefault();
      const canvas = document.getElementById('three-canvas');
      if (!canvas) { _toast('⚠️ Canvas no disponible', 'Abre primero la sección Maqueta 3D.'); return; }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try {
          const a = document.createElement('a');
          a.download = `maqueta-3D-${new Date().toLocaleDateString('es-CL').replace(/\//g,'-')}.png`;
          a.href = canvas.toDataURL('image/png');
          a.click();
          _toast('✅ Captura descargada', 'Imagen PNG guardada correctamente.', 2800);
        } catch {
          _toast('⚠️ Error de captura', 'Ejecuta desde localhost para evitar restricciones CORS.', 3500);
        }
      }));
    } else if (!e.shiftKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      _toast('📄 Preparando PDF…', "Elige «Guardar como PDF» en el diálogo de impresión.", 1800);
      setTimeout(() => window.print(), 1900);
    }
  });

});