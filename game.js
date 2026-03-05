import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';

// ============================================
// CONFIGURATION
// ============================================
const CFG = {
  player: {
    height: 1.7, radius: 0.4,
    speed: 7, sprintMul: 1.6,
    jumpForce: 9, gravity: 25,
    maxHP: 100, maxStamina: 100, maxShield: 100,
    staminaDrain: 30, staminaRegen: 12,
    sensitivity: 0.002,
    healthOnKill: 25,
  },
  weapon: {
    semiRate: 0.16, autoRate: 0.085,
    dmg: 25, headshotMul: 2.5,
    recoilUp: 0.025, recoilSide: 0.012,
    recoilRecovery: 3.5,
    maxAmmo: 30, reloadTime: 2.0,
    normalFOV: 75, adsFOV: 40,
    adsSensMul: 0.4,
  },
  enemy: {
    count: 8, maxHP: 100,
    speed: 3.5, detectRange: 40,
    attackRange: 28, fireRate: 1.3,
    dmg: 8, respawnTime: 5,
    patrolRadius: 30,
  },
  map: { size: 200 },
};

// ============================================
// STATE
// ============================================
let scene, camera, renderer, clock;
let isPlaying = false, gameOver = false, pointerLocked = false;

const player = {
  hp: CFG.player.maxHP, shield: CFG.player.maxShield, stamina: CFG.player.maxStamina,
  yVel: 0, grounded: true, sprinting: false, staminaDepleted: false, ads: false, pitch: 0,
  kills: 0, deaths: 0,
  wasInAir: false, bunnyHopT: 0,
};

const wpn = {
  mode: 'SEMI', ammo: CFG.weapon.maxAmmo,
  reloading: false, reloadT: 0, fireT: 0,
  recoilOff: 0, flashT: 0,
};

const keys = {};
let mouseL = false, mouseR = false;
const collidables = [];
const collidableMeshes = [];
const shieldOrbs = [];
const enemies = [];
let gunGroup, muzzleFlash, muzzleLight;
let gunMixer = null;
let gunAnims = { idle: null, reload: null, shoot: null };
let audioCtx;
let bobT = 0;
let reloadDiv = null;

// ============================================
// CHEAT STATE
// ============================================
const cheat = {
  menuOpen: false,
  aimbot: false,
  aimbotSmooth: 8,
  aimbotTarget: 'body',
  fovEnabled: false,
  fovRadius: 120,
  fovColor: '#00ff88',
  infiniteAmmo: false,
  esp: false,
  espBox: true,
  espName: true,
  espHealth: true,
};
let fovCanvas, fovCtx;
let espCanvas, espCtx;


// DOM
const dom = {
  menu: document.getElementById('main-menu'),
  respawn: document.getElementById('respawn-menu'),
  hud: document.getElementById('hud'),
  crosshair: document.getElementById('crosshair'),
  lockPrompt: document.getElementById('lock-prompt'),
  healthBar: document.getElementById('health-bar'),
  healthTxt: document.getElementById('health-text'),
  shieldBar: document.getElementById('shield-bar'),
  shieldTxt: document.getElementById('shield-text'),
  staminaBar: document.getElementById('stamina-bar'),
  fireMode: document.getElementById('fire-mode'),
  ammo: document.getElementById('ammo-counter'),
  flash: document.getElementById('damage-flash'),
  killFeed: document.getElementById('kill-feed'),
  kdDisplay: document.getElementById('kd-display'),
  healIndicator: document.getElementById('heal-indicator'),
  topKillsBar: document.getElementById('top-kills-bar'),
  topKillsList: document.getElementById('top-kills-list'),
};

// ============================================
// THREE.JS SETUP
// ============================================
function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6fa8dc);
  scene.fog = new THREE.FogExp2(0x6fa8dc, 0.007);

  camera = new THREE.PerspectiveCamera(CFG.weapon.normalFOV, innerWidth / innerHeight, 0.1, 500);
  camera.position.set(0, CFG.player.height, 0);
  scene.add(camera);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  document.getElementById('game-container').appendChild(renderer.domElement);

  clock = new THREE.Clock();

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.4));
  scene.add(new THREE.HemisphereLight(0x87CEEB, 0x556B2F, 0.35));

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.1);
  sun.position.set(60, 80, 40);
  sun.castShadow = true;
  const s = sun.shadow;
  s.mapSize.set(2048, 2048);
  s.camera.near = 0.5; s.camera.far = 250;
  s.camera.left = s.camera.bottom = -100;
  s.camera.right = s.camera.top = 100;
  scene.add(sun);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

// ============================================
// AUDIO (Procedural)
// ============================================
function initAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function noiseBuf(dur) {
  const len = dur * audioCtx.sampleRate;
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function playSound(freq, dur, vol, type, filterFreq, filterQ) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  if (type === 'noise') {
    const src = audioCtx.createBufferSource();
    src.buffer = noiseBuf(dur);
    const bp = audioCtx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = filterFreq || 800; bp.Q.value = filterQ || 0.8;
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp); bp.connect(g); g.connect(audioCtx.destination);
    src.start(t); src.stop(t + dur);
    return;
  }
  const osc = audioCtx.createOscillator();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t);
  if (filterFreq) osc.frequency.exponentialRampToValueAtTime(filterFreq, t + dur);
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t); osc.stop(t + dur);
}

function sfxGunshot() {
  playSound(0, 0.14, 0.5, 'noise', 1000, 0.6);
  playSound(150, 0.1, 0.4, 'sine', 40);
}
function sfxEnemyShot() { playSound(0, 0.1, 0.18, 'noise', 600, 1.2); }
function sfxRemoteGunshot() {
  if (!audioCtx) initAudio();
  playSound(0, 0.1, 0.25, 'noise', 900, 0.7);
  playSound(120, 0.08, 0.2, 'sine', 50);
}
window.__wz_sfxRemoteGunshot = sfxRemoteGunshot;
function sfxHitmarker() { playSound(1800, 0.08, 0.25, 'sine'); }
function sfxModeSwitch() { playSound(900, 0.04, 0.12, 'square'); playSound(1300, 0.03, 0.1, 'square'); }
function sfxReload() {
  playSound(300, 0.05, 0.1, 'square');
  setTimeout(() => playSound(500, 0.04, 0.12, 'square'), 900);
  setTimeout(() => playSound(250, 0.06, 0.1, 'sawtooth'), 1500);
}

// ============================================
// MAP
// ============================================
function createMap() {
  // Ground
  const gnd = new THREE.Mesh(
    new THREE.PlaneGeometry(CFG.map.size, CFG.map.size, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x4a6741, roughness: 0.9 })
  );
  gnd.rotation.x = -Math.PI / 2; gnd.receiveShadow = true;
  scene.add(gnd);

  const grid = new THREE.GridHelper(CFG.map.size, 80, 0x3a5731, 0x3a5731);
  grid.position.y = 0.02; grid.material.opacity = 0.12; grid.material.transparent = true;
  scene.add(grid);

  // Buildings
  const blds = [
    [30, 30, 16, 10, 14, 0x8B8682], [-25, 40, 12, 8, 10, 0x9C9087],
    [45, -20, 10, 6, 10, 0x7D7468], [-40, -35, 8, 14, 8, 0x6B6560],
    [0, -50, 22, 7, 12, 0x8C8278], [55, 55, 8, 6, 8, 0x9B9080],
    [-55, 5, 14, 7, 10, 0x7A7065], [20, -65, 10, 6, 10, 0x8A8070],
    [-15, -10, 8, 5, 6, 0x888078], [65, -50, 12, 8, 12, 0x7C7268],
    [-65, 50, 10, 9, 10, 0x847A70], [40, 65, 14, 6, 8, 0x8A8075],
  ];
  blds.forEach(b => addBox(b[0], b[1], b[2], b[3], b[4], b[5], true));

  // Walls
  const walls = [
    [10, 10, 6, 2.5, 0.5, 0x696969], [-10, 20, 0.5, 2.5, 8, 0x696969],
    [35, -5, 4, 2, 0.5, 0x696969], [-30, -15, 0.5, 2, 6, 0x696969],
    [15, 55, 8, 2.5, 0.5, 0x696969], [-45, 25, 0.5, 2.5, 5, 0x696969],
    [50, 10, 5, 2, 0.5, 0x696969], [-5, -30, 0.5, 2, 7, 0x696969],
    [70, 30, 6, 2, 0.5, 0x696969], [-70, -10, 0.5, 2.5, 6, 0x696969],
  ];
  walls.forEach(w => addBox(w[0], w[1], w[2], w[3], w[4], w[5], false));

  // Crates
  const crates = [
    [5, 5, 1.2], [-8, -5, 1], [22, 15, 1.5], [-20, 10, 1],
    [40, 40, 1.2], [-35, -50, 1], [60, 0, 1.5], [-60, -20, 1.2],
    [30, -40, 1], [-10, 50, 1.2], [75, -30, 1], [-75, 35, 1.3],
  ];
  crates.forEach(c => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(c[2], c[2], c[2]),
      new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.8 })
    );
    m.position.set(c[0], c[2] / 2, c[1]); m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    collidableMeshes.push(m);
    collidables.push(new THREE.Box3().setFromObject(m));
  });

  // Shield orbs
  const orbPositions = [
    [15, 15], [-20, 25], [40, -15], [-35, -40], [0, -45],
    [55, 50], [-50, 10], [25, -60], [-15, -5], [60, -25],
    [-60, 45], [35, 60], [-70, -25], [70, 20], [-25, -55],
  ];
  orbPositions.forEach(([x, z]) => {
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.9 })
    );
    orb.position.set(x, 0.5, z);
    orb.userData = { pickedUp: false, respawnT: 0 };
    scene.add(orb);
    shieldOrbs.push(orb);
  });

  // Boundary
  const h2 = CFG.map.size / 2;
  [
    [-h2, 0, 1, CFG.map.size], [h2, 0, 1, CFG.map.size],
    [0, -h2, CFG.map.size, 1], [0, h2, CFG.map.size, 1],
  ].forEach(b => {
    collidables.push(new THREE.Box3(
      new THREE.Vector3(b[0] - b[2] / 2, 0, b[1] - b[3] / 2),
      new THREE.Vector3(b[0] + b[2] / 2, 10, b[1] + b[3] / 2)
    ));
  });
}

