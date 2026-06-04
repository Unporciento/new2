import * as THREE from 'three';
import { initControls, updateControls } from './controls.js';
import { initLeaks, updateLeaks } from './leaks.js';

export function initThree() {
  const canvas  = document.getElementById('three-canvas');
  const wrapper = canvas.parentElement;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
  // Subtle tone mapping improves realism without shader rewrites
  renderer.toneMapping       = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xcec9bc); // init so .copy() works in updateDayNight
  scene.fog = new THREE.FogExp2(0xcec9bc, 0.006);

  const camera = new THREE.PerspectiveCamera(45, wrapper.clientWidth / wrapper.clientHeight, 0.1, 300);
  camera.position.set(0, 52, 70);
  initControls(camera, renderer.domElement);

  // ═══════════════════════════════════════════════════════════════════════════
  //  SISTEMA DÍA / NOCHE
  // ═══════════════════════════════════════════════════════════════════════════
  let isNight = false;

  // Colores de fondo
  const DAY_FOG   = new THREE.Color(0xcec9bc);
  const NIGHT_FOG = new THREE.Color(0x0a0e1a);
  const DAY_BG    = new THREE.Color(0xcec9bc);
  const NIGHT_BG  = new THREE.Color(0x0a0e1a);

  // Luz ambiental
  const ambientLight = new THREE.AmbientLight(0xf0ebe0, 0.75);
  scene.add(ambientLight);

  // Sol (DirectionalLight)
  const sunLight = new THREE.DirectionalLight(0xfff4d0, 2.2);
  sunLight.position.set(20, 60, 30);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(1024, 1024); // was 2048 — halves shadow GPU cost
  sunLight.shadow.camera.left   = -75;
  sunLight.shadow.camera.right  =  75;
  sunLight.shadow.camera.top    =  75;
  sunLight.shadow.camera.bottom = -75;
  sunLight.shadow.camera.near   =  1;
  sunLight.shadow.camera.far    = 200;
  sunLight.shadow.camera.updateProjectionMatrix();
  scene.add(sunLight);

  // Luna (DirectionalLight tenue azulada)
  const moonLight = new THREE.DirectionalLight(0x8899cc, 0);
  moonLight.position.set(-20, 40, -20);
  scene.add(moonLight);

  // Astro visual (sol o luna) — esfera que se desplaza en arco
  const sunSphere = new THREE.Mesh(
    new THREE.SphereGeometry(2.8, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffe877 })
  );
  sunSphere.position.set(20, 60, -60);
  scene.add(sunSphere);
  // Corona/halo del sol pulsante — hijo de sunSphere (sigue su posición automáticamente)
  const sunHaloMat = new THREE.MeshBasicMaterial({
    color: 0xfff0aa, transparent: true, opacity: 0.08, side: THREE.BackSide,
  });
  const sunHalo = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 10), sunHaloMat);
  sunSphere.add(sunHalo);

  const moonSphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.8, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xdde8ff })
  );
  moonSphere.position.set(-20, 40, -60);
  moonSphere.visible = false;
  scene.add(moonSphere);

  let rainbowTimer = 0;

  // Estrellas (solo de noche)
  const starGeo = new THREE.BufferGeometry();
  const starCount = 300;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1) * 0.45; // solo hemisferio superior
    const r     = 200;
    starPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) + 10;
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.6, sizeAttenuation: true })
  );
  stars.visible = false;
  scene.add(stars);

  // ── Transición día/noche ──────────────────────────────────────────────────
  let dayNightProgress = 0;  // 0 = día, 1 = noche (se interpola suavemente)
  let dayNightTarget   = 0;

  window._toggleDayNight = toggleDayNight;
  function toggleDayNight() {
    isNight = !isNight;
    dayNightTarget = isNight ? 1 : 0;
    const _dnLbl = btnDayNight.querySelector?.('.sb-label');
    if (_dnLbl) { _dnLbl.textContent = isNight ? 'Modo Día' : 'Modo Noche'; }
    else btnDayNight.innerHTML = isNight ? '☀️ Modo Día' : '🌙 Modo Noche';
    stars.visible      = isNight;
    moonSphere.visible = isNight;
    sunSphere.visible  = !isNight;
    // MEJORA 2: Arcoíris breve al volver al día

  }

  function updateDayNight(delta) {
    if (Math.abs(dayNightProgress - dayNightTarget) < 0.001) return;
    dayNightProgress += (dayNightTarget - dayNightProgress) * Math.min(delta * 1.2, 1);

    const t = dayNightProgress;

    // Fondo y niebla
    scene.background.copy(DAY_BG).lerp(NIGHT_BG, t);
    scene.fog.color.copy(DAY_FOG).lerp(NIGHT_FOG, t);

    // Luces
    ambientLight.intensity = THREE.MathUtils.lerp(0.75, 0.08, t);
    ambientLight.color.set(t < 0.5 ? 0xf0ebe0 : 0x2233aa);
    sunLight.intensity  = THREE.MathUtils.lerp(2.2, 0, t);
    moonLight.intensity = THREE.MathUtils.lerp(0, 0.6, t);

    // Postes de luz: se encienden de noche con más potencia
    streetLampLights.forEach(l => {
      l.intensity = THREE.MathUtils.lerp(0, 2.8, t);
    });
    // Halos y conos de luz visible
    lampHalos.forEach(mat => {
      mat.opacity = THREE.MathUtils.lerp(0, 0.10, t);
    });
    // Ventanas de las casas: se iluminan de noche
    windowGlows.forEach(m => {
      m.material.emissiveIntensity = THREE.MathUtils.lerp(0, 1.0, t);
    });
  }

  // ─── Límites ──────────────────────────────────────────────────────────────
  const LAND_MAX_X = 19;
  const SEA_START  = 20;

  // ─── Suelo ────────────────────────────────────────────────────────────────
  const mGround  = new THREE.MeshLambertMaterial({ color: 0xc4b28a });
  const ground   = new THREE.Mesh(new THREE.PlaneGeometry(110, 140), mGround);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-20, 0, 8);  // centrado en el resort ampliado (3 filas)
  ground.receiveShadow = true;
  scene.add(ground);

  const mBeach = new THREE.MeshLambertMaterial({ color: 0xd9cc98, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1 });
  const beach  = new THREE.Mesh(new THREE.PlaneGeometry(3, 110), mBeach);
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(SEA_START - 1.5, 0.01, 0);
  scene.add(beach);
  // Línea de marea
  const mWetSand = new THREE.MeshLambertMaterial({ color: 0xb8a878, transparent: true, opacity: 0.7, polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:1 });
  const wetSand  = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 110), mWetSand);
  wetSand.rotation.x = -Math.PI / 2;
  wetSand.position.set(SEA_START + 0.1, 0.02, 0);
  scene.add(wetSand);

  // ── ZONA DE PLAYA: Franja de arena amplia antes del mar ───────────────────
  const mBeachSand = new THREE.MeshLambertMaterial({ color: 0xe8d89a });
  const beachZone  = new THREE.Mesh(new THREE.PlaneGeometry(8, 70), mBeachSand);
  beachZone.rotation.x = -Math.PI / 2;
  beachZone.position.set(13, 0.01, 14);
  scene.add(beachZone);

  // ── Sombrillas de playa ────────────────────────────────────────────────────
  const mUmbrellaPost = new THREE.MeshLambertMaterial({ color: 0x8b6914 });
  const mUmbrellaTop  = [
    new THREE.MeshLambertMaterial({ color: 0xe84040 }),
    new THREE.MeshLambertMaterial({ color: 0x4080e8 }),
    new THREE.MeshLambertMaterial({ color: 0xe8c040 }),
  ];
  function buildUmbrella(px, pz, colorIdx = 0) {
    const g = new THREE.Group(); g.position.set(px, 0, pz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,1.8,6), mUmbrellaPost);
    pole.position.y = 0.9; g.add(pole);
    const top = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.4, 8, 1, true), mUmbrellaTop[colorIdx % 3]);
    top.position.y = 1.85; g.add(top);
    const mReposera = new THREE.MeshLambertMaterial({ color:0xf5e0b0 });
    [-0.55, 0.55].forEach(dx => {
      const chair = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 1.5), mReposera);
      chair.position.set(dx, 0.04, 0.2); g.add(chair);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.65), mReposera);
      back.rotation.x = -0.5; back.position.set(dx, 0.28, -0.6); g.add(back);
    });
    scene.add(g);
  }
  // Más sombrillas — 3 filas en la playa cubriendo toda la longitud del resort
  [
    [16, -5,0],[17, 0,1],[16, 5,2],[17,10,0],
    [16,15,1],[17,20,2],[16,25,0],[17,30,1],
    [15, 35,2],[16, 38,0],[17,42,1],[15,46,2],
  ].forEach(([x,z,c]) => buildUmbrella(x, z, c));

  // ── Botes decorativos en la playa ─────────────────────────────────────────
  (function buildBeachBoat(bx, bz, rotY = 0) {
    const g = new THREE.Group(); g.position.set(bx, 0, bz); g.rotation.y = rotY;
    const mBoat = new THREE.MeshLambertMaterial({ color: 0x8b5c2a });
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.9, 0.6, 8), mBoat);
    hull.position.y = 0.2; hull.scale.z = 2.2; hull.castShadow = true; g.add(hull);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.4), mBoat);
    seat.position.set(0, 0.52, 0); g.add(seat);
    // Remo (decorativo)
    const mOar = new THREE.MeshLambertMaterial({ color: 0xc49a6c });
    const oar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 2.2), mOar);
    oar.position.set(0.45, 0.5, 0); oar.rotation.z = 0.18; g.add(oar);
    scene.add(g);
  })(18, 30, 0.3);
  (function buildBeachBoat2(bx, bz, rotY = 0) {
    const g = new THREE.Group(); g.position.set(bx, 0, bz); g.rotation.y = rotY;
    const mBoat = new THREE.MeshLambertMaterial({ color: 0x5c7a3a });
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.8, 0.55, 8), mBoat);
    hull.position.y = 0.18; hull.scale.z = 2.0; hull.castShadow = true; g.add(hull);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.35), mBoat);
    seat.position.set(0, 0.48, 0); g.add(seat);
    scene.add(g);
  })(17, 8, -0.2);

  // ── Duchas de playa (junto a la transición playa-resort) ──────────────────
  const mShowerPole = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const mShowerHead = new THREE.MeshLambertMaterial({ color: 0x666666 });
  const mShowerBase = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
  function buildBeachShower(px, pz) {
    const g = new THREE.Group(); g.position.set(px, 0, pz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.07,2.4,8), mShowerPole);
    pole.position.y = 1.2; g.add(pole);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.6,6), mShowerPole);
    arm.rotation.z = Math.PI/2; arm.position.set(0.3,2.3,0); g.add(arm);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.22,0.12,8), mShowerHead);
    head.position.set(0.6, 2.28, 0); g.add(head);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28,0.32,0.12,8), mShowerBase);
    base.position.y = 0.06; g.add(base);
    const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,0.04,8), mShowerBase);
    drain.position.y = 0.03; g.add(drain);
    scene.add(g);
  }
  // 5 duchas de playa — distribuidas a lo largo de todo el frente de playa
  buildBeachShower(14,  2);
  buildBeachShower(14, 12);
  buildBeachShower(14, 22);
  buildBeachShower(14, 32);
  buildBeachShower(14, 42);

  // ─── Mar animado ──────────────────────────────────────────────────────────
  const seaVertexShader = `
    uniform float uTime;
    varying vec2  vUv;
    varying float vElevation;
    varying float vDistFromShore;
    void main() {
      vUv = uv;
      vDistFromShore = uv.x;
      vec3 pos = position;
      float depthFactor = smoothstep(0.0, 0.35, vDistFromShore);
      float wave1 = sin(pos.x * 0.14 + uTime * 0.9)  * 0.22 * depthFactor;
      float wave2 = sin(pos.z * 0.18 + uTime * 0.65) * 0.18 * depthFactor;
      float wave3 = sin((pos.x * 0.7 + pos.z * 0.5) * 0.10 + uTime * 1.2) * 0.12 * depthFactor;
      float rippleV = sin(pos.x * 0.55 + uTime * 2.1) * sin(pos.z * 0.45 + uTime * 1.8) * 0.04;
      pos.y += wave1 + wave2 + wave3 + rippleV;
      vElevation = wave1 + wave2 + wave3;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
  `;
  const seaFragmentShader = `
    uniform float uTime;
    uniform float uNight;
    varying vec2  vUv;
    varying float vElevation;
    varying float vDistFromShore;
    void main() {
      vec3 shoreColor = mix(vec3(0.38,0.82,0.78), vec3(0.05,0.12,0.25), uNight);
      vec3 midColor   = mix(vec3(0.10,0.55,0.72), vec3(0.03,0.08,0.20), uNight);
      vec3 deepColor  = mix(vec3(0.04,0.28,0.52), vec3(0.01,0.04,0.14), uNight);
      float d = vDistFromShore;
      vec3 col = mix(shoreColor, midColor,  smoothstep(0.0, 0.4, d));
      col      = mix(col,        deepColor, smoothstep(0.4, 1.0, d));
      float crest = smoothstep(0.10, 0.30, vElevation);
      col = mix(col, vec3(0.55,0.88,0.90), crest * 0.35 * (1.0 - uNight * 0.6));
      float foam = smoothstep(0.28, 0.38, vElevation);
      col = mix(col, vec3(0.92,0.97,1.00), foam * 0.7);
      float sunRefl = pow(max(vElevation,0.0),2.5) * smoothstep(0.5,1.0,vDistFromShore)*0.5;
      col += vec3(sunRefl*0.9, sunRefl*0.75, sunRefl*0.3) * (1.0 - uNight);
      // reflejo lunar de noche
      col += vec3(sunRefl*0.2, sunRefl*0.3, sunRefl*0.6) * uNight;
      float alpha = mix(0.60, 0.95, smoothstep(0.0, 0.3, d));
      gl_FragColor = vec4(col, alpha);
    }
  `;
  const seaUniforms = { uTime: { value: 0 }, uNight: { value: 0 } };
  const seaMat  = new THREE.ShaderMaterial({
    vertexShader: seaVertexShader, fragmentShader: seaFragmentShader,
    uniforms: seaUniforms, transparent: true, depthWrite: false, side: THREE.FrontSide,
  });
  const seaMesh = new THREE.Mesh(new THREE.PlaneGeometry(60, 130, 64, 64), seaMat);
  seaMesh.rotation.x = -Math.PI / 2;
  seaMesh.position.set(SEA_START + 30, -0.08, 0);
  scene.add(seaMesh);

  // ─── Materiales ───────────────────────────────────────────────────────────
  // polygonOffset eliminates z-fighting between coplanar road layers
  const mRoad     = new THREE.MeshLambertMaterial({ color: 0xbfaa7a, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1 }); // arena compacta
  const mPath     = new THREE.MeshLambertMaterial({ color: 0xd4c28a, polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:1 }); // arena fina
  const mRoadLine = new THREE.MeshLambertMaterial({ color: 0xe8d5a0, polygonOffset:true, polygonOffsetFactor:3, polygonOffsetUnits:1 }); // guias de piedra
  const mPlant    = new THREE.MeshLambertMaterial({ color: 0xddd7ca });
  const mRoof     = new THREE.MeshLambertMaterial({ color: 0x1b3d2d });
  const mRoofMain = new THREE.MeshLambertMaterial({ color: 0x2a5c40 });
  const mTank     = new THREE.MeshLambertMaterial({ color: 0x4a7c6f });
  const mTankRing = new THREE.MeshLambertMaterial({ color: 0x2e4f45 });
  const mTankCap  = new THREE.MeshLambertMaterial({ color: 0x3a6358 });
  const mResort   = new THREE.MeshLambertMaterial({ color: 0xf0ead8 });
  const mMain     = new THREE.MeshLambertMaterial({ color: 0xfaf5ec });
  const mWin      = new THREE.MeshLambertMaterial({ color: 0x223344, emissive: 0x000000 });
  const mDoor     = new THREE.MeshLambertMaterial({ color: 0x5c3d1e });
  const mSill     = new THREE.MeshLambertMaterial({ color: 0xd4c9a8 });
  const mTrunk    = new THREE.MeshLambertMaterial({ color: 0x8b6914 });
  const mLeaf     = new THREE.MeshLambertMaterial({ color: 0x2d6a1f, side: THREE.DoubleSide });
  const mCactus   = new THREE.MeshLambertMaterial({ color: 0x3a7a3a });
  const mRock     = new THREE.MeshLambertMaterial({ color: 0x9e9484 });
  const mHill     = new THREE.MeshLambertMaterial({ color: 0xb8a070 });
  const mHillDk   = new THREE.MeshLambertMaterial({ color: 0xa08860 });
  const mHuman    = new THREE.MeshLambertMaterial({ color: 0xf4a460 });
  const mGrass    = new THREE.MeshLambertMaterial({ color: 0x7a9a5a, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1 });
  const mCar      = new THREE.MeshLambertMaterial({ color: 0x8b2020 });
  const mGlass    = new THREE.MeshLambertMaterial({ color: 0x334455, transparent: true, opacity: 0.7 });
  const mWheel    = new THREE.MeshLambertMaterial({ color: 0x222222 });
  const mManhole  = new THREE.MeshLambertMaterial({ color: 0x666055 });

  // Material de tubería animada
  const pipeCanvas = document.createElement('canvas');
  pipeCanvas.width  = 64;
  pipeCanvas.height = 256;
  const pipeCtx = pipeCanvas.getContext('2d');
  function drawPipeTexture(offsetY) {
    pipeCtx.clearRect(0, 0, 64, 256);
    pipeCtx.fillStyle = '#b8903a';
    pipeCtx.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 5; i++) {
      const y = ((offsetY + i * 52) % 256);
      const grad = pipeCtx.createLinearGradient(0, y, 0, y + 28);
      grad.addColorStop(0,   'rgba(70,160,220,0)');
      grad.addColorStop(0.3, 'rgba(70,160,220,0.55)');
      grad.addColorStop(0.7, 'rgba(70,160,220,0.55)');
      grad.addColorStop(1,   'rgba(70,160,220,0)');
      pipeCtx.fillStyle = grad;
      pipeCtx.fillRect(0, y - 28, 64, 56);
    }
  }
  const pipeTex = new THREE.CanvasTexture(pipeCanvas);
  pipeTex.wrapS = THREE.RepeatWrapping;
  pipeTex.wrapT = THREE.RepeatWrapping;
  const mPipe = new THREE.MeshLambertMaterial({ map: pipeTex });

  // ── Textura XRAY — agua neón brillante animada ──────────────────────────────
  const xrayCanvas = document.createElement('canvas');
  xrayCanvas.width  = 64;
  xrayCanvas.height = 256;
  const xrayCtx = xrayCanvas.getContext('2d');
  function drawXrayTexture(offsetY) {
    xrayCtx.clearRect(0, 0, 64, 256);
    // Fondo oscuro translúcido del tubo
    xrayCtx.fillStyle = 'rgba(0, 30, 60, 0.92)';
    xrayCtx.fillRect(0, 0, 64, 256);
    // Reflejo lateral (efecto tubo cilíndrico)
    const sideGrad = xrayCtx.createLinearGradient(0, 0, 64, 0);
    sideGrad.addColorStop(0,    'rgba(0,180,255,0.08)');
    sideGrad.addColorStop(0.25, 'rgba(0,180,255,0.22)');
    sideGrad.addColorStop(0.5,  'rgba(0,220,255,0.06)');
    sideGrad.addColorStop(0.75, 'rgba(0,180,255,0.22)');
    sideGrad.addColorStop(1,    'rgba(0,180,255,0.08)');
    xrayCtx.fillStyle = sideGrad;
    xrayCtx.fillRect(0, 0, 64, 256);
    // Burbujas / pulsos de agua fluyendo — 6 ondas
    for (let i = 0; i < 6; i++) {
      const y = ((offsetY * 1.6 + i * 42) % 256);
      const grad = xrayCtx.createLinearGradient(0, y - 18, 0, y + 18);
      grad.addColorStop(0,    'rgba(0,220,255,0)');
      grad.addColorStop(0.35, 'rgba(0,220,255,0.85)');
      grad.addColorStop(0.5,  'rgba(180,240,255,1.0)');
      grad.addColorStop(0.65, 'rgba(0,220,255,0.85)');
      grad.addColorStop(1,    'rgba(0,220,255,0)');
      xrayCtx.fillStyle = grad;
      xrayCtx.fillRect(8, y - 18, 48, 36);
    }
    // Brillo central (highlight)
    const hGrad = xrayCtx.createLinearGradient(0, 0, 64, 0);
    hGrad.addColorStop(0.4, 'rgba(255,255,255,0)');
    hGrad.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    hGrad.addColorStop(0.6, 'rgba(255,255,255,0)');
    xrayCtx.fillStyle = hGrad;
    xrayCtx.fillRect(0, 0, 64, 256);
  }
  const xrayTex = new THREE.CanvasTexture(xrayCanvas);
  xrayTex.wrapS = THREE.RepeatWrapping;
  xrayTex.wrapT = THREE.RepeatWrapping;
  // Material para tuberías principales en modo XRAY
  const mPipeXray = new THREE.MeshBasicMaterial({
    map: xrayTex, transparent: true, opacity: 0.95, depthWrite: false,
  });
  // Material para red de distribución en modo XRAY (más tenue)
  const mPipeNetXray = new THREE.MeshBasicMaterial({
    map: xrayTex, transparent: true, opacity: 0.80, depthWrite: false,
  });
  let xrayTexOffset = 0;

  // ─── Layout ───────────────────────────────────────────────────────────────
  const HILL_CX    = -5;   // centro-oeste del resort
  const HILL_CZ    = -35;  // bien al fondo
  const HILL_TOP_Y =  5.2;

  // Arrays de meshes animados — declarados antes de cualquier uso
  const windowGlows      = [];
  const streetLampLights = [];
  const lampHalos        = [];

  // ─── Planta Desalinizadora (sobre muelle al borde del mar) ──────────────
  const signMat = new THREE.MeshLambertMaterial({ color: 0x1b3d2d });
  const mWoodPlant = new THREE.MeshLambertMaterial({ color: 0x7a5c3a });

  // Muelle de la planta (pilotes + tablones)
  const pierPlant = new THREE.Group();
  pierPlant.position.set(19, 0, -10);
  for (let i = 0; i < 6; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.55, 8), mWoodPlant);
    plank.position.set(i * 1.2 - 3, 0.28, 0); pierPlant.add(plank);
  }
  [[-2.5, -3],[2.5, -3],[-2.5, 3],[2.5, 3]].forEach(([px2,pz2]) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.14,1.4,6), mWoodPlant);
    post.position.set(px2, -0.4, pz2); pierPlant.add(post);
  });
  scene.add(pierPlant);

  // Edificio de la planta
  const plantG = new THREE.Group();
  plantG.position.set(20, 0.55, -10);
  const bldg = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 7), mPlant);
  bldg.position.y = 2; bldg.castShadow = true; bldg.receiveShadow = true;
  plantG.add(bldg);
  // Chimeneas
  [[-2.5, 1.5], [1.5, 1.5]].forEach(([ox, oz]) => {
    const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 3.2, 8), mPlant);
    ch.position.set(ox, 5.6, oz); ch.castShadow = true; plantG.add(ch);
  });
  // Tanque industrial de la planta
  const plantTank = new THREE.Mesh(new THREE.CylinderGeometry(0.9,0.9,2.5,12), mTank);
  plantTank.position.set(-3, 3.25, -2); plantG.add(plantTank);
  // Ventanas
  [[-2.5,2],[-0.5,2],[1.5,2]].forEach(([ox,oy]) => {
    const pw = new THREE.Mesh(new THREE.BoxGeometry(0.9,0.7,0.1),
      new THREE.MeshLambertMaterial({ color:0x223344, emissive:0xffcc66, emissiveIntensity:0 }));
    pw.position.set(ox, oy, 3.55); plantG.add(pw);
    windowGlows.push(pw);
  });
  // Cartel
  const sign = new THREE.Mesh(new THREE.BoxGeometry(5, 0.7, 0.1), signMat);
  sign.position.set(0, 4.6, 3.55); plantG.add(sign);
  scene.add(plantG);

  // Tubería toma de agua marina (planta → tierra)
  const mPipeSea = new THREE.MeshLambertMaterial({ color:0x336688 });
  const seaPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,6,8), mPipeSea);
  seaPipe.rotation.z = Math.PI/2; seaPipe.position.set(17, 0.5, -10); scene.add(seaPipe);

  // ─── Montaña ──────────────────────────────────────────────────────────────
  function buildMeseta(cx, cz) {
    const g = new THREE.Group(); g.position.set(cx, 0, cz);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(10, 15, 2.8, 18), mGround);
    base.position.y = 1.4; base.castShadow = true; base.receiveShadow = true; g.add(base);
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(7, 10, 2.0, 16), mHill);
    mid.position.y = 3.8; mid.castShadow = true; g.add(mid);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 7, 0.8, 16), mHillDk);
    top.position.y = 5.2; top.castShadow = true; g.add(top);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.2, 0.12, 18), mHill);
    cap.position.y = HILL_TOP_Y + 0.06; g.add(cap);
    scene.add(g);
  }
  buildMeseta(HILL_CX, HILL_CZ);

  // ─── Estanque ─────────────────────────────────────────────────────────────
  const TANK_R      = 3.0;
  const TANK_H      = 5.5;
  const TANK_BASE_Y = HILL_TOP_Y + 0.12;
  const TANK_CY     = TANK_BASE_Y + TANK_H / 2;

  function buildBigTank(wx, wz) {
    const g = new THREE.Group(); g.position.set(wx, TANK_CY, wz);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(TANK_R, TANK_R, TANK_H, 24), mTank);
    body.castShadow = true; g.add(body);
    const skirt = new THREE.Mesh(new THREE.CylinderGeometry(TANK_R, TANK_R + 0.8, 0.5, 24), mTankRing);
    skirt.position.y = -TANK_H / 2 - 0.15; g.add(skirt);
    [-2, 0, 2].forEach(ry => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(TANK_R + 0.06, 0.11, 8, 28), mTankRing);
      ring.rotation.x = Math.PI / 2; ring.position.y = ry; g.add(ring);
    });
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(TANK_R + 0.06, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2.1), mTankCap
    );
    dome.position.y = TANK_H / 2; dome.castShadow = true; g.add(dome);
    const vent = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.8, 8), mTankRing);
    vent.position.y = TANK_H / 2 + 2.0; g.add(vent);
    scene.add(g);
  }
  buildBigTank(HILL_CX, HILL_CZ);
  // MEJORA 6: Nivel de agua visible dentro del estanque (disco azul)
  const mWaterLevel = new THREE.MeshBasicMaterial({
    color: 0x2288cc, transparent: true, opacity: 0.75,
  });
  const waterDisc = new THREE.Mesh(new THREE.CylinderGeometry(TANK_R - 0.12, TANK_R - 0.12, 0.08, 20), mWaterLevel);
  waterDisc.position.set(HILL_CX, TANK_BASE_Y + TANK_H * 0.72, HILL_CZ);
  scene.add(waterDisc);
  // Ondita en el disco
  let waterDiscTimer = 0;

  // ─── Tuberías ─────────────────────────────────────────────────────────────
  function makePipe(from, to, r = 0.20) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.05) return null;
    const mid  = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    const geo  = new THREE.CylinderGeometry(r, r, len, 10, 12);
    const mesh = new THREE.Mesh(geo, mPipe);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.castShadow = true;
    scene.add(mesh);
    return mesh;
  }
  function makeCodo(x, y, z, r = 0.28) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 10), mPipe);
    m.position.set(x, y, z); scene.add(m);
  }
  function makeManhole(x, z) {
    // Manhole sits 0.06 above road (Y=0.02) → center at 0.05
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 14), mManhole);
    base.position.set(x, 0.05, z);
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.02, 0.06), mRock);
    b1.position.set(x, 0.09, z);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.48), mRock);
    b2.position.set(x, 0.09, z);
    scene.add(base); scene.add(b1); scene.add(b2);
  }

  // Tuberías principales: Tanque → Casa Central de Distribución
  const pTankOut  = new THREE.Vector3(HILL_CX + TANK_R * 0.5, TANK_BASE_Y, HILL_CZ);
  const pSlopeMid = new THREE.Vector3(HILL_CX + 2, 3.2, HILL_CZ + 9);
  const pHillFoot = new THREE.Vector3(HILL_CX, 0.3, HILL_CZ + 14);
  const pMainIn   = new THREE.Vector3(-8, 0.3, -18);  // Casa central de distribución
  makePipe(pTankOut, pSlopeMid, 0.28);
  makePipe(pSlopeMid, pHillFoot, 0.28);
  makePipe(pHillFoot, pMainIn, 0.28);
  makeCodo(pSlopeMid.x, pSlopeMid.y, pSlopeMid.z, 0.32);
  makeCodo(pHillFoot.x, pHillFoot.y, pHillFoot.z, 0.32);
  makeCodo(pMainIn.x, pMainIn.y, pMainIn.z, 0.32);

  // Tubería desalinizadora → Casa central
  const pPlant    = new THREE.Vector3(17, 0.5, -10);
  const pMainSide = new THREE.Vector3(-8, 0.3, -10);
  makePipe(pPlant, pMainSide, 0.22);
  makeCodo(pMainSide.x, pMainSide.y, pMainSide.z, 0.26);

  // Red de distribución (toggle)
  const pipeNetGroup = new THREE.Group();
  scene.add(pipeNetGroup);
  pipeNetGroup.visible = false;

  function makePipeNet(from, to, r = 0.18) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 0.05) return;
    const mid  = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10, 12), mPipe);
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.castShadow = true;
    pipeNetGroup.add(mesh);
  }
  function makeCodoNet(x, y, z, r = 0.22) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 8), mPipe);
    m.position.set(x, y, z); pipeNetGroup.add(m);
  }

  const NY = 0.28;
  // Casa central → colector principal norte-sur (espina X=1 a X=-8)
  makePipeNet(new THREE.Vector3(-8, NY, -18), new THREE.Vector3(-8, NY, -4), 0.22);
  makePipeNet(new THREE.Vector3(-8, NY, -4), new THREE.Vector3(1, NY, -4), 0.20);
  // Espina dorsal vertical (X=1, de Z=-4 a Z=33)
  makePipeNet(new THREE.Vector3(1, NY, -4), new THREE.Vector3(1, NY, 33), 0.20);
  makeCodoNet(-8, NY, -18, 0.26); makeCodoNet(-8, NY, -4, 0.24);
  makeCodoNet(1, NY, -4, 0.24); makeCodoNet(1, NY, 33, 0.22);
  // Ramales a cada cabaña (3 filas × 4 niveles)
  const cabinPipeTargets = [
    { cx: 10, cz:  0 }, { cx: 10, cz: 10 }, { cx: 10, cz: 20 }, { cx: 10, cz: 30 },
    { cx:  1, cz:  0 }, { cx:  1, cz: 10 }, { cx:  1, cz: 20 }, { cx:  1, cz: 30 },
    { cx: -8, cz:  0 }, { cx: -8, cz: 10 }, { cx: -8, cz: 20 }, { cx: -8, cz: 30 },
  ];
  cabinPipeTargets.forEach(({ cx, cz }) => {
    if (cx !== 1) {
      makePipeNet(new THREE.Vector3(1, NY, cz + 1.5), new THREE.Vector3(cx + (cx > 1 ? -2 : 2), NY, cz + 1.5), 0.13);
      makeCodoNet(1, NY, cz + 1.5, 0.17);
    }
  });
  // Tapas de registro
  [
    [-8,-18], [-8,-4], [1,-4],
    [1,  0], [1, 10], [1, 20], [1, 30],
    [10,  0], [10, 10], [10, 20], [10, 30],
    [-8,  0], [-8, 10], [-8, 20], [-8, 30],
  ].forEach(([x,z]) => makeManhole(x,z));

  // btnPipe now lives in the sidebar
  const btnPipe = document.getElementById('btn-toggle-pipes') || (() => {
    const b = document.createElement('button'); b.id = 'btn-toggle-pipes'; return b;
  })();
  btnPipe.addEventListener('click', () => {
    pipeNetGroup.visible = !pipeNetGroup.visible;
    btnPipe.classList.toggle('sb-active', pipeNetGroup.visible);
    btnPipe.querySelector?.('.sb-label') && (btnPipe.querySelector('.sb-label').textContent =
      pipeNetGroup.visible ? 'Ocultar Tuberías' : 'Mostrar Tuberías');
  });
  wrapper.style.position = 'relative';

  // ─── Calles ───────────────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  //  RED VIAL — sistema de calles limpio, sin solapamientos, con polygonOffset
  //  Y estricto: suelo=0, asfalto=0.02, bordillos(3D)=prop, senderos=0.03,
  //  líneas/marcas=0.04, paso cebra=0.05
  // ═══════════════════════════════════════════════════════════════════════════

  // Bordillo (helper) — BoxGeometry de 0.14 de alto, nunca interfiere con planos
  function addCurb(lx, lz, lw, ll, axis='x') {
    const c = new THREE.Mesh(
      axis==='x' ? new THREE.BoxGeometry(lw, 0.14, ll) : new THREE.BoxGeometry(ll, 0.14, lw),
      mPath
    );
    c.position.set(lx, 0.09, lz);
    scene.add(c);
  }

  // Línea discontinua (helper) — siempre a Y=0.04
  function addDashes(x0,z0, x1,z1, dashLen=2.5, gapLen=2.5) {
    const dx = x1-x0, dz = z1-z0;
    const total = Math.sqrt(dx*dx+dz*dz);
    const ux = dx/total, uz = dz/total;
    const angle = Math.atan2(dz, dx);
    let dist = gapLen*0.5; // start with half gap
    const isVert = Math.abs(uz) > Math.abs(ux);
    while (dist + dashLen <= total) {
      const mx = x0 + ux*(dist + dashLen*0.5);
      const mz = z0 + uz*(dist + dashLen*0.5);
      const d = new THREE.Mesh(
        isVert ? new THREE.PlaneGeometry(0.22, dashLen) : new THREE.PlaneGeometry(dashLen, 0.22),
        mRoadLine
      );
      d.rotation.x = -Math.PI/2;
      d.position.set(mx, 0.04, mz);
      scene.add(d);
      dist += dashLen + gapLen;
    }
  }

  // Paso de cebra (helper)
  function addZebra(cx, cz, width=5.0, rotation=0) {
    const count = 6;
    for (let i=0; i<count; i++) {
      const offset = (i - (count-1)*0.5) * (width/count);
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(width/count*0.65, 3.8), mRoadLine);
      stripe.rotation.x = -Math.PI/2;
      stripe.rotation.z = rotation;
      if (rotation === 0) stripe.position.set(cx + offset, 0.05, cz);
      else                stripe.position.set(cx, 0.05, cz + offset);
      scene.add(stripe);
    }
  }

  // ══ RED VIAL DE ASFALTO ══════════════════════════════════════════════════
  const mAsphaltRoad = new THREE.MeshLambertMaterial({
    color: 0x4a4a4a, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1
  });
  const mAsphaltLine = new THREE.MeshLambertMaterial({
    color: 0xffffff, polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:1
  });
  const mAsphaltYellow = new THREE.MeshLambertMaterial({
    color: 0xffdd00, polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:1
  });

  function addRoadSegment(cx, cz, w, h, rotZ = 0) {
    const r = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mAsphaltRoad);
    r.rotation.x = -Math.PI/2;
    r.rotation.z = rotZ;
    r.position.set(cx, 0.02, cz);
    r.receiveShadow = true;
    scene.add(r);
  }
  function addRoadDashes(x0, z0, x1, z1, dashLen=2.0, gapLen=2.0) {
    const dx=x1-x0, dz=z1-z0, total=Math.sqrt(dx*dx+dz*dz);
    const ux=dx/total, uz=dz/total;
    const isVert = Math.abs(uz) > Math.abs(ux);
    let dist = gapLen * 0.5;
    while (dist + dashLen <= total) {
      const mx = x0 + ux*(dist+dashLen*0.5);
      const mz = z0 + uz*(dist+dashLen*0.5);
      const d = new THREE.Mesh(
        isVert ? new THREE.PlaneGeometry(0.20, dashLen) : new THREE.PlaneGeometry(dashLen, 0.20),
        mAsphaltLine
      );
      d.rotation.x = -Math.PI/2;
      d.position.set(mx, 0.04, mz);
      scene.add(d);
      dist += dashLen + gapLen;
    }
  }

  // ── 1. Calle principal de acceso (entrada → recepción) ────────────────────
  addRoadSegment(-18, -5, 4.0, 20);
  // Línea central discontinua
  addRoadDashes(-18, -14, -18, 4);

  // ── 2. Calle interior del resort (eje Z, une todas las filas de cabañas) ──
  addRoadSegment(-5, 15, 4.0, 44);
  addRoadDashes(-5, -4, -5, 36);

  // ── 3. Calle transversal norte (conecta filas de cabañas en Z=2) ──────────
  addRoadSegment(3, 2, 22, 3.5);
  // ── 4. Calle transversal centro (Z=18) ───────────────────────────────────
  addRoadSegment(3, 18, 22, 3.5);
  // ── 5. Calle transversal sur (Z=34) ──────────────────────────────────────
  addRoadSegment(3, 34, 22, 3.5);

  // ── 6. Acceso a casa central (eje Z, frente a recepción) ─────────────────
  addRoadSegment(0, -11, 3.0, 8);

  // ── 7. Pasarela de madera hacia la playa (se mantiene en madera) ──────────
  const mBoardwalk = new THREE.MeshLambertMaterial({ color: 0xc49a6c });
  const boardwalk = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 22), mBoardwalk);
  boardwalk.rotation.x = -Math.PI/2;
  boardwalk.position.set(17, 0.04, 8);
  scene.add(boardwalk);
  for (let bz = -3; bz <= 20; bz += 0.8) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.06, 0.18),
      new THREE.MeshLambertMaterial({ color: 0xb8865a }));
    plank.position.set(17, 0.07, bz);
    scene.add(plank);
  }

  // ── 8. Área de maniobra frente al estacionamiento ─────────────────────────
  addRoadSegment(-22, -1, 18, 4.0);
  // Línea amarilla de no estacionar
  const noStop = new THREE.Mesh(new THREE.PlaneGeometry(18, 0.20), mAsphaltYellow);
  noStop.rotation.x = -Math.PI/2;
  noStop.position.set(-22, 0.035, -2.8);
  scene.add(noStop);

  // ═══════════════════════════════════════════════════════════════════════════
  //  ESTACIONAMIENTO PROFESIONAL
  //  Zona asfaltada con 10 plazas en 2 filas, señalética y topes de rueda
  //  Posición: X=-28..-15, Z=0..12
  // ═══════════════════════════════════════════════════════════════════════════
  (function buildParking() {
    const PX = -22, PZ = 6;  // centro del estacionamiento
    const PW = 16, PD = 14;  // ancho x profundidad

    // ── Pavimento principal (asfalto oscuro) ──────────────────────────────
    const mAsphalt = new THREE.MeshLambertMaterial({
      color: 0x5a5550, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1
    });
    const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD), mAsphalt);
    asphalt.rotation.x = -Math.PI/2;
    asphalt.position.set(PX, 0.015, PZ);
    asphalt.receiveShadow = true;
    scene.add(asphalt);

    // ── Bordillo perimetral (canto elevado) ────────────────────────────────
    const mCurb = new THREE.MeshLambertMaterial({ color: 0xccccbb });
    [
      [PX,        PZ-PD/2, PW+0.3, 0.3, 'x'],  // frente
      [PX,        PZ+PD/2, PW+0.3, 0.3, 'x'],  // fondo
      [PX-PW/2,  PZ,       0.3, PD,     'z'],  // izq
      [PX+PW/2,  PZ,       0.3, PD,     'z'],  // der
    ].forEach(([cx,cz,w,d,ax]) => {
      const c = new THREE.Mesh(
        ax==='x' ? new THREE.BoxGeometry(w, 0.18, d) : new THREE.BoxGeometry(w, 0.18, d),
        mCurb
      );
      c.position.set(cx, 0.09, cz);
      scene.add(c);
    });

    // ── Líneas blancas de plazas (5 plazas por fila, 2 filas) ─────────────
    const mLine = new THREE.MeshLambertMaterial({
      color: 0xffffff, polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:1
    });
    const mYellow = new THREE.MeshLambertMaterial({
      color: 0xffdd44, polygonOffset:true, polygonOffsetFactor:2, polygonOffsetUnits:1
    });

    // Líneas verticales de separación de plazas (2.8 unidades de ancho c/u)
    const SLOT_W = 2.8;
    // Filas simétricas dentro del asfalto: fila1 en Z=3.0, fila2 en Z=9.0
    // (asfalto va de Z=-1 a Z=13, mitad en Z=6, cada fila a ±3 del centro)
    const ROW1_Z = PZ - 3.0;  // = 3.0  fila frontal
    const ROW2_Z = PZ + 3.0;  // = 9.0  fila trasera
    // Centros de plaza: PX-PW/2 = -30, +SLOT_W/2 = +1.4 → primer centro = -28.6
    // Calculados dinámicamente para evitar desalineaciones manuales
    const SLOT_CENTERS_X = Array.from({length:5}, (_,i) => (PX - PW/2) + SLOT_W*i + SLOT_W/2);
    // = [-28.6, -25.8, -23.0, -20.2, -17.4]

    // Divisores verticales — fila 1
    for (let i = 0; i <= 5; i++) {
      const lx = (PX - PW/2) + i * SLOT_W;
      if (lx > PX + PW/2 + 0.1) break;
      const div = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 5.5), mLine);
      div.rotation.x = -Math.PI/2;
      div.position.set(lx, 0.025, ROW1_Z);
      scene.add(div);
    }
    // Divisores verticales — fila 2
    for (let i = 0; i <= 5; i++) {
      const lx = (PX - PW/2) + i * SLOT_W;
      if (lx > PX + PW/2 + 0.1) break;
      const div = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 5.5), mLine);
      div.rotation.x = -Math.PI/2;
      div.position.set(lx, 0.025, ROW2_Z);
      scene.add(div);
    }

    // Línea horizontal frontal y trasera de cada fila
    [[ROW1_Z - 2.75], [ROW1_Z + 2.75], [ROW2_Z - 2.75], [ROW2_Z + 2.75]].forEach(([lz]) => {
      const hLine = new THREE.Mesh(new THREE.PlaneGeometry(PW - 0.3, 0.12), mLine);
      hLine.rotation.x = -Math.PI/2;
      hLine.position.set(PX, 0.025, lz);
      scene.add(hLine);
    });

    // Línea amarilla central (separación de filas / calle interna)
    const centerLine = new THREE.Mesh(new THREE.PlaneGeometry(PW - 0.3, 0.18), mYellow);
    centerLine.rotation.x = -Math.PI/2;
    centerLine.position.set(PX, 0.03, PZ - 0.2);
    scene.add(centerLine);

    // ── Flecha de dirección en la calle central ─────────────────────────────
    // (triángulo simple apuntando hacia la salida)
    const mArrow = new THREE.MeshLambertMaterial({
      color:0xffffff, polygonOffset:true, polygonOffsetFactor:3, polygonOffsetUnits:1
    });
    const arrowBody = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 1.2), mArrow);
    arrowBody.rotation.x = -Math.PI/2;
    arrowBody.position.set(PX-4, 0.03, PZ - 0.2);
    scene.add(arrowBody);
    // Punta de flecha (cono aplanado hacia el borde)
    const arrowHead = new THREE.Mesh(new THREE.CylinderGeometry(0,0.45,0.04,3,1), mArrow);
    arrowHead.rotation.x = -Math.PI/2;
    arrowHead.rotation.z = Math.PI/6;
    arrowHead.position.set(PX-4, 0.03, PZ - 0.8);
    scene.add(arrowHead);

    // ── Topes de rueda (stopper) — 1 por plaza × 2 filas ─────────────────
    const mStopper = new THREE.MeshLambertMaterial({ color: 0x333322 });
    SLOT_CENTERS_X.forEach(sx => {
      [ROW1_Z + 1.5, ROW2_Z - 1.5].forEach(sz => {
        const stop = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.16, 0.28), mStopper);
        stop.position.set(sx, 0.08, sz);
        scene.add(stop);
      });
    });

    // ── Autos estacionados (8 de 10 plazas ocupadas) ─────────────────────
    function buildParkedCar(cx, cz, color, rotY = 0) {
      const g = new THREE.Group();
      const mat = new THREE.MeshLambertMaterial({ color });
      // Carrocería baja
      const body = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.62, 1.72), mat);
      body.position.y = 0.5; body.castShadow = true; g.add(body);
      // Cabina (centrada en X=0 del grupo, sin offset para mantener alineación)
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.62, 1.58), mat);
      cabin.position.set(0, 1.15, 0); g.add(cabin);
      // Parabrisas frontal
      const wfMat = new THREE.MeshLambertMaterial({ color:0x334455, transparent:true, opacity:0.7 });
      const wf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 1.38), wfMat);
      wf.position.set(0.78, 1.14, 0); g.add(wf);
      // Luneta trasera
      const wr = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.46, 1.32), wfMat);
      wr.position.set(-1.12, 1.16, 0); g.add(wr);
      // Faros delanteros
      const mFaro = new THREE.MeshLambertMaterial({ color:0xffee88 });
      [-0.55, 0.55].forEach(fz => {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.32), mFaro);
        f.position.set(1.75, 0.65, fz); g.add(f);
      });
      // Luces traseras
      const mStop2 = new THREE.MeshLambertMaterial({ color:0xcc2222 });
      [-0.55, 0.55].forEach(fz => {
        const f = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.20, 0.30), mStop2);
        f.position.set(-1.76, 0.65, fz); g.add(f);
      });
      // Ruedas (4)
      [[-1.15,-0.88],[-1.15,0.88],[0.95,-0.88],[0.95,0.88]].forEach(([wx,wz]) => {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.32,0.32,0.24,10), mWheel);
        wh.rotation.z = Math.PI/2; wh.position.set(wx,0.32,wz); g.add(wh);
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.18,0.26,8),
          new THREE.MeshLambertMaterial({ color:0xaaaaaa }));
        rim.rotation.z = Math.PI/2; rim.position.set(wx,0.32,wz); g.add(rim);
      });
      g.position.set(cx, 0, cz);
      g.rotation.y = rotY;
      scene.add(g);
    }

    // Fila 1 — centros calculados con SLOT_CENTERS_X, rotY=Math.PI/2 (largo en eje Z)
    buildParkedCar(SLOT_CENTERS_X[0], ROW1_Z, 0x8b2020, Math.PI / 2);   // rojo
    buildParkedCar(SLOT_CENTERS_X[1], ROW1_Z, 0x224488, Math.PI / 2);   // azul
    buildParkedCar(SLOT_CENTERS_X[2], ROW1_Z, 0x228833, Math.PI / 2);   // verde
    buildParkedCar(SLOT_CENTERS_X[3], ROW1_Z, 0xaa6622, Math.PI / 2);   // naranja
    // plaza [4] → libre

    // Fila 2 — rotY=-Math.PI/2 (sentido contrario, frontal hacia el pasillo)
    buildParkedCar(SLOT_CENTERS_X[0], ROW2_Z, 0x336688, -Math.PI / 2);  // azul marino
    buildParkedCar(SLOT_CENTERS_X[1], ROW2_Z, 0x993344, -Math.PI / 2);  // bordo
    buildParkedCar(SLOT_CENTERS_X[2], ROW2_Z, 0x777777, -Math.PI / 2);  // gris
    // plaza [3] → libre
    buildParkedCar(SLOT_CENTERS_X[4], ROW2_Z, 0x446622, -Math.PI / 2);  // verde oscuro

    // ── Señal vertical de estacionamiento ──────────────────────────────────
    const mSignPole = new THREE.MeshLambertMaterial({ color: 0x555555 });
    const mSignBlue = new THREE.MeshLambertMaterial({ color: 0x1155bb });
    const mSignWh   = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mSignYel  = new THREE.MeshLambertMaterial({ color: 0xffdd00 });

    function buildParkingSign(sx, sz) {
      // Poste
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,3.5,6), mSignPole);
      pole.position.set(sx, 1.75, sz); scene.add(pole);
      // Panel azul cuadrado
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.06), mSignBlue);
      panel.position.set(sx, 3.4, sz); scene.add(panel);
      // "P" en blanco (3 cubos formando la letra)
      const pV = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.07), mSignWh);
      pV.position.set(sx - 0.12, 3.4, sz + 0.04); scene.add(pV);
      const pH = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.09, 0.07), mSignWh);
      pH.position.set(sx - 0.02, 3.6, sz + 0.04); scene.add(pH);
      const pA = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.28, 0.07), mSignWh);
      pA.position.set(sx + 0.06, 3.49, sz + 0.04); scene.add(pA);
      // Franja amarilla "$ 1.200"
      const priceTag = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.32, 0.06), mSignYel);
      priceTag.position.set(sx, 2.9, sz); scene.add(priceTag);
    }

    buildParkingSign(PX - PW/2 + 0.4, PZ - PD/2 + 0.6);
    buildParkingSign(PX + PW/2 - 0.4, PZ - PD/2 + 0.6);

    // ── Faroles del estacionamiento (2 postes altos en la entrada) ──────────
    const mFarolPole = new THREE.MeshLambertMaterial({ color: 0x444440 });
    const mFarolHead = new THREE.MeshLambertMaterial({ color: 0x333330 });
    [PX - 5.5, PX + 5.5].forEach(fx => {
      const fp = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.09,6.0,7), mFarolPole);
      fp.position.set(fx, 3.0, PZ - PD/2 + 0.5); scene.add(fp);
      const fh = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.22, 0.7), mFarolHead);
      fh.position.set(fx, 6.12, PZ - PD/2 + 0.5); scene.add(fh);
      // Luz cálida
      const fl = new THREE.PointLight(0xffdd88, 0, 14);
      fl.position.set(fx, 5.8, PZ - PD/2 + 0.5);
      scene.add(fl);
      streetLampLights.push(fl);
      const fgMat = new THREE.MeshBasicMaterial({ color:0xffee88 });
      const fg = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), fgMat);
      fg.position.set(fx, 5.9, PZ - PD/2 + 0.5); scene.add(fg);
      windowGlows.push({ material: fgMat });
    });

    // ── Cadena / barrera de acceso ─────────────────────────────────────────
    const mBarrier = new THREE.MeshLambertMaterial({ color: 0xdd3322 });
    const mBarWh   = new THREE.MeshLambertMaterial({ color: 0xffffff });
    // Poste izquierdo de barrera
    const bPoleL = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,1.2,6), mSignPole);
    bPoleL.position.set(PX - PW/2 + 0.3, 0.6, PZ - PD/2 - 0.1); scene.add(bPoleL);
    // Poste derecho de barrera
    const bPoleR = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,1.2,6), mSignPole);
    bPoleR.position.set(PX + PW/2 - 0.3, 0.6, PZ - PD/2 - 0.1); scene.add(bPoleR);
    // Barra horizontal (barrera levantada = a 45°)
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(PW * 0.38, 0.12, 0.12), mBarrier);
    barrier.position.set(PX - PW/2 + 0.3 + PW*0.09, 1.1, PZ - PD/2 - 0.1);
    barrier.rotation.z = 0.6; // levantada
    scene.add(barrier);
    // Franjas blancas de la barrera
    for (let bi = 0; bi < 5; bi++) {
      const bs = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.13, 0.13), mBarWh);
      bs.position.set(PX - PW/2 + 0.3 + bi * PW * 0.036 + PW*0.027, 1.1 + bi*0.18, PZ - PD/2 - 0.1);
      bs.rotation.z = 0.6;
      scene.add(bs);
    }

  })(); // fin buildParking

  // ── Letrero bienvenida resort ─────────────────────────────────────────────
  const mSign     = new THREE.MeshLambertMaterial({ color: 0x1b3d2d });
  const mSignText = new THREE.MeshLambertMaterial({ color: 0xf5e8a0 });
  const signPost  = new THREE.Mesh(new THREE.CylinderGeometry(0.06,0.06,2.0,6), mSign);
  signPost.position.set(-24, 1.0, 0); scene.add(signPost);
  const signBoard = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 0.1), mSign);
  signBoard.position.set(-24, 2.1, 0); scene.add(signBoard);
  const signPanel = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.82, 0.08), mSignText);
  signPanel.position.set(-24, 2.1, 0.06); scene.add(signPanel);

  // ── BAÑOS PÚBLICOS junto al estacionamiento ────────────────────────────
  // Pago incluido con el estacionamiento (1200 $/hora)
  (function buildPublicToilets(tx, tz) {
    const g = new THREE.Group(); g.position.set(tx, 0, tz);
    const mTW = new THREE.MeshLambertMaterial({ color: 0xe8dcc8 });
    const mTR = new THREE.MeshLambertMaterial({ color: 0x3a6358 });
    const mTH = new THREE.MeshLambertMaterial({ color: 0x224488 }); // hombres
    const mTM = new THREE.MeshLambertMaterial({ color: 0x882244 }); // mujeres
    const mTS = new THREE.MeshLambertMaterial({ color: 0x1b3d2d });
    const mTP = new THREE.MeshLambertMaterial({ color: 0xf5e8a0 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(5.0, 2.8, 3.2), mTW);
    body.position.y = 1.4; body.castShadow = true; body.receiveShadow = true; g.add(body);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.2, 3.8), mTR);
    roof.position.y = 2.9; g.add(roof);
    const divider = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.6, 3.0), mTW);
    divider.position.set(0, 1.3, 0); g.add(divider);
    const dH = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.0, 0.09), mTH);
    dH.position.set(-1.2, 1.0, 1.65); g.add(dH);
    const dM = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2.0, 0.09), mTM);
    dM.position.set( 1.2, 1.0, 1.65); g.add(dM);
    const pricePlate = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.7, 0.08), mTS);
    pricePlate.position.set(0, 3.4, 1.4); g.add(pricePlate);
    const priceBack = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.52, 0.06), mTP);
    priceBack.position.set(0, 3.4, 1.46); g.add(priceBack);
    const iconH = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.08), mTH);
    iconH.position.set(-1.2, 2.4, 1.67); g.add(iconH);
    const iconM = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.08), mTM);
    iconM.position.set( 1.2, 2.4, 1.67); g.add(iconM);
    const step = new THREE.Mesh(new THREE.BoxGeometry(5.0, 0.18, 0.5), mTS);
    step.position.set(0, 0.09, 1.95); g.add(step);
    scene.add(g);
  })(-22, -5);

  // (El estacionamiento completo se construye en buildParking() más abajo)

  // ── Aceras orgánicas (solo junto a recepción) ─────────────────────────────
  const sidewalkN = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.4), mPath);
  sidewalkN.rotation.x = -Math.PI/2;
  sidewalkN.position.set(-20, 0.03, -1);
  scene.add(sidewalkN);

  // ─── Casa principal ───────────────────────────────────────────────────────
  function buildMainHouse(px, pz) {
    const g = new THREE.Group(); g.position.set(px, 0, pz);
    const sw = 10, sh = 5, sd = 8;
    const body = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, sd), mMain);
    body.position.y = sh / 2; body.castShadow = true; body.receiveShadow = true; g.add(body);
    const eave = new THREE.Mesh(new THREE.BoxGeometry(sw+1.4, 0.2, sd+1.4), mRoofMain);
    eave.position.y = sh + 0.1; g.add(eave);
    const roofFlat = new THREE.Mesh(new THREE.BoxGeometry(sw+0.6, 0.4, sd+0.6), mRoofMain);
    roofFlat.position.y = sh + 0.3; roofFlat.castShadow = true; g.add(roofFlat);
    const crest = new THREE.Mesh(new THREE.BoxGeometry(sw*0.5, 0.65, 0.5), mRoofMain);
    crest.position.y = sh + 0.65; g.add(crest);
    [-1.1, 1.1].forEach(dx => {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, sh*0.55, 0.1), mDoor);
      door.position.set(dx, sh*0.275, sd/2+0.05); g.add(door);
    });
    [-3.5,-1.2,1.2,3.5].forEach(wx => {
      // Ventana con brillo nocturno
      const winMat = new THREE.MeshLambertMaterial({ color: 0x223344, emissive: 0xffcc66, emissiveIntensity: 0 });
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.4, 0.1), winMat);
      win.position.set(wx, sh*0.65, sd/2+0.05); g.add(win);
      windowGlows.push(win);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.1, 0.22), mSill);
      sill.position.set(wx, sh*0.65-0.75, sd/2+0.13); g.add(sill);
    });
    const winBack = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 0.1), mWin);
    winBack.position.set(0, sh*0.6, -(sd/2+0.05)); g.add(winBack);
    // MEJORA 9: Antena de comunicaciones en la azotea
    const mAnt = new THREE.MeshLambertMaterial({ color:0x888888 });
    const antPost = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,2.2,6), mAnt);
    antPost.position.set(3.5, sh+1.6, 0); g.add(antPost);
    [-0.5,0,0.5].forEach(h => {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,0.8,4), mAnt);
      arm.rotation.z = Math.PI/2; arm.position.set(3.5, sh+1.2+h*0.5, 0); g.add(arm);
    });
    // Luz roja parpadeante en la cima de la antena
    const blinkMat = new THREE.MeshBasicMaterial({ color:0xff2200 });
    const blinkLight = new THREE.Mesh(new THREE.SphereGeometry(0.08,6,4), blinkMat);
    blinkLight.position.set(3.5, sh+2.8, 0);
    blinkLight.userData.isBlink = true;
    g.add(blinkLight);
    const terrace = new THREE.Mesh(new THREE.BoxGeometry(sw+1, 0.15, 2.8), mSill);
    terrace.position.set(0, 0.075, sd/2+1.4); g.add(terrace);
    [-4,-1.3,1.3,4].forEach(px2 => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,sh*0.5,6), mSill);
      post.position.set(px2, sh*0.25, sd/2+2.7); g.add(post);
    });
    scene.add(g);
  }


  buildMainHouse(-8, -16);  // Casa central de distribución de agua

  // ─── Casitas de playa (bungalow sobre pilotes, estilo vacacional) ──────────
  // Materiales específicos de playa
  const mDeck      = new THREE.MeshLambertMaterial({ color: 0xd4a96a }); // madera de deck
  const mDeckDark  = new THREE.MeshLambertMaterial({ color: 0xb8865a }); // listones oscuros
  const mRoofThatch= new THREE.MeshLambertMaterial({ color: 0x8b6914 }); // techo de paja/caña
  const mRoofTile  = new THREE.MeshLambertMaterial({ color: 0x6b3a2a }); // teja terracota
  const mPillar    = new THREE.MeshLambertMaterial({ color: 0xc49a6c }); // pilotes madera
  const mRailing   = new THREE.MeshLambertMaterial({ color: 0xd4b07a }); // barandal
  const mCabWall   = new THREE.MeshLambertMaterial({ color: 0xf5e8d0 }); // paredes claras
  const mCabWall2  = new THREE.MeshLambertMaterial({ color: 0xe8d5b8 }); // variante

  function buildBeachBungalow(px, pz, variant = 0) {
    const g = new THREE.Group(); g.position.set(px, 0, pz);
    const wallMat = variant % 2 === 0 ? mCabWall : mCabWall2;
    const roofMat = variant % 3 === 0 ? mRoofThatch : mRoofTile;

    // ── Pilotes (4 patas) ──────────────────────────────────────────────────
    [[-1.6,-1.4],[ 1.6,-1.4],[-1.6, 1.4],[ 1.6, 1.4]].forEach(([px2,pz2]) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.9, 7), mPillar);
      p.position.set(px2, 0.45, pz2); g.add(p);
    });

    // ── Plataforma / deck de madera ────────────────────────────────────────
    const platform = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 4.2), mDeck);
    platform.position.y = 0.95; platform.castShadow = true; g.add(platform);
    // Listones del deck (detalle)
    for (let li = -2.2; li <= 2.2; li += 0.55) {
      const lath = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 4.1), mDeckDark);
      lath.position.set(li, 1.05, 0); g.add(lath);
    }

    // ── Deck frontal extendido (terraza) ───────────────────────────────────
    const terrace = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.14, 1.4), mDeck);
    terrace.position.set(0, 0.97, 2.8); g.add(terrace);
    // Barandal de la terraza (4 postes + barra)
    [-2.2,-1.1, 0, 1.1, 2.2].forEach(bx => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 5), mRailing);
      post.position.set(bx, 1.46, 3.4); g.add(post);
    });
    const rail = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.08, 0.08), mRailing);
    rail.position.set(0, 1.82, 3.42); g.add(rail);
    const railBot = new THREE.Mesh(new THREE.BoxGeometry(5.1, 0.06, 0.06), mRailing);
    railBot.position.set(0, 1.20, 3.42); g.add(railBot);

    // ── Cuerpo de la cabaña ────────────────────────────────────────────────
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.4, 3.4), wallMat);
    body.position.y = 2.25; body.castShadow = true; body.receiveShadow = true; g.add(body);

    // ── Techo a dos aguas pronunciado (tropical) ───────────────────────────
    const roofBase = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.15, 3.8), roofMat);
    roofBase.position.y = 3.55; g.add(roofBase);
    // Cumbrera (prisma triangular = dos CylinderGeometry aplanados)
    const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0, 2.4, 1.4, 3, 1, false), roofMat);
    ridge.rotation.y = Math.PI/2; ridge.position.y = 4.3; ridge.castShadow = true; g.add(ridge);
    // Voladizo frontal y trasero
    [-1.0, 1.0].forEach(side => {
      const eave = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.1, 0.5), roofMat);
      eave.position.set(0, 3.50, side * 2.15); g.add(eave);
    });

    // ── Puerta corredera de vidrio (al frente) ─────────────────────────────
    const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.9, 0.09), mDoor);
    doorFrame.position.set(0, 2.05, 1.75); g.add(doorFrame);
    const glassPanel = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.7, 0.05),
      new THREE.MeshLambertMaterial({ color:0x88ccee, transparent:true, opacity:0.55 }));
    glassPanel.position.set(0, 2.05, 1.78); g.add(glassPanel);

    // ── Ventanas laterales con brillo nocturno ─────────────────────────────
    [-1.4, 1.4].forEach(wx => {
      const winMat = new THREE.MeshLambertMaterial({ color:0x88ccee, emissive:0xffcc66, emissiveIntensity:0, transparent:true, opacity:0.7 });
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.85, 0.09), winMat);
      win.position.set(wx, 2.35, 1.75); g.add(win);
      windowGlows.push(win);
      // Postigo de madera
      const shutter = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.85, 0.06), mDeckDark);
      shutter.position.set(wx - 0.72, 2.35, 1.75); g.add(shutter);
    });

    // ── Ventana trasera ────────────────────────────────────────────────────
    const winBackMat = new THREE.MeshLambertMaterial({ color:0x88ccee, emissive:0xffcc66, emissiveIntensity:0, transparent:true, opacity:0.6 });
    const winBack = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.09), winBackMat);
    winBack.position.set(0, 2.35, -1.75); g.add(winBack);
    windowGlows.push(winBack);

    // ── Escalones de acceso ────────────────────────────────────────────────
    [0.55, 0.35, 0.15].forEach((y, i) => {
      const step = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.38 + i*0.1), mDeck);
      step.position.set(0, y, 2.2 + i*0.38); g.add(step);
    });

    // ── Hamaca (solo en algunas cabañas) ──────────────────────────────────
    if (variant === 1 || variant === 4) {
      const hammock = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.55),
        new THREE.MeshLambertMaterial({ color:0xcc9944, transparent:true, opacity:0.85, side:THREE.DoubleSide }));
      hammock.rotation.z = 0.15;
      hammock.position.set(-0.6, 1.35, 2.9); g.add(hammock);
    }

    // ── Flor/planta en la terraza ──────────────────────────────────────────
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.28, 6),
      new THREE.MeshLambertMaterial({ color:0xb0622a }));
    pot.position.set(2.1, 1.18, 2.8); g.add(pot);
    const plant = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 5),
      new THREE.MeshLambertMaterial({ color:0x3a8a3a }));
    plant.position.set(2.1, 1.55, 2.8); g.add(plant);

    scene.add(g);
    return g;
  }

  // ── Cabañas en 3 filas ordenadas (resort más grande y realista) ─────────
  // Fila Este (cerca del mar):  X=10, Z= 0,10,20,30
  // Fila Centro (pasillo):      X= 1, Z= 0,10,20,30
  // Fila Oeste (interior):      X= -8, Z= 0,10,20,30
  // Separación uniforme de 10 unidades en Z
  const CABIN_POSITIONS = [
    // Fila Este — orientadas hacia el mar
    { x: 10, z:  0, v:0, ry: -0.10 },
    { x: 10, z: 10, v:1, ry: -0.08 },
    { x: 10, z: 20, v:2, ry: -0.10 },
    { x: 10, z: 30, v:3, ry: -0.06 },
    // Fila Centro
    { x:  1, z:  0, v:4, ry:  0.00 },
    { x:  1, z: 10, v:5, ry:  0.00 },
    { x:  1, z: 20, v:0, ry:  0.00 },
    { x:  1, z: 30, v:1, ry:  0.00 },
    // Fila Oeste — ligeramente giradas hacia el interior
    { x: -8, z:  0, v:2, ry:  0.08 },
    { x: -8, z: 10, v:3, ry:  0.06 },
    { x: -8, z: 20, v:4, ry:  0.08 },
    { x: -8, z: 30, v:5, ry:  0.06 },
  ];
  CABIN_POSITIONS.forEach(({ x, z, v, ry }) => {
    const cab = buildBeachBungalow(x, z, v);
    cab.rotation.y = ry;
  });
  // ── Jardines y sendero individual a cada cabaña ───────────────────────────
  CABIN_POSITIONS.forEach(({ x, z }) => {
    // Parche de césped delante de la cabaña
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(4.0, 2.5), mGrass);
    grass.rotation.x = -Math.PI/2;
    grass.position.set(x + 1.5, 0.03, z + 4.0);
    scene.add(grass);
    // Sendero individual desde cabaña hacia el camino central (X=1.5)
    if (x !== 1) {
      const pathLen = Math.abs(x - 1) + 0.5;
      const pathMidX = (x + 1) / 2;
      const pathCabin = new THREE.Mesh(new THREE.PlaneGeometry(pathLen, 1.2), mPath);
      pathCabin.rotation.x = -Math.PI/2;
      pathCabin.position.set(pathMidX, 0.03, z + 1.5);
      scene.add(pathCabin);
    }
  });

  // ── Caminos internos entre filas de cabañas ───────────────────────────────
  // Espina dorsal central (X=1, de Z=-4 a Z=36)
  const mPathSpine = new THREE.MeshLambertMaterial({
    color: 0xbfaa7a, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  });
  const pathSpine = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 42), mPathSpine);
  pathSpine.rotation.x = -Math.PI/2;
  pathSpine.position.set(1, 0.02, 15);
  scene.add(pathSpine);
  // Caminos transversales en cada Z de cabaña (conectan las 3 filas)
  [0, 10, 20, 30].forEach(z => {
    const pathH = new THREE.Mesh(new THREE.PlaneGeometry(24, 1.6), mPathSpine);
    pathH.rotation.x = -Math.PI/2;
    pathH.position.set(1, 0.02, z + 1.5);
    scene.add(pathH);
  });
  // Camino lateral oeste → conecta fila Oeste con recepción
  const pathWest = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 42), mPathSpine);
  pathWest.rotation.x = -Math.PI/2;
  pathWest.position.set(-8, 0.02, 15);
  scene.add(pathWest);

  // ── Zona de descanso central (reemplaza la piscina eliminada) ─────────────
  const mPergola = new THREE.MeshLambertMaterial({ color: 0x8b6233 });

  (function buildPergola(cx, cz) {
    const g = new THREE.Group(); g.position.set(cx, 0, cz);
    [[-2.4, -1.6], [2.4, -1.6], [-2.4, 1.6], [2.4, 1.6]].forEach(([px2, pz2]) => {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 3.2, 8), mPergola);
      p.position.set(px2, 1.6, pz2); g.add(p);
    });
    [-1.6, 1.6].forEach(pz2 => {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.18, 0.18), mPergola);
      beam.position.set(0, 3.2, pz2); g.add(beam);
    });
    for (let bx = -2.4; bx <= 2.4; bx += 1.2) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 3.6), mPergola);
      slat.position.set(bx, 3.35, 0); g.add(slat);
    }
    scene.add(g);
  })(1, 15);  // centro del nuevo layout 3 filas

  // Parche de césped bajo la pérgola
  const mGrassCenter = new THREE.MeshLambertMaterial({
    color: 0x6a9a4a, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
  });
  const grassCenter = new THREE.Mesh(new THREE.PlaneGeometry(7, 5), mGrassCenter);
  grassCenter.rotation.x = -Math.PI / 2;
  grassCenter.position.set(1, 0.025, 15);
  scene.add(grassCenter);

  // Mesas y sillas bajo la pérgola
  const mFurniture = new THREE.MeshLambertMaterial({ color: 0xc49a6c });
  const mCushion   = new THREE.MeshLambertMaterial({ color: 0xe88c3c });
  function buildOutdoorTable(ox, oz) {
    const g = new THREE.Group(); g.position.set(ox, 0, oz);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.08, 12), mFurniture);
    top.position.y = 0.75; g.add(top);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.72, 7), mFurniture);
    leg.position.y = 0.36; g.add(leg);
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const cx2 = Math.cos(angle) * 0.85, cz2 = Math.sin(angle) * 0.85;
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.4), mFurniture);
      seat.position.set(cx2, 0.42, cz2); g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.06), mFurniture);
      back.position.set(cx2, 0.62, cz2 + Math.sin(angle) * 0.18); back.rotation.y = angle; g.add(back);
      const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.05, 0.38), mCushion);
      cushion.position.set(cx2, 0.45, cz2); g.add(cushion);
    }
    scene.add(g);
  }
  buildOutdoorTable(-1, 14);
  buildOutdoorTable( 3, 14);
  buildOutdoorTable(-1, 16);
  buildOutdoorTable( 3, 16);
  // Sombrillas sobre la zona de descanso central
  buildUmbrella(-1, 14, 2);
  buildUmbrella( 3, 14, 0);
  buildUmbrella(-1, 16, 1);
  buildUmbrella( 3, 16, 2);
  // Sendero de piedra hacia la pérgola
  const mPavingStone = new THREE.MeshLambertMaterial({
    color: 0xd8c898, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 1
  });
  [[1, 12.4], [1, 13.0], [1, 13.6]].forEach(([px2, pz2]) => {
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.4, 0.05, 7), mPavingStone);
    stone.rotation.x = -Math.PI / 2; stone.rotation.z = Math.random();
    stone.position.set(px2, 0.025, pz2);
    scene.add(stone);
  });

  // Dummy pool object (mantiene compatibilidad con el loop animate sin dibujar nada)
  const pool = { material: { color: { setHSL: () => {} }, opacity: 0 } };



  // ══ NUBES QUE SE MUEVEN ══════════════════════════════════════════════════
  const mCloud = new THREE.MeshLambertMaterial({ color:0xffffff, transparent:true, opacity:0.82 });
  const clouds = [];
  [
    { x:-30, y:28, z:-15, sx:5,   sy:2,   sz:3.5, spd:0.8  },
    { x:  5, y:32, z: -8, sx:7,   sy:2.2, sz:4,   spd:0.55 },
    { x: 20, y:26, z: 12, sx:4,   sy:1.8, sz:3,   spd:1.1  },
    { x:-10, y:30, z: 22, sx:6,   sy:2,   sz:3.8, spd:0.7  },
    { x: 35, y:29, z:-20, sx:5,   sy:1.9, sz:3.2, spd:0.9  },
  ].forEach(c => {
    const g = new THREE.Group();
    [[0,0,0],[c.sx*0.25,0.4,0],[c.sx*0.5,0,0]].forEach(([ox,oy]) => {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1,8,6),
        new THREE.MeshLambertMaterial({ color:0xffffff, transparent:true, opacity:0.82 }));
      puff.scale.set(c.sx*0.38+ox*0.05, c.sy*0.5, c.sz*0.38);
      puff.position.set(ox, oy, 0);
      g.add(puff);
    });
    g.position.set(c.x, c.y, c.z);
    scene.add(g);
    clouds.push({ group:g, spd:c.spd, baseX:c.x });
  });

  // ══ BANCO DE PECES bajo el mar ════════════════════════════════════════════
  const mFish = new THREE.MeshLambertMaterial({ color:0x1a6688 });
  const fishGroup = new THREE.Group();
  const fishMeshes = [];
  for (let i=0; i<14; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.18,6,4), mFish);
    f.scale.set(1.8, 0.6, 0.7);
    f.position.set((Math.random()-0.5)*8, -1.2+Math.random()*0.6, (Math.random()-0.5)*6);
    f.userData.phase = Math.random()*Math.PI*2;
    fishGroup.add(f);
    fishMeshes.push(f);
  }
  fishGroup.position.set(38, 0, 5);
  scene.add(fishGroup);

  // ══ HUMO DE CHIMENEAS de la planta ════════════════════════════════════════
  const smokeParticles = [];
  // Shared materials per chimney (2 instead of 16) — huge draw-call saving
  const smokeMats = [
    new THREE.MeshBasicMaterial({ color:0xbbbbbb, transparent:true, opacity:0 }),
    new THREE.MeshBasicMaterial({ color:0xbbbbbb, transparent:true, opacity:0 }),
  ];
  [[12-2.5, -8+1.5],[12+1, -8+1.5]].forEach(([cx,cz], chi) => {
    for (let i=0; i<8; i++) {
      const puff = new THREE.Mesh(
        new THREE.SphereGeometry(0.22+Math.random()*0.18, 5, 4), // reduced segments
        smokeMats[chi] // shared material
      );
      puff.position.set(cx+(Math.random()-0.5)*0.3, 7+Math.random()*2, cz+(Math.random()-0.5)*0.3);
      puff._baseY  = puff.position.y;
      puff._life   = Math.random();
      puff._speed  = 0.006+Math.random()*0.005;
      puff._chiIdx = chi;
      scene.add(puff);
      smokeParticles.push(puff);
    }
  });

  // Autos en movimiento eliminados — generaban colisiones visuales con cabañas

  // ─── Peatones ─────────────────────────────────────────────────────────────
  function buildHuman(px, py, pz, rotY = 0) {
    const g = new THREE.Group(); g.position.set(px, py, pz); g.rotation.y = rotY;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.9, 8), mHuman);
    body.position.y = 0.45; g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), mHuman);
    head.position.y = 1.05; g.add(head);
    [-0.1,0.1].forEach(dx => {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.07,0.55,6), mHuman);
      leg.position.set(dx, -0.3, 0); g.add(leg);
    });
    scene.add(g);
  }
  buildHuman(-6, 0, 8,   0.3); buildHuman( 1, 0, 14, Math.PI);
  buildHuman( 3, 0, 6,   0.5); buildHuman( 8, 0, 22, -0.4);
  buildHuman( 1.5, 0, -9.5, Math.PI*0.9);
  buildHuman(-1.2, 0, -10,  0.1);
  buildHuman(-8, 0, 25, -0.5); buildHuman( 4, 0, 30, 0.8);
  buildHuman(10, 0, 15, 0.3); buildHuman(-8, 0, 12, -0.2);

  // ─── Palmeras ─────────────────────────────────────────────────────────────
  function buildPalm(px, pz, height = 6) {
    const g = new THREE.Group(); g.position.set(px, 0, pz);
    for (let i = 0; i < 5; i++) {
      const t = i/5, segH = height/5;
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.22-((i+1)/5)*0.10, 0.22-(i/5)*0.10, segH, 7), mTrunk
      );
      seg.position.set(Math.sin(t*0.5)*0.4, i*segH+segH/2, Math.cos(t*0.3)*0.2);
      seg.rotation.z = t*0.08; seg.castShadow = true; g.add(seg);
    }
    for (let i = 0; i < 7; i++) {
      const angle = (i/7)*Math.PI*2;
      const frond = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 2.8), mLeaf);
      frond.position.set(Math.sin(angle)*0.6+Math.sin(0.5)*0.4, height-0.4, Math.cos(angle)*0.6+Math.cos(0.3)*0.2);
      frond.rotation.y = angle; frond.rotation.z = -Math.PI/4 - Math.random()*0.3;
      frond.castShadow = true; g.add(frond);
    }
    scene.add(g);
  }
  // Palmeras dispersas alrededor de las cabañas y la costa — resort 3 filas
  // Entre filas de cabañas
  buildPalm(5.5,  5, 5.5); buildPalm(5.5, 15, 6.0);
  buildPalm(5.5, 25, 5.8); buildPalm(5.5, 35, 6.2);
  buildPalm(-3.5,  5, 5.2); buildPalm(-3.5, 15, 5.8);
  buildPalm(-3.5, 25, 5.5); buildPalm(-3.5, 35, 6.0);
  buildPalm(-13,  5, 5.8); buildPalm(-13, 15, 5.5);
  buildPalm(-13, 25, 6.0); buildPalm(-13, 35, 5.8);
  // Palmeras en la zona de playa
  buildPalm(14,  -2, 7.0); buildPalm(14,   6, 6.5);
  buildPalm(14,  14, 7.2); buildPalm(14,  22, 6.8);
  buildPalm(14,  30, 7.0); buildPalm(14,  38, 6.5);
  buildPalm(15,  10, 6.8); buildPalm(15,  45, 6.5);
  // Zona oeste (cerca del estacionamiento)
  buildPalm(-18, -2, 5.0); buildPalm(-18, 20, 5.5);
  buildPalm(-18, 35, 5.2); buildPalm(-12, -5, 4.8);
  buildPalm(-12, 28, 5.2); buildPalm(-12, 40, 5.0);

  // ─── Cactus ───────────────────────────────────────────────────────────────
  function buildCactus(px, pz, h = 3) {
    const g = new THREE.Group(); g.position.set(px, 0, pz);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, h, 8), mCactus);
    body.position.y = h/2; body.castShadow = true; g.add(body);
    [[-1],[1]].forEach(([s]) => {
      const av = new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,h*0.45,7), mCactus);
      av.position.set(s*0.4, h*0.5+(h*0.45)/2, 0); g.add(av);
      const ah = new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,0.55,7), mCactus);
      ah.rotation.z = Math.PI/2; ah.position.set(s*0.18, h*0.5, 0); g.add(ah);
    });
    scene.add(g);
  }
  buildCactus(-18,-22,3.2); buildCactus(12,-26,2.8);
  buildCactus(-10,-28,3.0); buildCactus( 6,-20,2.5);
  buildCactus(-22, 10,2.8); buildCactus(15, 25,3.0);
  buildCactus(-25, -5,3.4); buildCactus(-20, 40,2.8);

  // ─── Rocas ────────────────────────────────────────────────────────────────
  function addRocks(cx, cz, count = 5, spread = 10) {
    for (let i = 0; i < count; i++) {
      const sx=0.3+Math.random()*0.8, sy=0.2+Math.random()*0.5, sz=0.3+Math.random()*0.7;
      const rock = new THREE.Mesh(new THREE.SphereGeometry(1,5,4), mRock);
      rock.scale.set(sx,sy,sz);
      rock.position.set(cx+(Math.random()-0.5)*spread, sy*0.5, cz+(Math.random()-0.5)*spread);
      rock.rotation.y = Math.random()*Math.PI;
      rock.castShadow = true; rock.receiveShadow = true;
      scene.add(rock);
    }
  }
  addRocks(HILL_CX, HILL_CZ, 12, 22);
  addRocks(-20, 18, 5, 8);
  addRocks(14, -5, 4, 6);

  // ═══════════════════════════════════════════════════════════════════════════
  //  POSTES DE LUZ
  //  Reglas de ubicación:
  //   - Solo en tierra firme (X < 18)
  //   - Sobre calles o senderos, nunca dentro de edificios ni jardines
  //   - Espaciado ~8–10 unidades a lo largo de la calle principal (Z=-6)
  //   - Calle lateral (X=-14) cada ~6 unidades en Z
  //   - Sendero de huéspedes (Z=8.5) dos postes flanqueando
  //   - Ninguno en Z < -24 (zona de montaña/tierra seca)
  // ═══════════════════════════════════════════════════════════════════════════
  const mPole    = new THREE.MeshLambertMaterial({ color: 0x555550 });
  const mLampCap = new THREE.MeshLambertMaterial({ color: 0x444440 });
  // La esfera del farol cambia de color con emissive en updateDayNight
  const mLampGlo = new THREE.MeshBasicMaterial({ color: 0x776633 });

  function buildStreetLamp(px, pz, rotY = 0) {
    const g = new THREE.Group();
    g.position.set(px, 0, pz);
    g.rotation.y = rotY;

    // Poste cónico
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5.5, 7), mPole);
    pole.position.y = 2.75; pole.castShadow = true; g.add(pole);

    // Brazo
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 6), mPole);
    arm.rotation.z = Math.PI / 2; arm.position.set(0.5, 5.5, 0); g.add(arm);

    // Capuchón cónico
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.28, 8), mLampCap);
    cap.position.set(1.0, 5.38, 0); g.add(cap);

    // Bombilla (esfera pequeña, emissive de noche)
    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xffee88,
      emissive: 0x000000,      // se enciende con updateDayNight
      emissiveIntensity: 0,
    });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), glowMat);
    glow.position.set(1.0, 5.22, 0); g.add(glow);
    windowGlows.push(glow);   // reutilizamos el array, se anima igual

    // Halo esférico grande semitransparente (solo visible de noche)
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0xffdd66, transparent: true, opacity: 0, side: THREE.BackSide,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.8, 10, 8), haloMat);
    halo.position.set(1.0, 5.2, 0); g.add(halo);
    // Guardamos referencia al halo para animarlo
    halo.userData.isLampHalo = true;
    lampHalos.push(haloMat);

    // Cono de luz proyectado hacia abajo (spotlight visual)
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xffee88, transparent: true, opacity: 0, side: THREE.BackSide,
    });
    const lightCone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4.5, 10, 1, true), coneMat);
    lightCone.position.set(1.0, 3.0, 0); g.add(lightCone);
    lampHalos.push(coneMat);  // misma animación

    scene.add(g);

    // PointLight real — mayor intensidad y radio para iluminar el suelo
    const light = new THREE.PointLight(0xffdd88, 0, 18);
    light.position.set(px + Math.sin(rotY) * 1.0, 5.2, pz + Math.cos(rotY) * 1.0);
    light.castShadow = false; // desactivar sombras en postes para no saturar la GPU
    scene.add(light);
    streetLampLights.push(light);

    return g;
  }

  // ── Lámparas a lo largo del camino de acceso principal ────────────────────
  for (let z = -14; z <= 2; z += 7) {
    buildStreetLamp(-16, z, Math.PI / 2);
    buildStreetLamp(-20, z, Math.PI / 2);
  }
  // ── Lámparas flanqueando senderos entre cabañas (resort ampliado) ─────────
  [-6.5, 11.5].forEach(x => {
    [3, 13, 23, 33].forEach(z => buildStreetLamp(x, z, 0));
  });
  // ── Acceso a casa principal ───────────────────────────────────────────────
  buildStreetLamp(-2.5, -11, Math.PI * 0.25);
  buildStreetLamp( 2.5, -11, -Math.PI * 0.25);
  // ── Zona planta desalinizadora ────────────────────────────────────────────
  buildStreetLamp(7,  -8, Math.PI / 2);
  buildStreetLamp(7, -12, Math.PI / 2);

  // ── Botón día / noche ──────────────────────────────────────────────────────
  // btnDayNight now lives in the sidebar
  const btnDayNight = document.getElementById('btn-day-night') || document.createElement('button');
  if (!btnDayNight.isConnected) btnDayNight.id = 'btn-day-night';
  btnDayNight.addEventListener('click', toggleDayNight);

  // ═══════════════════════════════════════════════════════════════════════════
  //  IDEA 1 — GAVIOTAS animadas sobrevolando la escena
  //  3 gaviotas en formación suelta, trazan arcos sobre el complejo
  // ═══════════════════════════════════════════════════════════════════════════
  const mBird = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const birds = [];
  function buildSeagull(orbitR, orbitY, orbitSpeed, phase) {
    const g = new THREE.Group();
    // Cuerpo
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.55, 6), mBird);
    body.rotation.z = Math.PI / 2; g.add(body);
    // Alas (dos triángulos planos)
    [-1, 1].forEach(side => {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.18), mBird);
      wing.position.set(0, 0, side * 0.28);
      wing.rotation.x = side * 0.25;
      wing.userData.side = side;
      g.add(wing);
    });
    scene.add(g);
    birds.push({ group: g, orbitR, orbitY, orbitSpeed, phase, wingPhase: Math.random() * Math.PI * 2 });
    return g;
  }
  buildSeagull(22, 14, 0.18, 0);
  buildSeagull(18, 17, 0.22, 2.1);
  buildSeagull(26, 12, 0.14, 4.3);

  // ═══════════════════════════════════════════════════════════════════════════
  //  IDEA 2 — VELERO en el mar, se balancea suavemente
  // ═══════════════════════════════════════════════════════════════════════════
  const mHull    = new THREE.MeshLambertMaterial({ color: 0xf5f0e8 });
  const mMast    = new THREE.MeshLambertMaterial({ color: 0xd4c090 });
  const mSail    = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const mSailRed = new THREE.MeshLambertMaterial({ color: 0xcc3322, side: THREE.DoubleSide });

  const sailboat = new THREE.Group();
  sailboat.position.set(34, 0, 8);  // en el mar

  // Casco
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.0, 0.8, 8), mHull);
  hull.position.y = 0.2; sailboat.add(hull);
  // Cubierta
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.15, 8), mMast);
  deck.position.y = 0.65; sailboat.add(deck);
  // Mástil
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 5.5, 6), mMast);
  mast.position.y = 3.5; sailboat.add(mast);
  // Vela principal (triángulo: ConeGeometry con radio=0 en la punta)
  const sail = new THREE.Mesh(new THREE.ConeGeometry(1.6, 4.2, 3, 1, true), mSail);
  sail.position.set(0.4, 3.2, 0); sail.rotation.y = Math.PI / 6; sailboat.add(sail);
  // Banderín rojo en la cima
  const pennant = new THREE.Mesh(new THREE.ConeGeometry(0, 0.4, 3, 1, true), mSailRed);
  pennant.position.y = 6.0; sailboat.add(pennant);

  scene.add(sailboat);

  // ═══════════════════════════════════════════════════════════════════════════
  //  IDEA 3 — PALMERAS QUE SE MECEN con el viento (fronds oscilan)
  //  Buscamos los grupos de palmeras ya creados y les añadimos animación
  // ═══════════════════════════════════════════════════════════════════════════
  // Recopilamos las palmas en un array para animarlas
  const palmGroups = [];
  scene.traverse(obj => {
    if (obj.isGroup && obj.children.some(c => c.isMesh && c.geometry?.parameters?.width === 0.5)) {
      // Cache the frond meshes directly — no geometry check needed in the animate loop
      const fronds = obj.children.filter(c => c.isMesh && c.geometry?.parameters?.width === 0.5);
      palmGroups.push({ group: obj, fronds, phase: Math.random() * Math.PI * 2 });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  IDEA 4 — INDICADOR DÍA/NOCHE en el canvas (top-left)
  // ═══════════════════════════════════════════════════════════════════════════
  const dayNightHUD = document.createElement('div');
  dayNightHUD.id = 'day-night-indicator';
  dayNightHUD.textContent = '☀️ Día';
  wrapper.appendChild(dayNightHUD);

  // Actualizar el indicador cuando cambia el modo
  const _origToggle = toggleDayNight;
  // Parcheamos toggleDayNight para también actualizar el HUD
  const _hudUpdate = () => {
    dayNightHUD.textContent = isNight ? '🌙 Noche' : '☀️ Día';
    dayNightHUD.classList.toggle('night', isNight);
  };
  btnDayNight.addEventListener('click', _hudUpdate);

  // ══ PANEL DE PRESIÓN del sistema ════════════════════════════════════════
  const pressureHUD = document.createElement('div');
  pressureHUD.id = 'pressure-hud';
  pressureHUD.innerHTML = `
    <div class="ph-title">⚙️ Presión del Sistema</div>
    <div class="ph-row"><span>Estanque</span>
      <div class="ph-bar-wrap"><div class="ph-bar" id="ph-bar-1" style="width:92%"></div></div>
      <span id="ph-val-1">9.2 bar</span></div>
    <div class="ph-row"><span>Casa Princ.</span>
      <div class="ph-bar-wrap"><div class="ph-bar" id="ph-bar-2" style="width:78%"></div></div>
      <span id="ph-val-2">7.8 bar</span></div>
    <div class="ph-row"><span>Cabañas</span>
      <div class="ph-bar-wrap"><div class="ph-bar" id="ph-bar-3" style="width:65%"></div></div>
      <span id="ph-val-3">6.5 bar</span></div>`;
  // pressureHUD exists in sidebar HTML — don't inject a duplicate
  // wrapper.appendChild(pressureHUD); — removed
  window._pressureDrop = false;

  // ── Cache DOM refs — never call getElementById inside animate() ──────────
  const _domPhBar = [
    document.getElementById('ph-bar-1'),
    document.getElementById('ph-bar-2'),
    document.getElementById('ph-bar-3'),
  ];
  const _domPhVal = [
    document.getElementById('ph-val-1'),
    document.getElementById('ph-val-2'),
    document.getElementById('ph-val-3'),
  ];
  // Re-query sidebar DOM refs after render (they exist in sidebar HTML)
  setTimeout(() => {
    for (let i=0;i<3;i++) {
      _domPhBar[i] = document.getElementById('ph-bar-'+(i+1)) || _domPhBar[i];
      _domPhVal[i] = document.getElementById('ph-val-'+(i+1)) || _domPhVal[i];
    }
    _domLitersCount = document.getElementById('liters-count') || _domLitersCount;
  }, 300);
  let _domLitersCount = null;
  setTimeout(() => { _domLitersCount = document.getElementById('liters-count'); }, 200);
  let _pressureFrame = 0; // throttle pressure DOM to every 4 frames

  // MEJORA 2 — Contador de litros perdidos en tiempo real durante fuga
  const litersHUD = document.createElement('div');
  litersHUD.id = 'liters-lost-hud';
  litersHUD.style.cssText = `display:none;position:absolute;top:50%;right:1.2rem;
    transform:translateY(-50%);background:rgba(140,20,20,.92);color:#fff;
    font-family:'Playfair Display',serif;padding:.7rem 1.1rem;border-radius:6px;
    border:1px solid rgba(255,100,100,.4);text-align:center;z-index:15;min-width:120px;`;
  litersHUD.innerHTML = `<div style="font-size:.7rem;letter-spacing:.1em;opacity:.8;text-transform:uppercase">Litros perdidos</div>
    <div id="liters-count" style="font-size:1.8rem;font-weight:700;color:#ffaaaa">0</div>
    <div style="font-size:.65rem;opacity:.7">litros / min estimado</div>`;
  wrapper.appendChild(litersHUD);
  let _litersLost = 0;
  let _litersInterval = null;

  // ══ REFLEJO LUNAR en el mar (de noche) ════════════════════════════════════
  const moonReflectMat = new THREE.MeshBasicMaterial({
    color:0xddeeff, transparent:true, opacity:0, depthWrite:false,
  });
  const moonReflect = new THREE.Mesh(new THREE.PlaneGeometry(3, 12), moonReflectMat);
  moonReflect.rotation.x = -Math.PI/2;
  moonReflect.position.set(38, 0.05, -10);
  scene.add(moonReflect);

  // ══ MUELLE / EMBARCADERO ══════════════════════════════════════════════════
  const mWood   = new THREE.MeshLambertMaterial({ color:0x8B6334 });
  const mWoodDk = new THREE.MeshLambertMaterial({ color:0x5c3d1e });
  const mBuoy   = new THREE.MeshLambertMaterial({ color:0xee4422 });
  const pier    = new THREE.Group();
  pier.position.set(20, 0, 18);
  for (let i=0; i<9; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.1,0.12,0.22), mWood);
    plank.position.set(i*1.1, 0.55, 0); pier.add(plank);
  }
  [-0.5,0.5].forEach(z => {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(10,0.16,0.12), mWoodDk);
    beam.position.set(4.5, 0.48, z); pier.add(beam);
  });
  [[0,0],[4.5,0],[9,0]].forEach(([x,z]) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.09,1.2,6), mWoodDk);
    post.position.set(x, 0, z); pier.add(post);
  });
  const buoyGroup = new THREE.Group();
  const buoyBody  = new THREE.Mesh(new THREE.SphereGeometry(0.28,8,6), mBuoy);
  buoyGroup.add(buoyBody);
  const buoyTop = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.5,6), mBuoy);
  buoyTop.position.y=0.55; buoyGroup.add(buoyTop);
  buoyGroup.position.set(10.5, 0.28, 0);
  pier.add(buoyGroup);
  scene.add(pier);

  // ══ MODO RADIOGRAFÍA ══════════════════════════════════════════════════════
  let xrayMode = false;
  const xrayMeshes = [];
  scene.traverse(obj => {
    if (obj.isMesh && obj.geometry) {
      const p = obj.position;
      if (p.y > 0.2 && p.x > -22 && p.x < 18 && p.z > -22 && p.z < 18) {
        xrayMeshes.push({ mesh:obj, origMat:obj.material });
      }
    }
  });

  // Cache blink meshes to avoid scene.traverse every frame
  const blinkMeshes = [];
  scene.traverse(obj => { if (obj.userData?.isBlink) blinkMeshes.push(obj); });
  // btnXray now lives in the sidebar
  const btnXray = document.getElementById('btn-xray') || (() => {
    const b = document.createElement('button'); b.id = 'btn-xray'; return b;
  })();
  // Guardamos materiales originales de la red de distribución para restaurarlos
  const pipeNetOrigMats = [];
  pipeNetGroup.traverse(obj => {
    if (obj.isMesh) pipeNetOrigMats.push({ mesh: obj, orig: obj.material });
  });

  btnXray.addEventListener('click', () => {
    xrayMode = !xrayMode;
    btnXray.classList.toggle('sb-active', xrayMode);
    const lbl = btnXray.querySelector('.sb-label');
    if (lbl) lbl.textContent = xrayMode ? 'Vista Normal' : 'Radiografía';
    else { btnXray.innerHTML = xrayMode ? '🔬 Vista Normal' : '🔬 Radiografía'; }

    const xrayBodyMat = new THREE.MeshLambertMaterial({
      color: 0x223344, transparent: true, opacity: 0.10, depthWrite: false,
    });

    // Edificios y objetos → casi transparentes
    xrayMeshes.forEach(({ mesh, origMat }) => {
      mesh.material = xrayMode ? xrayBodyMat : origMat;
    });

    // Tuberías principales → textura de agua neón animada
    scene.traverse(obj => {
      if (obj.isMesh && obj.material === mPipe) {
        obj.material = xrayMode ? mPipeXray : mPipe;
      }
    });

    // Red de distribución → siempre visible en xray, con su propia textura
    if (xrayMode) {
      pipeNetGroup.visible = true;
      pipeNetOrigMats.forEach(({ mesh }) => { mesh.material = mPipeNetXray; });
    } else {
      pipeNetOrigMats.forEach(({ mesh, orig }) => { mesh.material = orig; });
      // No ocultar la red si el usuario la activó manualmente
    }
  });
  // btnXray is in sidebar

  // ══ BOTÓN VISTA LIMPIA ════════════════════════════════════════════════════
  let uiHidden = false;
  const getUiElements = () => [
    document.getElementById('day-night-indicator'),
    document.getElementById('canvas-tooltip'),
    document.getElementById('cam-minimap'),
    document.getElementById('leak-timer-badge'),
  ].filter(Boolean);

  // btnClean now lives in the sidebar
  const btnClean = document.getElementById('btn-clean-view') || (() => {
    const b = document.createElement('button'); b.id = 'btn-clean-view'; return b;
  })();

  // Floating "exit" button injected on the canvas when Vista Limpia is active
  // (the sidebar is collapsed so we need another way to escape)
  function _buildCleanExitBtn() {
    if (document.getElementById('clean-exit-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'clean-exit-btn';
    btn.title = 'Salir de Vista Limpia (tecla V)';
    btn.innerHTML = '✦ <span>Mostrar UI</span>';
    btn.style.cssText = `
      position:absolute; top:0.7rem; left:50%; transform:translateX(-50%);
      background:rgba(15,30,22,.88); color:rgba(184,144,58,.9);
      border:1px solid rgba(184,144,58,.4); border-radius:20px;
      padding:0.32rem 1.1rem; font-family:'Playfair Display',serif;
      font-size:0.78rem; letter-spacing:0.1em; cursor:pointer;
      z-index:200; display:flex; align-items:center; gap:0.4rem;
      transition:background .18s, color .18s;
      box-shadow:0 2px 12px rgba(0,0,0,.4);
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(27,61,45,.97)';
      btn.style.color = '#ddb85a';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.background = 'rgba(15,30,22,.88)';
      btn.style.color = 'rgba(184,144,58,.9)';
    });
    btn.addEventListener('click', () => btnClean.click());
    wrapper.appendChild(btn);
  }
  function _removeCleanExitBtn() {
    document.getElementById('clean-exit-btn')?.remove();
  }

  btnClean.addEventListener('click', () => {
    uiHidden = !uiHidden;
    // Collapse/expand both sidebars via .collapsed (canvas resizes correctly)
    const sidebarL = document.getElementById('sidebar-left');
    const sidebarR = document.getElementById('sidebar-right');
    [sidebarL, sidebarR].forEach(sb => {
      if (!sb) return;
      if (uiHidden) {
        sb.dataset.wasCollapsed = sb.classList.contains('collapsed') ? '1' : '0';
        sb.classList.add('collapsed');
      } else {
        if (sb.dataset.wasCollapsed === '0') sb.classList.remove('collapsed');
      }
    });
    // Hide/show floating canvas UI elements
    getUiElements().forEach(el => {
      el.style.transition = 'opacity 0.3s ease';
      el.style.opacity    = uiHidden ? '0' : '1';
      el.style.pointerEvents = uiHidden ? 'none' : '';
    });
    // Show/hide the floating escape button
    if (uiHidden) _buildCleanExitBtn(); else _removeCleanExitBtn();
    btnClean.classList.toggle('sb-active', uiHidden);
    const lbl = btnClean.querySelector('.sb-label');
    if (lbl) lbl.textContent = uiHidden ? 'Mostrar UI' : 'Vista Limpia';
    else btnClean.innerHTML = uiHidden ? '✦ Mostrar UI' : '✦ Vista Limpia';
    // Trigger canvas resize after sidebar CSS transition finishes (0.28s)
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
  });

  // Keyboard shortcut V to toggle clean view
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'v' || e.key === 'V') btnClean.click();
  });
  // btnClean is in sidebar

  // MEJORA 4 — Panel de estadísticas de la sesión (se actualiza desde leaks.js via window)
  const statsHUD = document.createElement('div');
  statsHUD.id = 'session-stats-hud';
  statsHUD.style.cssText = `position:absolute;bottom:1.2rem;right:1.2rem;
    background:rgba(27,61,45,.82);color:rgba(255,255,255,.75);
    font-family:'Crimson Pro',serif;font-size:.75rem;padding:.45rem .9rem;
    border-radius:20px;border:1px solid rgba(184,144,58,.3);z-index:10;
    pointer-events:none;white-space:nowrap;`;
  statsHUD.innerHTML = '💧 0 fugas · 0 s tiempo activo';
  wrapper.appendChild(statsHUD);
  // Update stats on leak events only (not on a polling interval)
  window.addEventListener('leak:state:change', () => {
    const state = window._getLeakState?.();
    if (!state) return;
    statsHUD.textContent = `💧 ${state.totalLeaks} fuga${state.totalLeaks!==1?'s':''} · ${state.history.length} resuelta${state.history.length!==1?'s':''}`;
  });

  // MEJORA 5 — Captura canvas con preserveDrawingBuffer (para Ctrl+Shift+P)
  // Re-crear renderer con preserveDrawingBuffer:true si no está activo
  window.addEventListener('capture:request', () => {
    renderer.render(scene, camera); // forzar un frame
  });

  // ─── Init Leaks ───────────────────────────────────────────────────────────
  initLeaks(scene);

  // ─── Resize ───────────────────────────────────────────────────────────────
  function resize() {
    renderer.setSize(wrapper.clientWidth, wrapper.clientHeight, false);
    camera.aspect = wrapper.clientWidth / wrapper.clientHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  // ResizeObserver handles cases where the canvas container changes size
  // without a window resize (e.g., sidebar toggle)
  if (window.ResizeObserver) {
    new ResizeObserver(() => resize()).observe(wrapper);
  }
  resize();

  // ─── Loop ─────────────────────────────────────────────────────────────────
  const clock3 = new THREE.Clock();
  let pipeOffset = 0;

  // cloudLastT used by cloud color throttle
  let cloudLastT = -1;

  function animate() {
    requestAnimationFrame(animate);
    const rawDelta = clock3.getDelta();
    const delta    = Math.min(rawDelta, 0.05); // cap at 50ms — prevents spiral when tab is hidden
    const elapsed  = clock3.getElapsedTime();

    seaUniforms.uTime.value  = elapsed;
    seaUniforms.uNight.value = dayNightProgress;

    // Tuberías: flujo se DETIENE cuando hay fuga activa (realismo hidráulico)
    // window._leakActive es seteado por leaks.js
    const leakActive = !!window._leakActive;

    const prevPipeOffset = pipeOffset;
    if (!leakActive) {
      pipeOffset = ((pipeOffset - delta * 55) % 256 + 256) % 256;
    }
    // Solo redibujar si el offset realmente cambió (optimización de rendimiento)
    if (pipeOffset !== prevPipeOffset) {
      drawPipeTexture(pipeOffset);
      pipeTex.needsUpdate = true;
    }

    const prevXrayOffset = xrayTexOffset;
    if (!leakActive) {
      xrayTexOffset = ((xrayTexOffset - delta * 80) % 256 + 256) % 256;
    }
    if (xrayTexOffset !== prevXrayOffset) {
      drawXrayTexture(xrayTexOffset);
      xrayTex.needsUpdate = true;
    }

    updateDayNight(delta);

    // ── Gaviotas orbitando ─────────────────────────────────────────
    birds.forEach(b => {
      const t = elapsed * b.orbitSpeed + b.phase;
      b.group.position.set(
        Math.cos(t) * b.orbitR,
        b.orbitY + Math.sin(elapsed * 0.6 + b.phase) * 0.8,
        Math.sin(t) * b.orbitR
      );
      // Orientar en la dirección del vuelo
      b.group.rotation.y = -t - Math.PI / 2;
      // Batir de alas (oscilar las PlaneGeometry en Z local)
      b.wingPhase += delta * 3.5;
      b.group.children.forEach(c => {
        if (c.userData?.side !== undefined)
          c.rotation.x = c.userData.side * (0.15 + Math.sin(b.wingPhase) * 0.35);
      });
    });

    // MEJORA 6 — Sol recorre un arco en el cielo durante el día
    const sunAngle = elapsed * 0.04 - Math.PI * 0.3;
    sunSphere.position.set(
      Math.cos(sunAngle) * 70,
      Math.abs(Math.sin(sunAngle)) * 55 + 10,
      -60 + Math.sin(sunAngle) * 20
    );
    sunHaloMat.opacity = (0.06 + Math.sin(elapsed * 0.8) * 0.03) * (1 - dayNightProgress);
    // sunHalo es hijo de sunSphere — sigue su posición automáticamente
    // Luna en arco opuesto
    moonSphere.position.set(
      Math.cos(sunAngle + Math.PI) * 55,
      Math.abs(Math.sin(sunAngle + Math.PI)) * 40 + 8,
      -60
    );

    // ── Velero balanceándose ────────────────────────────────────────
    sailboat.rotation.z = Math.sin(elapsed * 0.4) * 0.06;
    sailboat.rotation.x = Math.sin(elapsed * 0.3 + 1.2) * 0.04;
    sailboat.position.x = 34 + Math.sin(elapsed * 0.15) * 1.2;
    sailboat.position.z =  8 + Math.cos(elapsed * 0.18) * 0.8;

    // ── Palmeras meciéndose con el viento ──────────────────────────
    palmGroups.forEach(p => {
      const sway = Math.sin(elapsed * 0.7 + p.phase) * 0.025;
      p.fronds.forEach(c => { c.rotation.z += (sway - c.rotation.z) * 0.08; });
    });

    // ── Nubes moviéndose ───────────────────────────────────────────
    const t = dayNightProgress;
    // Only push color/opacity to GPU when dayNight changed meaningfully
    const _cloudColorDirty = Math.abs(t - (cloudLastT ?? -1)) > 0.005;
    if (_cloudColorDirty) cloudLastT = t;
    const _cr = 1-t*0.7, _cg = 1-t*0.7, _cb = 1-t*0.5, _cop = 0.82 - t*0.3;
    clouds.forEach(c => {
      c.group.position.x += c.spd * delta;
      if (c.group.position.x > 70) c.group.position.x = c.baseX - 70;
      if (_cloudColorDirty) {
        c.group.children.forEach(ch => {
          if (ch.isMesh) { ch.material.color.setRGB(_cr,_cg,_cb); ch.material.opacity = _cop; }
        });
      }
    });

    // MEJORA 7 — Estrellas centelleando de noche
    if (stars.visible) {
      stars.material.opacity = 0.6 + Math.sin(elapsed * 2.1) * 0.2;
      stars.material.size    = 0.55 + Math.sin(elapsed * 1.3) * 0.15;
      // needsUpdate not needed for opacity/size — they're uniforms, not attributes
    }

    // ── Peces nadando ──────────────────────────────────────────────
    fishMeshes.forEach(f => {
      f.userData.phase += delta * 0.9;
      f.position.x += Math.sin(f.userData.phase * 1.1) * delta * 0.5;
      f.position.z += Math.cos(f.userData.phase * 0.8) * delta * 0.3;
      f.position.y  = -1.2 + Math.sin(f.userData.phase * 1.5) * 0.3;
      if (Math.abs(f.position.x) > 5) f.position.x *= -0.95;
      if (Math.abs(f.position.z) > 4) f.position.z *= -0.95;
      f.rotation.y = Math.atan2(Math.sin(f.userData.phase*1.1), Math.cos(f.userData.phase*0.8));
    });

    // ── Humo de chimeneas ──────────────────────────────────────────
    // Color/opacity shared per chimney — computed once, not per-particle
    const _smokeMax  = THREE.MathUtils.lerp(0.35, 0.55, dayNightProgress);
    const _smokeGray = THREE.MathUtils.lerp(0.73, 0.4,  dayNightProgress);
    smokeMats[0].color.setScalar(_smokeGray);
    smokeMats[1].color.setScalar(_smokeGray);
    let _s0sum = 0, _s1sum = 0;
    smokeParticles.forEach(p => {
      p._life += p._speed;
      if (p._life > 1) p._life = 0;
      const ph = p._life;
      p.position.y = p._baseY + ph * 3.5;
      p.position.x += Math.sin(elapsed * 0.4 + p._baseY) * delta * 0.08;
      p.scale.setScalar(0.5 + ph * 1.5);
      const op = ph < 0.3 ? ph / 0.3 * _smokeMax : (1 - ph) * _smokeMax;
      if (p._chiIdx === 0) _s0sum += op; else _s1sum += op;
    });
    smokeMats[0].opacity = _s0sum / 8;
    smokeMats[1].opacity = _s1sum / 8;

    // Autos en movimiento eliminados

    // MEJORA 10: Animaciones de sol, arcoíris, agua, antena
    // (sunHaloMat.opacity ya se actualiza arriba en el bloque del sol)



    // Disco de agua del estanque sube y baja levemente
    waterDiscTimer += delta;
    waterDisc.position.y = TANK_BASE_Y + TANK_H * 0.72 + Math.sin(waterDiscTimer * 0.9) * 0.04;
    waterDisc.material.opacity = 0.75 + Math.sin(waterDiscTimer * 1.5) * 0.1;

    // Luz parpadeante de antena (usa caché, sin traverse por frame)
    const blinkOn = Math.sin(elapsed * 4) > 0.6;
    blinkMeshes.forEach(m => { m.visible = blinkOn; });

    // MEJORA 8 — Piscina: caustics animados + brillo según luz solar/lunar
    const poolBrightness = THREE.MathUtils.lerp(0.35, 0.18, dayNightProgress);
    if (pool.material.color) pool.material.color.setHSL(0.58, 0.75 - dayNightProgress * 0.3, poolBrightness + Math.sin(elapsed*1.2)*0.05);
    pool.material.opacity = 0.82 + Math.sin(elapsed*0.9)*0.08;

    // ── Reflejo lunar ──────────────────────────────────────────────
    moonReflectMat.opacity = dayNightProgress * 0.35 * (0.85 + Math.sin(elapsed*0.5)*0.15);

    // ── Boya del muelle subiendo y bajando ─────────────────────────
    buoyGroup.position.y = 0.28 + Math.sin(elapsed * 1.1) * 0.12;

    // Contador de litros — usa ref cacheada, sin getElementById por frame
    if (leakActive) {
      litersHUD.style.display = 'block';
      const rate = (window._leakSize || 0.5) * 2.0;
      _litersLost += rate * delta;
      if (_domLitersCount) _domLitersCount.textContent = _litersLost.toFixed(1);
      // Also update sidebar counter if present
      const sbLiters = document.getElementById('lc-value');
      if (sbLiters) sbLiters.textContent = _litersLost.toFixed(1) + ' L';
    } else if (_litersLost > 0) {
      litersHUD.style.display = 'none';
      _litersLost = 0;
      if (_domLitersCount) _domLitersCount.textContent = '0';
      const sbLiters = document.getElementById('lc-value');
      if (sbLiters) sbLiters.textContent = '0 L';
    }

    // ── Panel de presión: pulsa de día / cae dramáticamente en fuga ───────
    // Presión: throttle DOM updates to every 4 frames (~15fps) — imperceptible to eye
    _pressureFrame = (_pressureFrame + 1) % 4;
    if (_pressureFrame === 0) {
      const [b0,b1,b2] = _domPhBar;
      const [v0,v1,v2] = _domPhVal;
      if (!window._pressureDrop) {
        const p1 = 88 + Math.sin(elapsed*0.4)*4;
        const p2 = 74 + Math.sin(elapsed*0.5+1)*3;
        const p3 = 61 + Math.sin(elapsed*0.6+2)*3;
        if (b0) { b0.style.width=p1+'%'; b0.style.background=''; v0.textContent=(p1/10).toFixed(1)+' bar'; }
        if (b1) { b1.style.width=p2+'%'; b1.style.background=''; v1.textContent=(p2/10).toFixed(1)+' bar'; }
        if (b2) { b2.style.width=p3+'%'; b2.style.background=''; v2.textContent=(p3/10).toFixed(1)+' bar'; }
      } else {
        const drop = Math.max(0, 1 - (elapsed % 10) / 8);
        const p1 = (88 + Math.sin(elapsed*0.4)*4) * 0.92;
        const p2 = (74 + Math.sin(elapsed*0.5+1)*3) * 0.55;
        const p3 = Math.max(2, 61 * drop * 0.3);
        if (b0) { b0.style.width=p1+'%'; b0.style.background=''; v0.textContent=(p1/10).toFixed(1)+' bar'; }
        if (b1) { b1.style.width=p2+'%'; b1.style.background='#e06020'; v1.textContent=(p2/10).toFixed(1)+' bar ⚠️'; }
        if (b2) { b2.style.width=Math.max(p3,2)+'%'; b2.style.background='#cc2222'; v2.textContent=(p3/10).toFixed(2)+' bar 🚨'; }
      }
    }

    updateControls(delta);
    updateLeaks();
    renderer.render(scene, camera);
  }
  animate();
}