function addBox(x, z, w, h, d, color, isBuilding) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness: 0.75 })
  );
  m.position.set(x, h / 2, z); m.castShadow = true; m.receiveShadow = true;
  scene.add(m);
  collidableMeshes.push(m);
  if (isBuilding && h > 4) {
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.6, 0.35, d + 0.6),
      new THREE.MeshStandardMaterial({ color: 0x555555 })
    );
    roof.position.set(x, h + 0.17, z); roof.castShadow = true;
    scene.add(roof);
    collidableMeshes.push(roof);
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x334455, emissive: 0x112233, emissiveIntensity: 0.3 });
    for (let i = 0; i < 3; i++) {
      const wn = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.5), windowMat);
      wn.position.set(x - w / 2 - 0.01, h * 0.55, z - d / 3 + i * (d / 3));
      wn.rotation.y = -Math.PI / 2;
      scene.add(wn);
    }
  }
  collidables.push(new THREE.Box3().setFromObject(m));
}

// ============================================
// WEAPON MODEL
// ============================================
function createWeapon() {
  // Remove old gun if switching
  if (gunGroup) {
    camera.remove(gunGroup);
    gunGroup = null;
    gunMixer = null;
    gunAnims = { idle: null, reload: null, shoot: null };
  }

  gunGroup = new THREE.Group();
  const selectedWeapon = window.__selectedWeapon || 'akm';
  console.log('[GAME] Loading weapon:', selectedWeapon);

  if (selectedWeapon === 'watergun') {
    loadWaterGun();
  } else {
    loadAKM();
  }

  muzzleFlash = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0 })
  );
  muzzleFlash.position.set(0, 0.03, -0.65);
  gunGroup.add(muzzleFlash);

  muzzleLight = new THREE.PointLight(0xffaa00, 0, 6);
  muzzleLight.position.copy(muzzleFlash.position); gunGroup.add(muzzleLight);

  gunGroup.position.set(0.28, -0.24, -0.48);
  camera.add(gunGroup);
}

function loadAKM() {
  const loader = new FBXLoader();
  loader.load('Assets/FpsAKM.fbx', (fbx) => {
    fbx.scale.setScalar(0.00042);
    fbx.rotation.set(0, Math.PI / 2, 0);
    fbx.position.set(0, -0.02, 0);
    fbx.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.material) {
          child.material.metalness = 0.6;
          child.material.roughness = 0.4;
        }
      }
    });
    gunGroup.add(fbx);

    // Setup animation mixer
    if (fbx.animations && fbx.animations.length > 0) {
      gunMixer = new THREE.AnimationMixer(fbx);
      fbx.animations.forEach(clip => {
        const name = clip.name.toLowerCase();
        if (name.includes('idle')) gunAnims.idle = gunMixer.clipAction(clip);
        else if (name.includes('reload')) gunAnims.reload = gunMixer.clipAction(clip);
        else if (name.includes('shoot') || name.includes('fire')) gunAnims.shoot = gunMixer.clipAction(clip);
      });
      if (gunAnims.idle) {
        gunAnims.idle.play();
      }
      if (gunAnims.shoot) {
        gunAnims.shoot.setLoop(THREE.LoopOnce);
        gunAnims.shoot.clampWhenFinished = false;
      }
      if (gunAnims.reload) {
        gunAnims.reload.setLoop(THREE.LoopOnce);
        gunAnims.reload.clampWhenFinished = true;
        gunMixer.addEventListener('finished', (e) => {
          if (e.action === gunAnims.reload && gunAnims.idle) {
            gunAnims.idle.reset().play();
          }
        });
      }
    }
  }, undefined, (err) => {
    console.error('FBX load error:', err);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.075, 0.44),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.8, roughness: 0.3 })
    );
    gunGroup.add(body);
  });
}

function loadWaterGun() {
  const mtlLoader = new MTLLoader();
  mtlLoader.setPath('Assets/Water gun/');
  mtlLoader.load('materials.mtl', (materials) => {
    materials.preload();
    const objLoader = new OBJLoader();
    objLoader.setMaterials(materials);
    objLoader.setPath('Assets/Water gun/');
    objLoader.load('model.obj', (obj) => {
      obj.scale.setScalar(1.8);
      obj.rotation.set(0, Math.PI / 2, 0);
      obj.position.set(0.02, -0.12, -0.25);
      obj.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      gunGroup.add(obj);
    }, undefined, (err) => {
      console.error('OBJ load error:', err);
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.1, 0.3),
        new THREE.MeshStandardMaterial({ color: 0x00aaff })
      );
      gunGroup.add(body);
    });
  }, undefined, (err) => {
    console.error('MTL load error:', err);
    // Fallback: load OBJ without materials
    const objLoader = new OBJLoader();
    objLoader.setPath('Assets/Water gun/');
    objLoader.load('model.obj', (obj) => {
      obj.scale.setScalar(1.8);
      obj.rotation.set(0, Math.PI / 2, 0);
      obj.position.set(0.02, -0.12, -0.25);
      gunGroup.add(obj);
    });
  });
}

// ============================================
// LOADOUT PREVIEW (3D rotating weapon previews)
// ============================================
let previewAnimFrame = null;
window.__initLoadoutPreviews = function () {
  // Clean up any previous previews
  if (previewAnimFrame) cancelAnimationFrame(previewAnimFrame);

  const previews = [];

  function setupPreview(canvasId, weaponType) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const w = 300, h = 220;
    const pRenderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    pRenderer.setSize(w, h);
    pRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    pRenderer.setClearColor(0x000000, 0);

    const pScene = new THREE.Scene();
    pScene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dLight.position.set(2, 3, 4);
    pScene.add(dLight);

    const pCam = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    pCam.position.set(0, 0.5, 3);
    pCam.lookAt(0, 0, 0);

    const group = new THREE.Group();
    pScene.add(group);

    if (weaponType === 'akm') {
      const loader = new FBXLoader();
      loader.load('Assets/FpsAKM.fbx', (fbx) => {
        fbx.scale.setScalar(0.008);
        fbx.position.set(0, -0.5, 0);
        fbx.traverse(c => { if (c.isMesh && c.material) { c.material.metalness = 0.6; c.material.roughness = 0.4; } });
        group.add(fbx);
      });
    } else {
      const mtlLoader = new MTLLoader();
      mtlLoader.setPath('Assets/Water gun/');
      mtlLoader.load('materials.mtl', (materials) => {
        materials.preload();
        const objLoader = new OBJLoader();
        objLoader.setMaterials(materials);
        objLoader.setPath('Assets/Water gun/');
        objLoader.load('model.obj', (obj) => {
          obj.scale.setScalar(0.4);
          obj.position.set(0, -0.3, 0);
          group.add(obj);
        });
      });
    }

    return { renderer: pRenderer, scene: pScene, camera: pCam, group };
  }

  const p1 = setupPreview('preview-akm', 'akm');
  const p2 = setupPreview('preview-watergun', 'watergun');
  if (p1) previews.push(p1);
  if (p2) previews.push(p2);

  function animatePreviews() {
    previewAnimFrame = requestAnimationFrame(animatePreviews);
    const t = Date.now() * 0.001;
    previews.forEach(p => {
      p.group.rotation.y = t * 0.5;
      p.renderer.render(p.scene, p.camera);
    });
  }
  animatePreviews();
};

// ============================================
// COLLISION
// ============================================
function checkCollision(pos) {
  const r = CFG.player.radius, h = CFG.player.height;
  const pb = new THREE.Box3(
    new THREE.Vector3(pos.x - r, pos.y - h, pos.z - r),
    new THREE.Vector3(pos.x + r, pos.y + 0.2, pos.z + r)
  );
  for (let i = 0; i < collidables.length; i++) {
    if (pb.intersectsBox(collidables[i])) return true;
  }
  return false;
}

function hasLOSFromCamera(toPos, excludeMeshes) {
  const from = camera.position.clone();
  const to = toPos.clone();
  const dist = from.distanceTo(to);
  const dir = to.clone().sub(from).normalize();
  const rc = new THREE.Raycaster(from, dir, 0.01, dist + 0.5);
  const hits = rc.intersectObjects(collidableMeshes, false);
  for (const h of hits) {
    if (excludeMeshes && excludeMeshes.includes(h.object)) continue;
    if (h.distance < dist - 0.1) return false;
  }
  return true;
}

function getRandomSpawnPosition() {
  const half = CFG.map.size / 2 - 15;
  for (let i = 0; i < 50; i++) {
    const x = (Math.random() * 2 - 1) * half;
    const z = (Math.random() * 2 - 1) * half;
    const pos = new THREE.Vector3(x, CFG.player.height, z);
    if (!checkCollision(pos)) return pos;
  }
  return new THREE.Vector3(0, CFG.player.height, 0);
}

// ============================================
// PLAYER UPDATE
// ============================================
function updatePlayer(dt) {
  if (!isPlaying || gameOver) return;

  // Sprint — must wait for full recharge once depleted
  player.sprinting = keys['ShiftLeft'] && !player.staminaDepleted &&
    player.stamina > 0 && (keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD']);

  // Stamina
  if (player.sprinting) {
    player.stamina = Math.max(0, player.stamina - CFG.player.staminaDrain * dt);
    if (player.stamina <= 0) player.staminaDepleted = true;
  } else {
    player.stamina = Math.min(CFG.player.maxStamina, player.stamina + CFG.player.staminaRegen * dt);
    if (player.stamina >= CFG.player.maxStamina) player.staminaDepleted = false;
  }

  // Bunny hop — speed boost when running and jumping
  if (!player.grounded && (keys['KeyW'] || keys['KeyS'] || keys['KeyA'] || keys['KeyD'])) {
    player.bunnyHopT = 0.1; // maintain boost state
  } else if (player.bunnyHopT > 0) {
    player.bunnyHopT -= dt;
  }
  const bunnyMul = (player.bunnyHopT > 0 || !player.grounded) ? 1.35 : 1;

  // Move direction
  const spd = CFG.player.speed * (player.sprinting ? CFG.player.sprintMul : 1) * bunnyMul * dt;
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const rgt = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

  const mv = new THREE.Vector3();
  if (keys['KeyW']) mv.add(fwd);
  if (keys['KeyS']) mv.sub(fwd);
  if (keys['KeyD']) mv.add(rgt);
  if (keys['KeyA']) mv.sub(rgt);
  if (mv.length() > 0) mv.normalize().multiplyScalar(spd);

  // Gravity / Jump
  if (!player.grounded) player.yVel -= CFG.player.gravity * dt;
  if (keys['Space'] && player.grounded) { player.yVel = CFG.player.jumpForce; player.grounded = false; }

  // Move with collision (axis-separated)
  const np = camera.position.clone();
  np.x += mv.x; if (checkCollision(np)) np.x = camera.position.x;
  np.z += mv.z; if (checkCollision(np)) np.z = camera.position.z;
  np.y += player.yVel * dt;
  if (np.y <= CFG.player.height) { np.y = CFG.player.height; player.yVel = 0; player.grounded = true; }
  camera.position.copy(np);

  // Shield orb pickup
  const px = camera.position.x, pz = camera.position.z;
  shieldOrbs.forEach(orb => {
    if (orb.userData.pickedUp) {
      orb.userData.respawnT -= dt;
      if (orb.userData.respawnT <= 0) {
        orb.userData.pickedUp = false;
        orb.visible = true;
      }
      return;
    }
    const dx = orb.position.x - px, dz = orb.position.z - pz;
    if (dx * dx + dz * dz < 2.5 * 2.5) {
      orb.userData.pickedUp = true;
      orb.userData.respawnT = 30;
      orb.visible = false;
      player.shield = Math.min(CFG.player.maxShield, player.shield + 25);
    }
  });

  // ADS — zoom only (no gun repositioning)
  player.ads = mouseR && !wpn.reloading;
  const tFov = player.ads ? CFG.weapon.adsFOV : CFG.weapon.normalFOV;
  camera.fov += (tFov - camera.fov) * dt * 12;
  camera.updateProjectionMatrix();

  // Gun position (same for hip and ADS — zoom only)
  const gunX = 0.28;
  const gunY = -0.24;
  const gunZ = -0.48;

  // Weapon bob
  const moving = mv.length() > 0.01 && player.grounded;
  if (moving) {
    bobT += dt * (player.sprinting ? 14 : 9);
    gunGroup.position.y = gunY + Math.sin(bobT) * 0.009;
    gunGroup.position.x = gunX + Math.cos(bobT * 0.5) * 0.005;
  } else {
    bobT = 0;
    gunGroup.position.y += (gunY - gunGroup.position.y) * dt * 5;
    gunGroup.position.x += (gunX - gunGroup.position.x) * dt * 5;
  }
  gunGroup.position.z += (gunZ - gunGroup.position.z) * dt * 10;

  // Recoil recovery
  if (wpn.recoilOff > 0) {
    const rec = CFG.weapon.recoilRecovery * dt;
    wpn.recoilOff = Math.max(0, wpn.recoilOff - rec);
    player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch + rec * 0.5));
    updateCameraRot();
  }

  // Muzzle flash decay
  if (wpn.flashT > 0) {
    wpn.flashT -= dt;
    if (wpn.flashT <= 0) { muzzleFlash.material.opacity = 0; muzzleLight.intensity = 0; }
  }

  // Reload
  if (wpn.reloading) {
    wpn.reloadT -= dt;
    if (wpn.reloadT <= 0) { wpn.ammo = CFG.weapon.maxAmmo; wpn.reloading = false; hideReload(); }
  }

  // Auto fire
  wpn.fireT -= dt;
  if (mouseL && wpn.mode === 'AUTO' && !wpn.reloading && wpn.fireT <= 0) shoot();
}

function updateCameraRot() {
  camera.rotation.order = 'YXZ';
  camera.rotation.x = player.pitch;
}

// ============================================
// SHOOTING
// ============================================
function shoot() {
  if (!cheat.infiniteAmmo && wpn.ammo <= 0) { startReload(); return; }
  if (wpn.reloading) return;

  const rate = wpn.mode === 'SEMI' ? CFG.weapon.semiRate : CFG.weapon.autoRate;
  wpn.fireT = rate;
  if (!cheat.infiniteAmmo) wpn.ammo--;

  sfxGunshot();
  if (window.__wz_onShoot) window.__wz_onShoot();

  // Flash
  muzzleFlash.material.opacity = 0.9; muzzleLight.intensity = 4; wpn.flashT = 0.05;

  // Recoil
  const ru = CFG.weapon.recoilUp * (player.ads ? 0.45 : 1);
  const rs = (Math.random() - 0.5) * CFG.weapon.recoilSide * 2;
  player.pitch -= ru; camera.rotation.y += rs; wpn.recoilOff += ru;
  updateCameraRot();

  // Gun kick anim
  gunGroup.position.z += 0.03;
  setTimeout(() => { if (gunGroup) gunGroup.position.z = -0.48; }, 60);

  // Play shoot animation
  if (gunAnims.shoot && gunMixer) {
    gunAnims.shoot.stop();
    gunAnims.shoot.reset().play();
  }

  // Raycast
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(0, 0), camera);
  rc.far = 200;

  // Check wall/building hit distance first
  const wallHits = rc.intersectObjects(collidableMeshes, false);
  const wallDist = wallHits.length > 0 ? wallHits[0].distance : Infinity;

  const targets = [];
  enemies.forEach(e => { if (!e.dead) { targets.push(e.headMesh, e.bodyMesh); } });

  const remoteBodies = window.__wz_remoteBodies || [];
  remoteBodies.forEach(rb => { targets.push(rb.headMesh, rb.bodyMesh); });

  const hits = rc.intersectObjects(targets, false);

  if (hits.length > 0 && hits[0].distance < wallDist) {
    const hit = hits[0];
    let handled = false;
    for (const e of enemies) {
      if (e.dead) continue;
      if (hit.object === e.headMesh) {
        damageEnemy(e, CFG.weapon.dmg * CFG.weapon.headshotMul, true);
        sfxHitmarker(); showHitmarker(); handled = true; break;
      } else if (hit.object === e.bodyMesh) {
        damageEnemy(e, CFG.weapon.dmg, false);
        sfxHitmarker(); showHitmarker(); handled = true; break;
      }
    }
    if (!handled) {
      for (const rb of remoteBodies) {
        const isHead = hit.object === rb.headMesh;
        const isBody = hit.object === rb.bodyMesh;
        if (isHead || isBody) {
          const dmg = isHead ? CFG.weapon.dmg * CFG.weapon.headshotMul : CFG.weapon.dmg;
          if (window.__wz_sendPvPDamage) window.__wz_sendPvPDamage(rb.playerId, dmg, isHead);
          sfxHitmarker(); showHitmarker();
          break;
        }
      }
    }
  }

  if (!cheat.infiniteAmmo && wpn.ammo <= 0) startReload();
}

function startReload() {
  if (wpn.reloading || wpn.ammo >= CFG.weapon.maxAmmo) return;
  wpn.reloading = true; wpn.reloadT = CFG.weapon.reloadTime;
  sfxReload(); showReload();

  if (gunAnims.reload && gunMixer) {
    if (gunAnims.idle) gunAnims.idle.stop();
    if (gunAnims.shoot) gunAnims.shoot.stop();
    gunAnims.reload.reset().play();
  }
}

function showHitmarker() {
  const lines = document.querySelectorAll('.ch-line');
  lines.forEach(l => { l.style.background = '#ff3333'; });
  setTimeout(() => lines.forEach(l => { l.style.background = 'rgba(255,255,255,0.85)'; }), 120);
}

function showReload() {
  if (!reloadDiv) {
    reloadDiv = document.createElement('div');
    reloadDiv.id = 'reload-indicator';
    reloadDiv.textContent = 'RELOADING';
    document.body.appendChild(reloadDiv);
  }
  reloadDiv.style.display = 'block';
}
function hideReload() {
  if (reloadDiv) reloadDiv.style.display = 'none';
  if (gunAnims.reload && gunMixer) {
    gunAnims.reload.stop();
    if (gunAnims.idle) gunAnims.idle.reset().play();
  }
}

// ============================================
// ENEMY AI
// ============================================
function getRandomEnemySpawnPosition() {
  const half = CFG.map.size / 2 - 20;
  for (let i = 0; i < 50; i++) {
    const x = (Math.random() * 2 - 1) * half;
    const z = (Math.random() * 2 - 1) * half;
    const pos = new THREE.Vector3(x, 0, z);
    if (!checkEnemyCollision(pos)) return pos;
  }
  return new THREE.Vector3(0, 0, 0);
}

function spawnEnemies() {
  for (let i = 0; i < CFG.enemy.count; i++) {
    const pos = getRandomEnemySpawnPosition();
    createEnemy(pos);
  }
}

function createEnemy(pos) {
  const g = new THREE.Group();

  // Body
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x8B1A1A, roughness: 0.7 });
  const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.45), bodyMat);
  bodyMesh.position.y = 1.05; bodyMesh.castShadow = true;
  g.add(bodyMesh);

  // Head
  const headMat = new THREE.MeshStandardMaterial({ color: 0xDEB887, roughness: 0.6 });
  const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.38, 0.35), headMat);
  headMesh.position.y = 1.8; headMesh.castShadow = true;
  g.add(headMesh);

  // Legs
  const legMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.22), legMat);
  legL.position.set(-0.15, 0.3, 0); legL.castShadow = true; g.add(legL);
  const legR = legL.clone(); legR.position.x = 0.15; g.add(legR);

  // Arms
  const armMat = new THREE.MeshStandardMaterial({ color: 0x8B1A1A, roughness: 0.7 });
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.2), armMat);
  armL.position.set(-0.44, 1.0, 0); armL.castShadow = true; g.add(armL);
  const armR = armL.clone(); armR.position.x = 0.44; g.add(armR);

  // Enemy gun
  const eGun = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 })
  );
  eGun.position.set(0.44, 0.9, -0.2); g.add(eGun);

  // Health bar
  const hbBg = new THREE.Mesh(
    new THREE.PlaneGeometry(0.8, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide })
  );
  hbBg.position.y = 2.15; g.add(hbBg);

  const hbFill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.78, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xff3333, side: THREE.DoubleSide })
  );
  hbFill.position.y = 2.15; g.add(hbFill);

  // Muzzle flash (light + visible mesh)
  const eFlash = new THREE.PointLight(0xff6600, 0, 4);
  eFlash.position.set(0.44, 0.9, -0.4); g.add(eFlash);
  const eFlashMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0 })
  );
  eFlashMesh.position.copy(eFlash.position); g.add(eFlashMesh);

  g.position.copy(pos);
  scene.add(g);

  const e = {
    group: g, bodyMesh, headMesh, hbFill, eFlash, eFlashMesh,
    legL, legR,
    hp: CFG.enemy.maxHP, dead: false,
    state: 'PATROL', patrolTarget: randPatrolPt(pos),
    fireT: Math.random() * CFG.enemy.fireRate,
    respawnT: 0, spawnPos: pos.clone(),
    walkT: Math.random() * 10,
  };
  enemies.push(e);
}

function randPatrolPt(origin) {
  const a = Math.random() * Math.PI * 2;
  const r = 8 + Math.random() * CFG.enemy.patrolRadius;
  const half = CFG.map.size / 2 - 5;
  return new THREE.Vector3(
    Math.max(-half, Math.min(half, origin.x + Math.cos(a) * r)),
    0,
    Math.max(-half, Math.min(half, origin.z + Math.sin(a) * r))
  );
}

function damageEnemy(e, dmg, headshot) {
  e.hp -= dmg;
  // Flash body red
  e.bodyMesh.material.emissive.set(0xff0000);
  e.bodyMesh.material.emissiveIntensity = 0.5;
  setTimeout(() => { if (e.bodyMesh) { e.bodyMesh.material.emissiveIntensity = 0; } }, 120);

  if (e.hp <= 0) {
    e.dead = true; e.state = 'DEAD'; e.respawnT = CFG.enemy.respawnTime;
    e.group.visible = false;
    player.kills++;
    updateHUD();
    healOnKill();
    addKillFeed(headshot ? 'HEADSHOT KILL' : 'ENEMY ELIMINATED');
  }
  // Update HP bar
  const pct = Math.max(0, e.hp / CFG.enemy.maxHP);
  e.hbFill.scale.x = pct;
  e.hbFill.position.x = -(1 - pct) * 0.39;
}

function updateEnemies(dt) {
  const playerPos = camera.position.clone();
  playerPos.y = 0;

  enemies.forEach(e => {
    if (e.dead) {
      e.respawnT -= dt;
      if (e.respawnT <= 0) respawnEnemy(e);
      return;
    }

    const ePos = e.group.position.clone(); ePos.y = 0;
    const dist = ePos.distanceTo(playerPos);

    // State transitions
    if (dist < CFG.enemy.attackRange && hasLOS(e)) {
      e.state = 'ATTACK';
    } else if (dist < CFG.enemy.detectRange && hasLOS(e)) {
      e.state = 'CHASE';
    } else if (e.state !== 'PATROL') {
      e.state = 'PATROL';
      e.patrolTarget = randPatrolPt(e.group.position);
    }

    // Leg animation
    e.walkT += dt * 8;

    // State actions
    const spd = CFG.enemy.speed * dt;
    switch (e.state) {
      case 'PATROL': {
        const dir = e.patrolTarget.clone().sub(e.group.position); dir.y = 0;
        if (dir.length() < 2) { e.patrolTarget = randPatrolPt(e.group.position); break; }
        dir.normalize();
        moveEnemy(e, dir, spd * 0.6);
        e.group.lookAt(e.patrolTarget.x, e.group.position.y, e.patrolTarget.z);
        animLegs(e, dt, 0.6);
        break;
      }
      case 'CHASE': {
        const dir = playerPos.clone().sub(e.group.position); dir.y = 0; dir.normalize();
        moveEnemy(e, dir, spd);
        e.group.lookAt(playerPos.x, e.group.position.y, playerPos.z);
        animLegs(e, dt, 1);
        break;
      }
      case 'ATTACK': {
        // Look at player's eye height so enemy aims at torso, not ground
        e.group.lookAt(camera.position.x, e.group.position.y, camera.position.z);
        e.fireT -= dt;
        if (e.fireT <= 0) {
          enemyShoot(e);
          e.fireT = CFG.enemy.fireRate + Math.random() * 0.5;
        }
        animLegs(e, dt, 0);
        break;
      }
    }

    // Face HP bar to camera
    e.hbFill.lookAt(camera.position);
  });
}

function checkEnemyCollision(pos) {
  // Enemy bounding box: 0.45 radius, 0..2 height
  const r = 0.45;
  const pb = new THREE.Box3(
    new THREE.Vector3(pos.x - r, 0, pos.z - r),
    new THREE.Vector3(pos.x + r, 2.0, pos.z + r)
  );
  for (let i = 0; i < collidables.length; i++) {
    if (pb.intersectsBox(collidables[i])) return true;
  }
  return false;
}

function moveEnemy(e, dir, spd) {
  const cur = e.group.position;

  // Try X axis
  const nx = cur.clone(); nx.x += dir.x * spd;
  if (!checkEnemyCollision(nx)) {
    cur.x = nx.x;
  } else {
    // Blocked on X — try a diagonal slide (60° turn)
    const altX = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);
    const nx2 = cur.clone(); nx2.x += altX.x * spd;
    if (!checkEnemyCollision(nx2)) cur.x = nx2.x;
  }

  // Try Z axis
  const nz = cur.clone(); nz.z += dir.z * spd;
  if (!checkEnemyCollision(nz)) {
    cur.z = nz.z;
  } else {
    const altZ = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);
    const nz2 = cur.clone(); nz2.z += altZ.z * spd;
    if (!checkEnemyCollision(nz2)) cur.z = nz2.z;
  }
}

function animLegs(e, dt, intensity) {
  if (intensity > 0) {
    e.legL.rotation.x = Math.sin(e.walkT) * 0.4 * intensity;
    e.legR.rotation.x = -Math.sin(e.walkT) * 0.4 * intensity;
  } else {
    e.legL.rotation.x *= 0.9;
    e.legR.rotation.x *= 0.9;
  }
}

function hasLOS(e) {
  const from = e.group.position.clone(); from.y = 1.5;
  const to = camera.position.clone();
  const dir = to.clone().sub(from).normalize();
  const rc = new THREE.Raycaster(from, dir, 0, CFG.enemy.detectRange);
  const hits = rc.intersectObjects(collidableMeshes, false);
  const distToPlayer = from.distanceTo(to);
  for (const h of hits) {
    if (h.distance < distToPlayer - 0.2) return false;
  }
  return true;
}

function enemyShoot(e) {
  sfxEnemyShot();
  e.eFlash.intensity = 3;
  if (e.eFlashMesh) e.eFlashMesh.material.opacity = 0.9;
  setTimeout(() => {
    e.eFlash.intensity = 0;
    if (e.eFlashMesh) e.eFlashMesh.material.opacity = 0;
  }, 60);

  // Accuracy
  const dist = camera.position.distanceTo(e.group.position);
  const accuracy = Math.max(0.3, 1 - dist / CFG.enemy.attackRange);
  if (Math.random() < accuracy * 0.6) {
    damagePlayer(CFG.enemy.dmg);
  }
}

function respawnEnemy(e) {
  e.dead = false; e.hp = CFG.enemy.maxHP;
  e.group.visible = true;
  e.state = 'PATROL';
  e.hbFill.scale.x = 1; e.hbFill.position.x = 0;

  const pos = getRandomEnemySpawnPosition();
  e.group.position.copy(pos);
  e.patrolTarget = randPatrolPt(e.group.position);
}

// ============================================
// PLAYER DAMAGE
// ============================================
function damagePlayer(dmg) {
  if (gameOver) return;
  if (player.shield > 0) {
    const shieldDmg = Math.min(player.shield, dmg);
    player.shield -= shieldDmg;
    dmg -= shieldDmg;
  }
  if (dmg > 0) player.hp -= dmg;
  dom.flash.classList.add('active');
  setTimeout(() => dom.flash.classList.remove('active'), 180);

  if (player.hp <= 0) {
    player.hp = 0;
    player.deaths++;
    gameOver = true;
    console.log('[GAME] Player died. gameOver =', gameOver, 'Deaths:', player.deaths);
    if (window.__wz_closeScoreboard) window.__wz_closeScoreboard();
    dom.respawn.classList.remove('hidden');
    dom.hud.classList.add('hidden');
    dom.crosshair.classList.add('hidden');
    document.exitPointerLock();
    if (window.__wz_onPlayerDied) window.__wz_onPlayerDied();
  }
}

function healOnKill() {
  player.hp = Math.min(CFG.player.maxHP, player.hp + 50);
  showHealOnKill();
}
window.__wz_healOnKill = healOnKill;
window.__wz_incPvPKill = function () {
  player.kills++;
  updateHUD();
  console.log('[GAME] PvP kill registered. Total kills:', player.kills);
};
window.__wz_getPlayerState = function () {
  return { kills: player.kills, deaths: player.deaths };
};

function respawnPlayer() {
  player.hp = CFG.player.maxHP;
  player.shield = CFG.player.maxShield;
  player.stamina = CFG.player.maxStamina;
  wpn.ammo = CFG.weapon.maxAmmo;
  wpn.reloading = false; hideReload();
  const spawn = getRandomSpawnPosition();
  camera.position.copy(spawn);
  player.yVel = 0; player.pitch = 0;
  camera.rotation.set(0, 0, 0);
  gameOver = false;
  dom.respawn.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  dom.crosshair.classList.remove('hidden');
  renderer.domElement.requestPointerLock();
  if (window.__wz_onPlayerRespawned) window.__wz_onPlayerRespawned();
  console.log('[GAME] Player respawned');
}
window.__wz_respawnPlayer = respawnPlayer;

// ============================================
// UI UPDATES
// ============================================
function updateHUD() {
  dom.healthBar.style.width = (player.hp / CFG.player.maxHP * 100) + '%';
  dom.healthTxt.textContent = Math.ceil(player.hp);
  if (dom.shieldBar) dom.shieldBar.style.width = (player.shield / CFG.player.maxShield * 100) + '%';
  if (dom.shieldTxt) dom.shieldTxt.textContent = Math.ceil(player.shield);
  dom.staminaBar.style.width = (player.stamina / CFG.player.maxStamina * 100) + '%';
  if (dom.kdDisplay) dom.kdDisplay.textContent = player.kills + ' / ' + player.deaths;
  dom.fireMode.textContent = wpn.mode;
  dom.ammo.textContent = wpn.ammo + ' / ∞';
  if (window.__wz_updateTopKillsBar) window.__wz_updateTopKillsBar();
}

window.__wz_updateTopKillsBar = function () {
  const bar = dom.topKillsBar;
  const list = dom.topKillsList;
  if (!bar || !list) return;
  if (!isPlaying || gameOver) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  const rows = window.__mpGetScoreboard ? window.__mpGetScoreboard() : [];
  const myId = window.__mpGetPlayerId ? window.__mpGetPlayerId() : null;
  const localState = window.__wz_getPlayerState ? window.__wz_getPlayerState() : { kills: 0, deaths: 0 };
  let allRows = rows.length > 0 ? rows : [{ playerId: myId, username: window.__playerName || 'You', kills: localState.kills }];
  allRows = allRows.map(r => ({
    ...r,
    kills: String(r.playerId) === String(myId) ? Math.max(r.kills || 0, localState.kills || 0) : (r.kills || 0),
  }));
  allRows.sort((a, b) => (b.kills || 0) - (a.kills || 0));
  const top5 = allRows.slice(0, 5);
  list.innerHTML = top5.map((r, i) => {
    const isMe = String(r.playerId) === String(myId);
    return `<div class="top-kills-row ${isMe ? 'me' : ''}"><span>${i + 1}. ${(r.username || 'Player').slice(0, 12)}</span><span class="top-kills-kills">${r.kills || 0}</span></div>`;
  }).join('');
};

function showHealOnKill() {
  const el = dom.healIndicator;
  if (!el) return;
  el.textContent = '+50 HP';
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = '';
  el.classList.remove('hidden');
  clearTimeout(showHealOnKill._t);
  showHealOnKill._t = setTimeout(() => el.classList.add('hidden'), 650);
}

function addKillFeed(msg) {
  const div = document.createElement('div');
  div.className = 'kill-entry';
  div.textContent = msg;
  dom.killFeed.appendChild(div);
  setTimeout(() => div.remove(), 3200);
}

// ============================================
// INPUT
// ============================================
function initInput() {
  document.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'KeyX' && isPlaying && !gameOver) {
      wpn.mode = wpn.mode === 'SEMI' ? 'AUTO' : 'SEMI';
      sfxModeSwitch();
    }
    if (e.code === 'KeyR' && isPlaying && !gameOver) startReload();

    // INSERT — toggle cheat menu
    if (e.code === 'Insert' && cheatsAllowed) {
      cheat.menuOpen = !cheat.menuOpen;
      const menu = document.getElementById('cheat-menu');
      menu.classList.toggle('hidden', !cheat.menuOpen);
      if (cheat.menuOpen) {
        document.exitPointerLock();
      } else if (isPlaying && !gameOver) {
        renderer.domElement.requestPointerLock();
      }
    }
  });

  // TAB — scoreboard (toggle on press)
  let scoreboardOpen = false;
  document.addEventListener('keydown', e2 => {
    if (e2.code === 'Tab' && isPlaying && !gameOver) {
      e2.preventDefault();
      scoreboardOpen = !scoreboardOpen;
      if (scoreboardOpen) {
        renderScoreboard();
        document.getElementById('scoreboard').classList.remove('hidden');
        document.exitPointerLock();
      } else {
        document.getElementById('scoreboard').classList.add('hidden');
        document.getElementById('sb-settings-panel').classList.add('hidden');
        if (!cheat.menuOpen) renderer.domElement.requestPointerLock();
      }
    }
  });

  function renderScoreboard() {
    const sb = document.getElementById('sb-body');
    const rows = window.__mpGetScoreboard ? window.__mpGetScoreboard() : [];
    const lobbyId = window.__mpGetLobbyId ? window.__mpGetLobbyId() : null;
    const lobbyName = window.__mpGetLobbyName ? window.__mpGetLobbyName() : '';
    const amIOwner = window.__mpIsOwner ? window.__mpIsOwner() : false;
    const myId = window.__mpGetPlayerId ? window.__mpGetPlayerId() : null;
    const settings = window.__mpGetLobbySettings ? window.__mpGetLobbySettings() : {};

    document.getElementById('sb-lobby-name').textContent = lobbyId ? lobbyName : 'SOLO';

    const localState = window.__wz_getPlayerState ? window.__wz_getPlayerState() : { kills: 0, deaths: 0 };
    let allRows = rows.length > 0 ? rows : [{ playerId: myId, username: window.__playerName || 'You', kills: localState.kills, deaths: localState.deaths, ping: 0 }];

    sb.innerHTML = allRows.map((r, i) => {
      const isMe = String(r.playerId) === String(myId);
      const kills = isMe ? Math.max(r.kills || 0, localState.kills || 0) : (r.kills || 0);
      const deaths = isMe ? Math.max(r.deaths || 0, localState.deaths || 0) : (r.deaths || 0);
      const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
      const actions = (lobbyId && amIOwner && !isMe)
        ? `<button class="sb-kick-btn" data-id="${r.playerId}">KICK</button><button class="sb-ban-btn" data-id="${r.playerId}">BAN</button>`
        : '';
      return `<tr class="${isMe ? 'sb-me' : ''}"><td>${i + 1}</td><td>${r.username}</td><td>${kills}</td><td>${deaths}</td><td>${kd}</td><td>${r.ping}ms</td><td>${actions}</td></tr>`;
    }).join('');

    sb.querySelectorAll('.sb-kick-btn').forEach(btn => {
      btn.addEventListener('click', () => { if (window.__mpKickPlayer) window.__mpKickPlayer(btn.dataset.id); });
    });
    sb.querySelectorAll('.sb-ban-btn').forEach(btn => {
      btn.addEventListener('click', () => { if (window.__mpBanPlayer) window.__mpBanPlayer(btn.dataset.id); });
    });

    const leaveBtn = document.getElementById('sb-leave-btn');
    leaveBtn.textContent = lobbyId ? 'LEAVE LOBBY' : 'RETURN TO MENU';
    leaveBtn.classList.remove('hidden');
    const settingsBtn = document.getElementById('sb-settings-btn');
    settingsBtn.classList.toggle('hidden', !amIOwner);

    if (amIOwner) {
      document.getElementById('sb-bots-toggle').checked = settings.botsEnabled !== false;
      document.getElementById('sb-cheats-toggle').checked = settings.cheatsAllowed !== false;
      // Populate transfer ownership dropdown
      const transferSel = document.getElementById('sb-transfer-select');
      if (transferSel) {
        const curVal = transferSel.value;
        transferSel.innerHTML = '<option value="">-- SELECT PLAYER --</option>';
        allRows.forEach(r => {
          if (String(r.playerId) !== String(myId)) {
            transferSel.innerHTML += `<option value="${r.playerId}">${r.username}</option>`;
          }
        });
        transferSel.value = curVal || '';
      }
    }
  }

  document.getElementById('sb-leave-btn').addEventListener('click', () => {
    const lobbyId = window.__mpGetLobbyId ? window.__mpGetLobbyId() : null;
    scoreboardOpen = false;
    document.getElementById('scoreboard').classList.add('hidden');
    document.getElementById('sb-settings-panel').classList.add('hidden');

    if (lobbyId) {
      if (window.__mpLeaveLobby) window.__mpLeaveLobby();
    }
    if (window.__returnToLobby) window.__returnToLobby();
  });
  document.getElementById('sb-settings-btn').addEventListener('click', () => {
    document.getElementById('sb-settings-panel').classList.toggle('hidden');
  });
  document.getElementById('sb-bots-toggle').addEventListener('change', function () {
    if (window.__mpToggleBots) window.__mpToggleBots(this.checked);
  });
  document.getElementById('sb-cheats-toggle').addEventListener('change', function () {
    if (window.__mpToggleCheats) window.__mpToggleCheats(this.checked);
  });
  document.getElementById('sb-transfer-select').addEventListener('change', function () {
    const targetId = this.value;
    if (targetId && window.__mpTransferOwner) {
      window.__mpTransferOwner(targetId);
      this.value = '';
    }
  });

  window.__wz_closeScoreboard = function () {
    scoreboardOpen = false;
    document.getElementById('scoreboard').classList.add('hidden');
    document.getElementById('sb-settings-panel').classList.add('hidden');
  };
  window.__wz_renderScoreboardIfOpen = function () {
    if (scoreboardOpen) {
      renderScoreboard();
      const amIOwner = window.__mpIsOwner ? window.__mpIsOwner() : false;
      document.getElementById('sb-settings-panel').classList.toggle('hidden', !amIOwner);
    }
  };

  document.addEventListener('keyup', e => { keys[e.code] = false; });

  document.addEventListener('mousedown', e => {
    if (!isPlaying || gameOver) return;
    const menuVisible = !dom.menu.classList.contains('hidden');
    if (!pointerLocked && !cheat.menuOpen && !scoreboardOpen && !menuVisible) {
      renderer.domElement.requestPointerLock();
      return;
    }
    if (pointerLocked && e.button === 0) { mouseL = true; if (!wpn.reloading && wpn.fireT <= 0) shoot(); }
    if (pointerLocked && e.button === 2) mouseR = true;
  });

  document.addEventListener('mouseup', e => {
    if (e.button === 0) mouseL = false;
    if (e.button === 2) mouseR = false;
  });

  document.addEventListener('contextmenu', e => e.preventDefault());

  document.addEventListener('mousemove', e => {
    if (!pointerLocked || !isPlaying || gameOver) return;
    const sens = CFG.player.sensitivity * (player.ads ? CFG.weapon.adsSensMul : 1);
    camera.rotation.order = 'YXZ';
    camera.rotation.y -= e.movementX * sens;
    player.pitch -= e.movementY * sens;
    player.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, player.pitch));
    camera.rotation.x = player.pitch;
  });

  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === renderer.domElement;
    if (isPlaying && !gameOver) {
      const menuVisible = !dom.menu.classList.contains('hidden');
      const hidePrompt = pointerLocked || cheat.menuOpen || scoreboardOpen || menuVisible;
      dom.lockPrompt.classList.toggle('hidden', hidePrompt);
    }
  });

  dom.lockPrompt.addEventListener('click', () => {
    if (isPlaying && !gameOver && !pointerLocked) {
      renderer.domElement.requestPointerLock();
    }
  });

  // ESC is handled natively by the browser to release pointer lock.
  // No extra handler needed — pointerlockchange handles the UI state.

  // Menu buttons
  document.getElementById('start-btn').addEventListener('click', startGame);
  const respawnBtn = document.getElementById('respawn-btn');
  respawnBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    respawnPlayer();
  });
  // Also handle mousedown on the respawn menu to prevent pointer lock stealing
  document.getElementById('respawn-menu').addEventListener('mousedown', (e) => {
    e.stopPropagation();
  });

  // ------- Cheat menu controls wiring -------
  document.getElementById('cheat-aimbot').addEventListener('change', function () {
    cheat.aimbot = this.checked;
  });
  document.getElementById('cheat-aim-smooth').addEventListener('input', function () {
    cheat.aimbotSmooth = +this.value;
    document.getElementById('cheat-aim-smooth-val').textContent = this.value;
  });
  document.getElementById('cheat-aim-target').addEventListener('change', function () {
    cheat.aimbotTarget = this.value;
  });
  document.getElementById('cheat-fov').addEventListener('change', function () {
    cheat.fovEnabled = this.checked;
    fovCanvas.classList.toggle('hidden', !cheat.fovEnabled);
    if (cheat.fovEnabled) drawFovCircle();
  });
  document.getElementById('cheat-fov-size').addEventListener('input', function () {
    cheat.fovRadius = +this.value;
    document.getElementById('cheat-fov-size-val').textContent = this.value;
    if (cheat.fovEnabled) drawFovCircle();
  });
  document.getElementById('cheat-inf-ammo').addEventListener('change', function () {
    cheat.infiniteAmmo = this.checked;
    if (this.checked) { wpn.ammo = CFG.weapon.maxAmmo; wpn.reloading = false; hideReload(); }
  });
  document.querySelectorAll('.swatch').forEach(sw => {
    sw.addEventListener('click', function () {
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      this.classList.add('active');
      cheat.fovColor = this.dataset.color;
      if (cheat.fovEnabled) drawFovCircle();
    });
  });

  // Init FOV canvas
  fovCanvas = document.getElementById('fov-circle');
  fovCtx = fovCanvas.getContext('2d');
  fovCanvas.width = innerWidth;
  fovCanvas.height = innerHeight;
  addEventListener('resize', () => {
    fovCanvas.width = innerWidth;
    fovCanvas.height = innerHeight;
    if (cheat.fovEnabled) drawFovCircle();
  });

  document.getElementById('cheat-esp').addEventListener('change', function () { cheat.esp = this.checked; });
  document.getElementById('cheat-esp-box').addEventListener('change', function () { cheat.espBox = this.checked; });
  document.getElementById('cheat-esp-name').addEventListener('change', function () { cheat.espName = this.checked; });
  document.getElementById('cheat-esp-health').addEventListener('change', function () { cheat.espHealth = this.checked; });

  espCanvas = document.getElementById('esp-canvas');
  if (espCanvas) {
    espCtx = espCanvas.getContext('2d');
    espCanvas.width = innerWidth;
    espCanvas.height = innerHeight;
    addEventListener('resize', () => {
      espCanvas.width = innerWidth;
      espCanvas.height = innerHeight;
    });
  }
}


// ============================================
// CHEATS
// ============================================
function drawFovCircle() {
  fovCtx.clearRect(0, 0, fovCanvas.width, fovCanvas.height);
  const cx = fovCanvas.width / 2;
  const cy = fovCanvas.height / 2;
  fovCtx.beginPath();
  fovCtx.arc(cx, cy, cheat.fovRadius, 0, Math.PI * 2);
  fovCtx.strokeStyle = cheat.fovColor;
  fovCtx.lineWidth = 1.5;
  fovCtx.setLineDash([6, 5]);
  fovCtx.globalAlpha = 0.85;
  fovCtx.stroke();
  fovCtx.setLineDash([]);
  fovCtx.globalAlpha = 1;
}

function drawESP() {
  if (!espCtx || !espCanvas) return;
  espCtx.clearRect(0, 0, espCanvas.width, espCanvas.height);
  if (!cheat.esp || !isPlaying || gameOver) return;

  const cx = innerWidth / 2;
  const cy = innerHeight / 2;
  const proj = new THREE.Vector3();

  function renderEntityESP(pos, hp, maxHp, name, isBot) {
    if (hp <= 0) return;
    proj.copy(pos).project(camera);
    if (proj.z > 1) return; // behind camera

    const x = (proj.x * 0.5 + 0.5) * innerWidth;
    const y = (1 - (proj.y * 0.5 + 0.5)) * innerHeight;

    // Approximate distance scale
    const dist = camera.position.distanceTo(pos);
    const scale = Math.max(0.1, 1 - dist / 150);
    const boxW = 40 * scale;
    const boxH = 90 * scale;

    const left = x - boxW / 2;
    const top = y - boxH / 2;

    if (cheat.espBox) {
      espCtx.strokeStyle = isBot ? '#ff3333' : '#33aaff';
      espCtx.lineWidth = 1.5;
      espCtx.strokeRect(left, top, boxW, boxH);
    }

    if (cheat.espName) {
      espCtx.fillStyle = '#ffffff';
      espCtx.font = `${Math.max(10, 14 * scale)}px Orbitron`;
      espCtx.textAlign = 'center';
      espCtx.fillText(name, x, top - 6);
    }

    if (cheat.espHealth) {
      const hpPct = Math.max(0, Math.min(1, hp / maxHp));
      espCtx.fillStyle = '#000000';
      espCtx.fillRect(left - 6, top, 4, boxH);
      espCtx.fillStyle = hpPct > 0.5 ? '#00ff00' : (hpPct > 0.2 ? '#ffff00' : '#ff0000');
      const hHeight = boxH * hpPct;
      espCtx.fillRect(left - 5, top + (boxH - hHeight), 2, hHeight);
    }
  }

  // Draw Bots
  enemies.forEach(e => {
    if (!e.group) return;
    const pos = e.group.position.clone();
    pos.y += 0.9; // center approx
    renderEntityESP(pos, e.hp, e.maxHp || 100, 'BOT', true);
  });

  // Draw Real Players
  const remotes = window.__wz_getRemoteBodies ? window.__wz_getRemoteBodies() : [];
  remotes.forEach(r => {
    if (!r.group) return;
    const pos = r.group.position.clone();
    pos.y += 0.9;
    renderEntityESP(pos, r.hp || 100, 100, r.username || 'PLAYER', false);
  });
}

function updateAimbot(dt) {
  if (!cheat.aimbot || !isPlaying || gameOver || cheat.menuOpen || !mouseR) return;

  const cx = innerWidth / 2;
  const cy = innerHeight / 2;
  const r2 = cheat.fovRadius * cheat.fovRadius;

  let bestDist = Infinity;
  let bestPos = null;

  const proj = new THREE.Vector3();

  function considerTarget(targetMesh, excludeMeshes) {
    const worldPos = new THREE.Vector3();
    targetMesh.getWorldPosition(worldPos);

    if (!hasLOSFromCamera(worldPos, excludeMeshes)) return;

    proj.copy(worldPos).project(camera);
    if (proj.z > 1) return;

    const dx = (proj.x * 0.5 + 0.5) * innerWidth - cx;
    const dy = (1 - (proj.y * 0.5 + 0.5)) * innerHeight - cy;
    const d2 = dx * dx + dy * dy;

    const withinFov = cheat.fovEnabled ? d2 < r2 : true;
    if (!withinFov) return;

    if (d2 < bestDist) {
      bestDist = d2;
      bestPos = worldPos.clone();
    }
  }

  enemies.forEach(e => {
    if (e.dead) return;
    let targetMesh;
    if (cheat.aimbotTarget === 'head') targetMesh = e.headMesh;
    else if (cheat.aimbotTarget === 'legs') targetMesh = e.legL;
    else targetMesh = e.bodyMesh;
    considerTarget(targetMesh, [e.headMesh, e.bodyMesh, e.legL, e.legR]);
  });

  const remoteBodies = window.__wz_getRemoteBodies ? window.__wz_getRemoteBodies() : [];
  remoteBodies.forEach(rb => {
    let targetMesh;
    if (cheat.aimbotTarget === 'head') targetMesh = rb.headMesh;
    else targetMesh = rb.bodyMesh;
    considerTarget(targetMesh, [rb.headMesh, rb.bodyMesh]);
  });

  if (!bestPos) return;

  const dir = bestPos.clone().sub(camera.position).normalize();
  const targetYaw = Math.atan2(-dir.x, -dir.z);
  const targetPitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));

  const speed = cheat.aimbotSmooth * dt * 5;
  const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));

  let yawDiff = targetYaw - camera.rotation.y;
  while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
  while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
  camera.rotation.y += yawDiff * clamp(speed, 0, 1);

  const pitchDiff = targetPitch - player.pitch;
  player.pitch += pitchDiff * clamp(speed, 0, 1);
  player.pitch = clamp(player.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  camera.rotation.x = player.pitch;
}

// ============================================
// GAME LOOP
// ============================================
function gameLoop() {
  requestAnimationFrame(gameLoop);
  const dt = Math.min(clock.getDelta(), 0.05);

  if (isPlaying && !gameOver) {
    const canControl = pointerLocked;
    if (canControl) {
      updatePlayer(dt);
      updateAimbot(dt);
    } else if (inLobby) {
      // In multiplayer: keep world running, just no player input
      // BUT allow pointer control if joining host enabled bots
      if (wpn.reloading) {
        wpn.reloadT -= dt;
        if (wpn.reloadT <= 0) { wpn.ammo = CFG.weapon.maxAmmo; wpn.reloading = false; hideReload(); }
      }
    }
    updateEnemies(dt);
    updateHUD();
    if (gunMixer) gunMixer.update(dt);
  }

  drawESP();
  renderer.render(scene, camera);
}

// ============================================
// START
// ============================================
function startGame() {
  if (!audioCtx) initAudio();
  createWeapon(); // Load weapon based on loadout selection
  player.hp = CFG.player.maxHP;
  player.shield = CFG.player.maxShield;
  player.stamina = CFG.player.maxStamina;
  player.kills = 0;
  player.deaths = 0;
  player.yVel = 0;
  player.wasInAir = false;
  player.bunnyHopT = 0;
  player.staminaDepleted = false;
  gameOver = false;
  wpn.ammo = CFG.weapon.maxAmmo;
  wpn.reloading = false;
  wpn.reloadT = 0;
  wpn.fireT = 0;
  hideReload();
  const spawn = getRandomSpawnPosition();
  camera.position.copy(spawn);
  camera.rotation.set(0, 0, 0);
  player.pitch = 0;
  dom.respawn.classList.add('hidden');
  dom.menu.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  dom.crosshair.classList.remove('hidden');
  isPlaying = true;
  const gameContainer = document.getElementById('game-container');
  if (gameContainer) gameContainer.focus();
  renderer.domElement.requestPointerLock();
  if (!document.pointerLockElement) {
    dom.lockPrompt.classList.remove('hidden');
  }
  setTimeout(() => {
    if (isPlaying && !gameOver && !document.pointerLockElement) {
      dom.lockPrompt.classList.remove('hidden');
      renderer.domElement.requestPointerLock();
    }
  }, 150);
}

window.__startGameForJoiner = startGame;

let botsEnabled = true;
let cheatsAllowed = true;
let inLobby = false;

function clearEnemies() {
  enemies.forEach(e => { if (e.group) scene.remove(e.group); });
  enemies.length = 0;
}

window.__wz_setBotsEnabled = function (enabled) {
  botsEnabled = enabled;
  if (enabled && enemies.length === 0 && isPlaying) spawnEnemies();
  else if (!enabled) clearEnemies();
};

window.__wz_setCheatsAllowed = function (allowed) {
  cheatsAllowed = allowed;
  if (!allowed) {
    cheat.menuOpen = false;
    cheat.aimbot = false;
    cheat.fovEnabled = false;
    cheat.infiniteAmmo = false;
    document.getElementById('cheat-menu').classList.add('hidden');
    const fov = document.getElementById('fov-circle');
    if (fov) fov.classList.add('hidden');
  }
};

window.__wz_setInLobby = function (v) { inLobby = v; };

window.__wz_stopGame = function () { isPlaying = false; };

window.__wz_damagePlayer = function (dmg) { damagePlayer(dmg); };

window.__wz_getPlayerState = function () {
  return { hp: player.hp, shield: player.shield, kills: player.kills, deaths: player.deaths };
};

window.__wz_addKillFeed = function (msg) { addKillFeed(msg); };

function init() {
  initScene();
  createMap();
  createWeapon();
  spawnEnemies();
  initInput();
  window.__wz_scene = scene;
  window.__wz_camera = camera;
  gameLoop();
}

init();

/* ================================================================
   MULTIPLAYER MODULE
   WebSocket on same host/port (/ws path) — works through Cloudflare
   ================================================================ */
{
  const COLORS = [0xff4444, 0x4488ff, 0xffcc00, 0xff88ff, 0x00ccff, 0xff8800];
  const MY_COLOR = COLORS[Math.floor(Math.random() * COLORS.length)];

  let PLAYER_ID = null;
  let socket = null;
  let currentLobbyId = null;
  let lastAttackerId = null;
  let lastAttackerName = null;
  let lastAttackerHeadshot = false;
  let currentLobbyName = 'SOLO';
  let isOwner = false;
  let lobbySettings = { botsEnabled: true, cheatsAllowed: true };
  let scoreboardData = [];
  const remotePlayers = {};

  function getScene() { return window.__wz_scene; }
  function getCamera() { return window.__wz_camera; }

  /* ---- WebSocket ---- */
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    socket = new WebSocket(`${proto}://${location.host}/ws`);

    socket.addEventListener('open', () => {
      console.log('[MP] Connected');
      send({ type: 'set_username', username: window.__playerName || 'Player' });
      send({ type: 'get_lobbies' });
    });

    socket.addEventListener('message', e => {
      try { handleMsg(JSON.parse(e.data)); } catch { }
    });

    socket.addEventListener('close', () => {
      console.log('[MP] Disconnected — retrying in 3s');
      setTimeout(connect, 3000);
    });
    socket.addEventListener('error', () => { });
  }

  function send(obj) {
    if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(obj));
  }

  /* ---- Message handler ---- */
  function handleMsg(msg) {
    switch (msg.type) {
      case 'welcome':
        PLAYER_ID = msg.player_id;
        break;

      case 'lobby_list':
        if (window.__renderLobbies) window.__renderLobbies(msg.lobbies);
        break;

      case 'lobby_created':
        currentLobbyId = msg.id;
        currentLobbyName = msg.name;
        isOwner = true;
        if (window.__onLobbyJoined) window.__onLobbyJoined(msg.id, msg.name);
        break;

      case 'init_players':
        Object.entries(msg.players).forEach(([pid, state]) => {
          if (pid !== PLAYER_ID) upsertRemote(pid, state);
        });
        break;

      case 'player_join':
        if (msg.player_id !== PLAYER_ID) upsertRemote(msg.player_id, msg.player_data);
        break;

      case 'update':
        if (msg.player_id !== PLAYER_ID) upsertRemote(msg.player_id, msg.state);
        break;

      case 'player_leave':
        removeRemote(msg.player_id);
        break;

      case 'lobby_settings':
        lobbySettings = msg.settings;
        isOwner = (msg.owner_id === PLAYER_ID);
        if (window.__wz_setBotsEnabled) window.__wz_setBotsEnabled(lobbySettings.botsEnabled);
        if (window.__wz_setCheatsAllowed) window.__wz_setCheatsAllowed(lobbySettings.cheatsAllowed);
        if (window.__wz_setInLobby) window.__wz_setInLobby(true);
        // Remove automatic start when receiving lobby settings to prevent pointer lock glitch
        break;

      case 'owner_changed':
        isOwner = (msg.owner_id === PLAYER_ID);
        if (window.__wz_renderScoreboardIfOpen) window.__wz_renderScoreboardIfOpen();
        break;

      case 'scoreboard':
        scoreboardData = msg.rows || [];
        if (msg.owner_id) isOwner = (msg.owner_id === PLAYER_ID);
        break;

      case 'player_damage':
        lastAttackerId = msg.attacker_id;
        lastAttackerName = msg.attacker_name;
        lastAttackerHeadshot = msg.headshot || false;
        if (window.__wz_damagePlayer) window.__wz_damagePlayer(msg.dmg);
        if (window.__wz_addKillFeed && msg.attacker_name)
          window.__wz_addKillFeed(msg.attacker_name + (msg.headshot ? ' [HEADSHOT]' : '') + ' hit you');
        break;

      case 'kill_feed':
        if (window.__wz_addKillFeed)
          window.__wz_addKillFeed(msg.killer + (msg.headshot ? ' [HS]' : '') + ' killed ' + msg.victim);
        if (String(msg.killer_id) === String(PLAYER_ID)) {
          if (window.__wz_healOnKill) window.__wz_healOnKill();
          if (window.__wz_incPvPKill) window.__wz_incPvPKill();
        }
        break;

      case 'kicked':
        currentLobbyId = null; isOwner = false;
        if (typeof window.__wz_joinerHasStarted !== 'undefined') window.__wz_joinerHasStarted = false;
        clearAllRemotes();
        if (window.__wz_setInLobby) window.__wz_setInLobby(false);
        showAlert('YOU WERE KICKED', 'Returning to lobby screen...');
        setTimeout(() => window.__returnToLobby && window.__returnToLobby(), 2000);
        break;

      case 'banned':
        currentLobbyId = null; isOwner = false;
        if (typeof window.__wz_joinerHasStarted !== 'undefined') window.__wz_joinerHasStarted = false;
        clearAllRemotes();
        if (window.__wz_setInLobby) window.__wz_setInLobby(false);
        showAlert('YOU ARE BANNED FROM THIS LOBBY', 'Returning to lobby screen...');
        setTimeout(() => window.__returnToLobby && window.__returnToLobby(), 2000);
        break;

      case 'left_lobby':
        currentLobbyId = null; isOwner = false;
        if (typeof window.__wz_joinerHasStarted !== 'undefined') window.__wz_joinerHasStarted = false;
        clearAllRemotes();
        if (window.__wz_setInLobby) window.__wz_setInLobby(false);
        break;

      case 'ping':
        send({ type: 'pong', t: msg.t });
        break;

      case 'player_shot':
        if (msg.player_id !== PLAYER_ID) remotePlayerShoot(msg.player_id);
        break;

      case 'player_died':
        if (msg.victim_id) hideRemotePlayer(String(msg.victim_id));
        break;

      case 'player_respawned':
        if (msg.player_id) showRemotePlayer(msg.player_id);
        break;
    }
  }

  function createDeathMarker(color) {
    const ring = new THREE.RingGeometry(0.3, 0.5, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: color || 0xcc0000,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
    });
    const mesh = new THREE.Mesh(ring, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.02;
    return mesh;
  }

  function hideRemotePlayer(pid) {
    let rp = remotePlayers[pid] || remotePlayers[String(pid)];
    if (!rp) {
      const pidStr = String(pid);
      for (const k in remotePlayers) {
        if (String(k) === pidStr) { rp = remotePlayers[k]; break; }
      }
    }
    if (!rp) { console.log('[MP] hideRemotePlayer: player not found', pid); return; }
    console.log('[MP] Hiding remote player body:', pid);
    rp.group.visible = false;
    rp.isDead = true;
    updateRemoteBodies();
    if (rp.deathMarker && getScene()) {
      getScene().remove(rp.deathMarker);
    }
    const deathPos = new THREE.Vector3();
    rp.group.getWorldPosition(deathPos);
    const color = (rp.bodyMesh?.material?.color?.getHex?.()) || 0xcc0000;
    const marker = createDeathMarker(color);
    marker.position.copy(deathPos);
    if (getScene()) getScene().add(marker);
    rp.deathMarker = marker;
  }

  function showRemotePlayer(pid) {
    let rp = remotePlayers[pid] || remotePlayers[String(pid)];
    if (!rp) {
      const pidStr = String(pid);
      for (const k in remotePlayers) {
        if (String(k) === pidStr) { rp = remotePlayers[k]; break; }
      }
    }
    if (!rp) return;
    rp.isDead = false;
    rp.group.visible = true;
    updateRemoteBodies();
    if (rp.deathMarker && getScene()) {
      getScene().remove(rp.deathMarker);
      rp.deathMarker = null;
    }
  }

  window.__wz_onShoot = function () {
    if (currentLobbyId) send({ type: 'player_shot' });
  };

  window.__wz_onPlayerDied = function () {
    if (currentLobbyId) {
      send({
        type: 'player_killed',
        victim_id: PLAYER_ID,
        victim_name: window.__playerName || 'Player',
        attacker_id: lastAttackerId || null,
        attacker_name: lastAttackerName || null,
        headshot: lastAttackerHeadshot || false,
      });
    }
  };

  window.__wz_onPlayerRespawned = function () {
    lastAttackerId = null;
    lastAttackerName = null;
    lastAttackerHeadshot = false;
    if (currentLobbyId) send({ type: 'player_respawned', player_id: PLAYER_ID });
  };

  function showAlert(title, sub) {
    let el = document.getElementById('mp-alert');
    if (!el) {
      el = document.createElement('div');
      el.id = 'mp-alert';
      el.innerHTML = '<div class="mp-alert-title"></div><div class="mp-alert-sub"></div>';
      document.body.appendChild(el);
    }
    el.querySelector('.mp-alert-title').textContent = title;
    el.querySelector('.mp-alert-sub').textContent = sub;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3500);
  }

  /* ---- Lobby helpers exposed to index.html ---- */
  window.__lobbyInit = function () {
    connect();
    setTimeout(() => send({ type: 'get_lobbies' }), 300);
  };

  window.__mpGetLobbies = function () { send({ type: 'get_lobbies' }); };

  window.__mpCreateLobby = function (name) {
    send({ type: 'create_lobby', name: name || 'LOBBY', color: MY_COLOR });
  };

  window.__mpJoinLobby = function (lobbyId) {
    currentLobbyId = lobbyId;
    send({
      type: 'join_lobby', lobby_id: lobbyId,
      player_data: { color: MY_COLOR, x: 0, y: 1.7, z: 0, rotY: 0, hp: 100 },
    });
    let name = currentLobbyName;
    document.querySelectorAll('.lobby-item').forEach(el => {
      if (el.querySelector('.lobby-join-btn')?.dataset.id === lobbyId)
        name = el.querySelector('.lobby-item-name')?.textContent || name;
    });
    currentLobbyName = name;
    if (window.__onLobbyJoined) window.__onLobbyJoined(lobbyId, name);
  };

  window.__mpLeaveLobby = function () { send({ type: 'leave_lobby' }); };

  window.__mpKickPlayer = function (targetId) { send({ type: 'kick_player', target_id: targetId }); };
  window.__mpBanPlayer = function (targetId) { send({ type: 'ban_player', target_id: targetId }); };
  window.__mpTransferOwner = function (targetId) { send({ type: 'transfer_owner', target_id: targetId }); };
  window.__mpToggleBots = function (enabled) { send({ type: 'toggle_bots', enabled }); };
  window.__mpToggleCheats = function (enabled) { send({ type: 'toggle_cheats', enabled }); };

  window.__mpGetScoreboard = function () { return scoreboardData; };
  window.__mpIsOwner = function () { return isOwner; };
  window.__mpGetLobbyId = function () { return currentLobbyId; };
  window.__mpGetLobbyName = function () { return currentLobbyName; };
  window.__mpGetPlayerId = function () { return PLAYER_ID; };
  window.__mpGetLobbySettings = function () { return lobbySettings; };

  window.__wz_sendPvPDamage = function (targetId, dmg, headshot) {
    send({ type: 'player_damage', target_id: targetId, dmg, headshot });
  };

  /* ---- Remote player mesh ---- */
  function buildPlayerMesh(color, username) {
    const g = new THREE.Group();
    const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });

    const bodyMesh = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.45), mat(color));
    bodyMesh.position.y = 1.05; bodyMesh.castShadow = true; g.add(bodyMesh);
    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.38, 0.35), mat(0xDEB887));
    headMesh.position.y = 1.8; headMesh.castShadow = true; g.add(headMesh);
    const legMat = mat(0x333333);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.22), legMat);
    legL.position.set(-0.15, 0.3, 0); g.add(legL);
    const legR = legL.clone(); legR.position.x = 0.15; g.add(legR);
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.2), mat(color));
    armL.position.set(-0.44, 1.0, 0); g.add(armL);
    const armR = armL.clone(); armR.position.x = 0.44; g.add(armR);

    const eGun = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.35),
      new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 })
    );
    eGun.position.set(0.44, 0.9, -0.2); g.add(eGun);

    const eFlash = new THREE.PointLight(0xff6600, 0, 4);
    eFlash.position.set(0.44, 0.9, -0.4); g.add(eFlash);
    const eFlashMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0 })
    );
    eFlashMesh.position.copy(eFlash.position); g.add(eFlashMesh);

    const c2d = document.createElement('canvas');
    c2d.width = 256; c2d.height = 64;
    const ctx = c2d.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = '#' + (color || 0x4488ff).toString(16).padStart(6, '0');
    ctx.font = 'bold 26px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(username || 'PLAYER', 128, 42);
    const tex = new THREE.CanvasTexture(c2d);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sprite.position.y = 2.4; sprite.scale.set(1.4, 0.35, 1);
    g.add(sprite);

    return { group: g, bodyMesh, headMesh, eFlash, eFlashMesh };
  }

  function updateRemoteBodies() {
    const bodies = [];
    for (const pid in remotePlayers) {
      const rp = remotePlayers[pid];
      if (rp.isDead) continue;
      bodies.push({ playerId: pid, group: rp.group, bodyMesh: rp.bodyMesh, headMesh: rp.headMesh, hp: rp.hp, username: rp.username });
    }
    window.__wz_remoteBodies = bodies;
  }
  window.__wz_getRemoteBodies = function () { return window.__wz_remoteBodies || []; };

  function upsertRemote(pid, state) {
    if (!getScene()) return;
    let rp = remotePlayers[pid];
    if (!rp) {
      const color = state.color || 0x4488ff;
      const mesh = buildPlayerMesh(color, state.username);
      getScene().add(mesh.group);
      remotePlayers[pid] = rp = { group: mesh.group, bodyMesh: mesh.bodyMesh, headMesh: mesh.headMesh, eFlash: mesh.eFlash, eFlashMesh: mesh.eFlashMesh, username: state.username || 'PLAYER', hp: 100 };
      updateRemoteBodies();
    }
    if (state.x !== undefined) {
      if (state.hp !== undefined) rp.hp = state.hp;
      if (state.username) rp.username = state.username;
      if (state.hp !== undefined && state.hp <= 0) {
        if (!rp.isDead) hideRemotePlayer(pid);
      } else {
        if (!rp.isDead) rp.group.visible = true; // DO NOT restore visibility blindly if they missed respawn sync
      }
      const feetY = (state.y !== undefined ? state.y : 1.7) - 1.7;
      rp.group.position.set(state.x, feetY, state.z);
      rp.group.rotation.y = state.rotY || 0;
    }
  }

  function remotePlayerShoot(pid) {
    const rp = remotePlayers[pid];
    if (!rp) return;
    if (rp.eFlash) rp.eFlash.intensity = 3;
    if (rp.eFlashMesh) rp.eFlashMesh.material.opacity = 0.9;
    setTimeout(() => {
      if (rp.eFlash) rp.eFlash.intensity = 0;
      if (rp.eFlashMesh) rp.eFlashMesh.material.opacity = 0;
    }, 60);
    if (window.__wz_sfxRemoteGunshot) window.__wz_sfxRemoteGunshot();
  }

  function removeRemote(pid) {
    const rp = remotePlayers[pid];
    if (!rp) return;
    if (getScene()) {
      getScene().remove(rp.group);
      if (rp.deathMarker) getScene().remove(rp.deathMarker);
    }
    delete remotePlayers[pid];
    updateRemoteBodies();
  }

  function clearAllRemotes() {
    for (const pid in remotePlayers) removeRemote(pid);
  }

  /* ---- Position send loop (15 Hz) ---- */
  let mpSendT = 0;
  function mpTick(dt) {
    if (!currentLobbyId || !getCamera()) return;
    mpSendT += dt;
    if (mpSendT < 1 / 15) return;
    mpSendT = 0;
    const cam = getCamera();
    const ps = window.__wz_getPlayerState ? window.__wz_getPlayerState() : {};
    send({
      type: 'update',
      state: {
        x: cam.position.x, y: cam.position.y, z: cam.position.z,
        rotY: cam.rotation.y, color: MY_COLOR,
        hp: ps.hp !== undefined ? ps.hp : 100,
        kills: ps.kills || 0,
        deaths: ps.deaths || 0,
      },
    });
  }

  let lastT = performance.now();
  function mpLoop(now) {
    const dt = Math.min((now - lastT) / 1000, 0.1);
    lastT = now;
    mpTick(dt);
    requestAnimationFrame(mpLoop);
  }
  requestAnimationFrame(mpLoop);
}

