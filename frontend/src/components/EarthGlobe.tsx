import { useEffect, useRef, useCallback, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { SatelliteSnapshot, DebrisTuple, ConjunctionEvent } from '../types/api';
import { statusColor } from '../types/api';
import { COASTLINE_POLYGONS } from '../data/coastlines';

// ---- constants ----

const EARTH_RADIUS = 6371;       // km -- canonical
const SCALE = 1 / EARTH_RADIUS;  // normalize so Earth radius ~ 1 unit
const SAT_ALT_OFFSET = 0.06;     // visual offset above globe surface
const DEBRIS_SIZE = 1.8;         // point size in px
const SAT_SIZE = 0.024;          // satellite mesh radius (prominent for full constellation visibility)
const AUTO_ROTATE_SPEED = 0.08;  // degrees per frame
const CAMERA_DISTANCE = 2.5;
const STAR_COUNT = 2500;         // background star count
const STAR_SPHERE_RADIUS = 50;   // far-distance sphere for stars
const MAX_DEBRIS_COUNT = 25000;  // pre-allocated capacity for debris positions

// Create satellite billboard text label texture
function createSatelliteLabelTexture(satId: string, isSelected: boolean): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 36;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 36);

  ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.95)' : 'rgba(10, 16, 26, 0.88)';
  if (ctx.roundRect) {
    ctx.roundRect(4, 4, 120, 28, 6);
  } else {
    ctx.rect(4, 4, 120, 28);
  }
  ctx.fill();

  ctx.strokeStyle = isSelected ? '#ffffff' : 'rgba(56, 189, 248, 0.6)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Status dot
  ctx.fillStyle = isSelected ? '#0f172a' : '#22c55e';
  ctx.beginPath();
  ctx.arc(16, 18, 4, 0, Math.PI * 2);
  ctx.fill();

  // Text
  ctx.font = 'bold 12px monospace';
  ctx.fillStyle = isSelected ? '#050a14' : '#e2e8f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(satId, 68, 18);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// GLB normalization uses Box3.getBoundingSphere which overestimates by sqrt(3).
// After scaling, the actual Earth mesh radius is 1/sqrt(3), NOT 1.0.
const EARTH_VISUAL_RADIUS = 1 / Math.sqrt(3);  // ≈ 0.577

// Convert lat/lon/alt to 3D position (Y-up).
// Reusable scratch vector eliminates per-call heap allocations in hot loops.
const _scratch = new THREE.Vector3();

function geoTo3D(lat: number, lon: number, altKm: number): THREE.Vector3 {
  const r = (EARTH_RADIUS + altKm) * SCALE;
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

/** Write geo coords directly into _scratch — avoids allocation in tight loops. */
function geoTo3DInto(lat: number, lon: number, altKm: number): THREE.Vector3 {
  const r = (EARTH_RADIUS + altKm) * SCALE;
  const phi = THREE.MathUtils.degToRad(90 - lat);
  const theta = THREE.MathUtils.degToRad(lon + 180);
  _scratch.set(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
  return _scratch;
}

// Create a circular star texture (32x32) to replace square default
function createStarTexture(): THREE.CanvasTexture {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const center = size / 2;
  const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Create nebula sprite texture
function createNebulaTexture(
  r: number, g: number, b: number,
): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const center = size / 2;
  const grad = ctx.createRadialGradient(center, center, 0, center, center, center);
  grad.addColorStop(0, `rgba(${r},${g},${b},0.12)`);
  grad.addColorStop(0.3, `rgba(${r},${g},${b},0.06)`);
  grad.addColorStop(0.7, `rgba(${r},${g},${b},0.02)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0.02)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// Procedural fallback Earth texture using COASTLINE_POLYGONS (renders immediately offline)
function createProceduralEarthTexture(): THREE.CanvasTexture {
  const width = 2048;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Deep oceanic blue gradient (polar regions slightly darker)
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, height);
  oceanGrad.addColorStop(0, '#040d1a');
  oceanGrad.addColorStop(0.2, '#081d38');
  oceanGrad.addColorStop(0.5, '#0b2647');
  oceanGrad.addColorStop(0.8, '#081d38');
  oceanGrad.addColorStop(1, '#040d1a');
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle latitude & longitude graticule
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.05)';
  ctx.lineWidth = 1;
  for (let lat = -80; lat <= 80; lat += 20) {
    const y = ((90 - lat) / 180) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let lon = -180; lon <= 180; lon += 30) {
    const x = ((lon + 180) / 360) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Draw continent landmasses from COASTLINE_POLYGONS
  ctx.fillStyle = '#1c3d2e'; // Realistic rich terrain green
  ctx.strokeStyle = '#2d6a4f';
  ctx.lineWidth = 1.5;

  for (const ring of COASTLINE_POLYGONS) {
    if (ring.length < 3) continue;
    ctx.beginPath();
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i];
      const x = ((lon + 180) / 360) * width;
      const y = ((90 - lat) / 180) * height;
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Polar ice caps (Antarctica + Greenland / Arctic)
  ctx.fillStyle = 'rgba(235, 248, 255, 0.88)';
  ctx.beginPath();
  ctx.rect(0, height * 0.91, width, height * 0.09);
  ctx.fill();
  ctx.beginPath();
  ctx.rect(0, 0, width, height * 0.04);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Fresnel atmosphere shader (BackSide on a sphere slightly larger than Earth).
// Transparent in center facing the camera, glowing blue limb halo at glancing edges.
const atmosphereVertexShader = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const atmosphereFragmentShader = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    // BackSide ray skimming tangent to sphere has dot(vNormal, vViewDir) ~ 0.0
    // Center ray directly through sphere center has dot(vNormal, vViewDir) ~ -1.0
    float d = abs(dot(vNormal, vViewDir));
    float rim = clamp(1.0 - d, 0.0, 1.0);
    // Smooth atmospheric limb gradient: 0 in center, glowing only at horizon
    float glow = pow(rim, 3.2) * 1.5;
    vec3 col = vec3(0.28, 0.62, 1.0);
    gl_FragColor = vec4(col * glow, glow * 0.85);
  }
`;

// ---- props ----

interface EarthGlobeProps {
  satellites: SatelliteSnapshot[];
  debris: DebrisTuple[];
  selectedSatId: string | null;
  onSelectSat: (id: string | null) => void;
  threatEvent?: ConjunctionEvent | null;
  nowEpochS?: number;
  trailPoints?: THREE.Vector3[];     // optional trajectory trail
  predictedPoints?: THREE.Vector3[]; // optional predicted path
  style?: CSSProperties;
}

// ---- component ----

export default function EarthGlobe({
  satellites,
  debris,
  selectedSatId,
  onSelectSat,
  threatEvent,
  nowEpochS,
  trailPoints,
  predictedPoints,
  style,
}: EarthGlobeProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    earthGroup: THREE.Group;
    debrisPoints: THREE.Points | null;
    satMeshes: Map<string, THREE.Mesh>;
    satLabels: Map<string, THREE.Sprite>;
    satHalos: Map<string, THREE.Mesh>;
    selectedRing: THREE.Mesh | null;
    trailLine: THREE.Line | null;
    predictedLine: THREE.Line | null;
    raycaster: THREE.Raycaster;
    mouse: THREE.Vector2;
    animId: number;
    autoRotate: boolean;
    threatReticle: THREE.Group | null;
    collisionLine: THREE.Line | null;
    safetyBubble: THREE.Mesh | null;
    threatTcaMarker: THREE.Mesh | null;
    targetCamPos: THREE.Vector3 | null;
    targetLookAt: THREE.Vector3 | null;
    isFocusingEncounter: boolean;
  } | null>(null);

  // ---- init scene ----
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // renderer -- opaque cosmic black, NOT transparent
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x050a14, 1); // opaque cosmic black
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // scene
    const scene = new THREE.Scene();

    // camera -- extended far plane for distant stars/nebulae
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 200);
    camera.position.set(0, 0.6, CAMERA_DISTANCE);

    // controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.3;
    controls.maxDistance = 8;
    controls.enablePan = false;

    // lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(5, 3, 5);
    scene.add(sun);

    // subtle blue rim light from opposite side
    const rim = new THREE.DirectionalLight(0x3a9fe8, 0.3);
    rim.position.set(-3, -1, -5);
    scene.add(rim);

    // ---- nebula background (behind stars) ----
    {
      // Nebula 1: deep purple/violet -- upper right
      const nebTex1 = createNebulaTexture(80, 40, 120);
      const nebMat1 = new THREE.SpriteMaterial({
        map: nebTex1,
        transparent: true,
        opacity: 0.06,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const neb1 = new THREE.Sprite(nebMat1);
      neb1.scale.set(30, 30, 1);
      neb1.position.set(15, 10, -42);
      scene.add(neb1);

      // Nebula 2: deep blue -- lower left
      const nebTex2 = createNebulaTexture(30, 60, 140);
      const nebMat2 = new THREE.SpriteMaterial({
        map: nebTex2,
        transparent: true,
        opacity: 0.05,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const neb2 = new THREE.Sprite(nebMat2);
      neb2.scale.set(25, 25, 1);
      neb2.position.set(-12, -8, -40);
      scene.add(neb2);

      // Nebula 3: subtle teal -- center-left
      const nebTex3 = createNebulaTexture(20, 80, 100);
      const nebMat3 = new THREE.SpriteMaterial({
        map: nebTex3,
        transparent: true,
        opacity: 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const neb3 = new THREE.Sprite(nebMat3);
      neb3.scale.set(20, 20, 1);
      neb3.position.set(-20, 5, -45);
      scene.add(neb3);
    }

    // ---- starfield (fixed relative to camera, does NOT rotate with Earth) ----
    {
      const starTexture = createStarTexture();

      const starPositions = new Float32Array(STAR_COUNT * 3);
      const starSizes = new Float32Array(STAR_COUNT);
      const starColors = new Float32Array(STAR_COUNT * 3);

      for (let i = 0; i < STAR_COUNT; i++) {
        // Uniform distribution on sphere surface
        const u = Math.random();
        const v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        const r = STAR_SPHERE_RADIUS * (0.9 + 0.1 * Math.random()); // slight depth variation

        starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        starPositions[i * 3 + 2] = r * Math.cos(phi);

        // Reduced sizes: 0.3-0.8 range (was 0.8-3.5)
        const brightness = Math.random();
        const size = brightness < 0.85 ? 0.3 + Math.random() * 0.2
                   : brightness < 0.97 ? 0.5 + Math.random() * 0.2
                   : 0.6 + Math.random() * 0.2;
        starSizes[i] = size;

        // Subtle color variation: mostly white, slight blue or warm tint
        const tint = Math.random();
        if (tint < 0.7) {
          // white
          const b = 0.6 + Math.random() * 0.4;
          starColors[i * 3] = b;
          starColors[i * 3 + 1] = b;
          starColors[i * 3 + 2] = b;
        } else if (tint < 0.85) {
          // blue-white
          const b = 0.5 + Math.random() * 0.3;
          starColors[i * 3] = b * 0.8;
          starColors[i * 3 + 1] = b * 0.9;
          starColors[i * 3 + 2] = b;
        } else {
          // warm
          const b = 0.5 + Math.random() * 0.4;
          starColors[i * 3] = b;
          starColors[i * 3 + 1] = b * 0.85;
          starColors[i * 3 + 2] = b * 0.6;
        }
      }

      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
      starGeo.setAttribute('size', new THREE.BufferAttribute(starSizes, 1));
      starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

      const starMat = new THREE.PointsMaterial({
        size: 0.6,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        map: starTexture,
        alphaTest: 0.01,
      });

      const stars = new THREE.Points(starGeo, starMat);
      scene.add(stars); // added to scene, NOT earthGroup -- stays fixed
    }

    // earth group (for rotation)
    const earthGroup = new THREE.Group();
    scene.add(earthGroup);

    // Immediate solid fallback Earth mesh (renders instantly offline,
    // guarantees continents & oceans are visible, and blocks stars from shining through)
    const fallbackTex = createProceduralEarthTexture();
    const fallbackGeo = new THREE.SphereGeometry(EARTH_VISUAL_RADIUS, 64, 64);
    const fallbackMat = new THREE.MeshStandardMaterial({
      map: fallbackTex,
      roughness: 0.85,
      metalness: 0.1,
    });
    let fallbackEarthMesh: THREE.Mesh | null = new THREE.Mesh(fallbackGeo, fallbackMat);
    earthGroup.add(fallbackEarthMesh);

    // load high-res EARTH.glb
    const loader = new GLTFLoader();
    const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
    const earthModelPath = `${base}/earth_model/EARTH.glb`;
    loader.load(
      earthModelPath,
      (gltf) => {
        const model = gltf.scene;
        // normalize scale -- find bounding sphere and scale to radius ~1
        const box = new THREE.Box3().setFromObject(model);
        const sphere = new THREE.Sphere();
        box.getBoundingSphere(sphere);
        const scaleFactor = 1 / sphere.radius;
        model.scale.setScalar(scaleFactor);
        model.position.sub(sphere.center.multiplyScalar(scaleFactor));

        // Use Earth's photorealistic diffuse and normal textures with natural PBR shading
        model.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) {
            const mesh = child as THREE.Mesh;
            const oldMat = mesh.material as THREE.MeshStandardMaterial;
            if (oldMat && oldMat.isMeshStandardMaterial && oldMat.map) {
              const newMat = new THREE.MeshStandardMaterial({
                map: oldMat.map,
                normalMap: oldMat.normalMap,
                metalnessMap: oldMat.metalnessMap,
                roughnessMap: oldMat.roughnessMap,
                aoMap: oldMat.aoMap,
                metalness: 0.1,
                roughness: 0.85,
              });
              mesh.material = newMat;
              oldMat.dispose();
            }
          }
        });

        // Cleanly retire fallback sphere now that high-res model is ready
        if (fallbackEarthMesh) {
          earthGroup.remove(fallbackEarthMesh);
          fallbackEarthMesh.geometry.dispose();
          if (fallbackMat.map) fallbackMat.map.dispose();
          fallbackMat.dispose();
          fallbackEarthMesh = null;
        }

        earthGroup.add(model);
      },
      undefined,
      (error) => {
        console.warn('[EarthGlobe] Could not load high-res EARTH.glb, keeping procedural fallback globe:', error);
      },
    );

    // ---- Fresnel atmospheric glow ----
    {
      // 5% larger than actual Earth visual radius -- tight rim glow
      const atmosGeo = new THREE.SphereGeometry(EARTH_VISUAL_RADIUS * 1.05, 64, 64);
      const atmosMat = new THREE.ShaderMaterial({
        vertexShader: atmosphereVertexShader,
        fragmentShader: atmosphereFragmentShader,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
      });
      const atmosMesh = new THREE.Mesh(atmosGeo, atmosMat);
      earthGroup.add(atmosMesh);
    }

    // raycaster for satellite picking
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.05 };
    const mouse = new THREE.Vector2();

    const state = {
      scene,
      camera,
      renderer,
      controls,
      earthGroup,
      debrisPoints: null as THREE.Points | null,
      satMeshes: new Map<string, THREE.Mesh>(),
      satLabels: new Map<string, THREE.Sprite>(),
      satHalos: new Map<string, THREE.Mesh>(),
      selectedRing: null as THREE.Mesh | null,
      trailLine: null as THREE.Line | null,
      predictedLine: null as THREE.Line | null,
      raycaster,
      mouse,
      animId: 0,
      autoRotate: true,
      threatReticle: null as THREE.Group | null,
      collisionLine: null as THREE.Line | null,
      safetyBubble: null as THREE.Mesh | null,
      threatTcaMarker: null as THREE.Mesh | null,
      targetCamPos: null as THREE.Vector3 | null,
      targetLookAt: null as THREE.Vector3 | null,
      isFocusingEncounter: false,
    };
    sceneRef.current = state;

    // Constellation orbital plane rings (Walker Delta 53 deg LEO highway)
    const orbitR = (EARTH_RADIUS + 550) * SCALE * (1 + SAT_ALT_OFFSET);
    const iRad = (53.05 * Math.PI) / 180;
    const ringGroup = new THREE.Group();
    for (const raanDeg of [0, 180]) {
      const points: THREE.Vector3[] = [];
      const raanRad = (raanDeg * Math.PI) / 180;
      for (let step = 0; step <= 128; step++) {
        const u = (step / 128) * 2 * Math.PI;
        const x = orbitR * (Math.cos(raanRad) * Math.cos(u) - Math.sin(raanRad) * Math.sin(u) * Math.cos(iRad));
        const y = orbitR * Math.sin(u) * Math.sin(iRad);
        const z = orbitR * (Math.sin(raanRad) * Math.cos(u) + Math.cos(raanRad) * Math.sin(u) * Math.cos(iRad));
        points.push(new THREE.Vector3(x, y, z));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.25,
      });
      ringGroup.add(new THREE.Line(geo, lineMat));
    }
    earthGroup.add(ringGroup);

    // animation loop
    function animate() {
      state.animId = requestAnimationFrame(animate);
      if (state.autoRotate) {
        state.earthGroup.rotation.y += THREE.MathUtils.degToRad(AUTO_ROTATE_SPEED);
      }
      if (state.isFocusingEncounter && state.targetCamPos && state.targetLookAt) {
        state.camera.position.lerp(state.targetCamPos, 0.05);
        state.controls.target.lerp(state.targetLookAt, 0.05);
        if (state.camera.position.distanceTo(state.targetCamPos) < 0.005) {
          state.isFocusingEncounter = false;
        }
      }
      if (state.threatReticle && state.threatReticle.visible) {
        state.threatReticle.rotation.z += 0.04;
        const pulse = 1.0 + 0.15 * Math.sin(Date.now() * 0.006);
        state.threatReticle.scale.setScalar(pulse);
      }
      if (state.safetyBubble && state.safetyBubble.visible) {
        const bMat = state.safetyBubble.material as THREE.MeshBasicMaterial;
        if (bMat) {
          bMat.opacity = 0.2 + 0.15 * Math.abs(Math.sin(Date.now() * 0.004));
        }
      }
      state.controls.update();
      state.renderer.render(state.scene, state.camera);
    }
    animate();

    // resize handler -- prefer container size so the globe can live in a panel
    const onResize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      state.camera.aspect = w / h;
      state.camera.updateProjectionMatrix();
      state.renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);

    // click handler for satellite picking
    const onClick = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      state.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      state.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      state.raycaster.setFromCamera(state.mouse, state.camera);

      const satMeshArray = Array.from(state.satMeshes.values());
      const intersects = state.raycaster.intersectObjects(satMeshArray, false);
      if (intersects.length > 0) {
        const mesh = intersects[0].object as THREE.Mesh;
        const satId = mesh.userData.satId as string;
        onSelectSat(satId);
      } else {
        onSelectSat(null);
      }
    };
    renderer.domElement.addEventListener('click', onClick);

    // stop auto-rotate when user interacts
    const onInteract = () => { state.autoRotate = false; };
    renderer.domElement.addEventListener('pointerdown', onInteract);

    return () => {
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('click', onClick);
      renderer.domElement.removeEventListener('pointerdown', onInteract);
      cancelAnimationFrame(state.animId);

      // Dispose all GPU resources (geometries, materials, textures)
      state.scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh || (obj as THREE.Points).isPoints || (obj as THREE.Line).isLine) {
          const o = obj as THREE.Mesh | THREE.Points | THREE.Line;
          o.geometry?.dispose();
          const mat = o.material;
          if (Array.isArray(mat)) {
            mat.forEach((m) => {
              if ((m as THREE.MeshStandardMaterial).map) (m as THREE.MeshStandardMaterial).map!.dispose();
              m.dispose();
            });
          } else if (mat) {
            if ((mat as THREE.MeshStandardMaterial).map) (mat as THREE.MeshStandardMaterial).map!.dispose();
            (mat as THREE.Material).dispose();
          }
        }
        if ((obj as THREE.Sprite).isSprite) {
          const sprite = obj as THREE.Sprite;
          sprite.material.map?.dispose();
          sprite.material.dispose();
        }
      });

      renderer.dispose();
      controls.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  // onSelectSat is stable via parent useCallback
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- update debris cloud (reuse geometry + material) ----
  const updateDebris = useCallback((debrisData: DebrisTuple[]) => {
    const s = sceneRef.current;
    if (!s) return;

    if (!s.debrisPoints) {
      // First call -- allocate geometry + material once
      const positions = new Float32Array(MAX_DEBRIS_COUNT * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setDrawRange(0, 0);

      const mat = new THREE.PointsMaterial({
        color: 0xef4444,
        size: DEBRIS_SIZE,
        sizeAttenuation: false,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });

      s.debrisPoints = new THREE.Points(geo, mat);
      s.earthGroup.add(s.debrisPoints);
    }

    const posAttr = s.debrisPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    const count = Math.min(debrisData.length, MAX_DEBRIS_COUNT);

    for (let i = 0; i < count; i++) {
      const [, lat, lon, alt] = debrisData[i];
      geoTo3DInto(lat, lon, alt);
      arr[i * 3] = _scratch.x;
      arr[i * 3 + 1] = _scratch.y;
      arr[i * 3 + 2] = _scratch.z;
    }

    posAttr.needsUpdate = true;
    s.debrisPoints.geometry.setDrawRange(0, count);
    s.debrisPoints.visible = count > 0;
  }, []);

  // ---- update satellites ----
  const updateSatellites = useCallback((sats: SatelliteSnapshot[], selected: string | null) => {
    const s = sceneRef.current;
    if (!s) return;

    const currentIds = new Set(sats.map(sat => sat.id));

    // remove satellites no longer present
    for (const [id, mesh] of s.satMeshes.entries()) {
      if (!currentIds.has(id)) {
        s.earthGroup.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        s.satMeshes.delete(id);

        const lbl = s.satLabels.get(id);
        if (lbl) {
          s.earthGroup.remove(lbl);
          lbl.material.dispose();
          s.satLabels.delete(id);
        }
        const halo = s.satHalos.get(id);
        if (halo) {
          s.earthGroup.remove(halo);
          halo.geometry.dispose();
          (halo.material as THREE.Material).dispose();
          s.satHalos.delete(id);
        }
      }
    }

    // add/update satellites
    for (const sat of sats) {
      const pos = geoTo3D(sat.lat, sat.lon, 550); // approximate LEO alt
      pos.multiplyScalar(1 + SAT_ALT_OFFSET);
      const isSelected = sat.id === selected;

      let mesh = s.satMeshes.get(sat.id);
      if (!mesh) {
        const geo = new THREE.OctahedronGeometry(SAT_SIZE, 0);
        const mat = new THREE.MeshStandardMaterial({
          color: statusColor(sat.status),
          emissive: statusColor(sat.status),
          emissiveIntensity: 0.6,
          metalness: 0.6,
          roughness: 0.3,
        });
        mesh = new THREE.Mesh(geo, mat);
        mesh.userData.satId = sat.id;
        s.earthGroup.add(mesh);
        s.satMeshes.set(sat.id, mesh);
      }

      mesh.position.copy(pos);

      // update color
      const col = statusColor(sat.status);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(col);
      mat.emissive.setHex(col);

      // highlight selected
      const scale = isSelected ? 2.2 : 1.2;
      mesh.scale.setScalar(scale);
      mat.emissiveIntensity = isSelected ? 1.0 : 0.6;

      // Halo ring around each satellite
      let halo = s.satHalos.get(sat.id);
      if (!halo) {
        const haloGeo = new THREE.RingGeometry(SAT_SIZE * 1.4, SAT_SIZE * 2.0, 24);
        const haloMat = new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.65,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        halo = new THREE.Mesh(haloGeo, haloMat);
        s.earthGroup.add(halo);
        s.satHalos.set(sat.id, halo);
      }
      halo.position.copy(pos);
      halo.lookAt(0, 0, 0);
      (halo.material as THREE.MeshBasicMaterial).color.setHex(isSelected ? 0x38bdf8 : col);
      halo.scale.setScalar(isSelected ? 1.6 : 1.0);

      // Floating billboard label above satellite
      let label = s.satLabels.get(sat.id);
      if (!label) {
        const tex = createSatelliteLabelTexture(sat.id, isSelected);
        const spriteMat = new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
        });
        label = new THREE.Sprite(spriteMat);
        label.scale.set(0.18, 0.05, 1);
        s.earthGroup.add(label);
        s.satLabels.set(sat.id, label);
      } else {
        const spriteMat = label.material as THREE.SpriteMaterial;
        spriteMat.map = createSatelliteLabelTexture(sat.id, isSelected);
        spriteMat.needsUpdate = true;
      }
      const labelPos = pos.clone().multiplyScalar(1.055);
      label.position.copy(labelPos);
      label.scale.set(isSelected ? 0.22 : 0.16, isSelected ? 0.06 : 0.045, 1);
    }

    // selection ring -- reuse if already exists, toggle visibility
    if (!s.selectedRing) {
      const ringGeo = new THREE.RingGeometry(SAT_SIZE * 2.5, SAT_SIZE * 3.2, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x3a9fe8,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      s.selectedRing = new THREE.Mesh(ringGeo, ringMat);
      s.selectedRing.visible = false;
      s.earthGroup.add(s.selectedRing);
    }

    if (selected) {
      const selMesh = s.satMeshes.get(selected);
      if (selMesh) {
        s.selectedRing.position.copy(selMesh.position);
        s.selectedRing.lookAt(0, 0, 0);
        s.selectedRing.visible = true;
      } else {
        s.selectedRing.visible = false;
      }
    } else {
      s.selectedRing.visible = false;
    }
  }, []);

  // ---- update trajectory lines ----
  const updateTrajectory = useCallback((
    trail?: THREE.Vector3[],
    predicted?: THREE.Vector3[],
  ) => {
    const s = sceneRef.current;
    if (!s) return;

    // Lazily create the two line objects once; subsequent updates
    // just replace the geometry data in-place (avoids dispose/recreate).
    if (!s.trailLine) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineBasicMaterial({
        color: 0x3a9fe8,
        transparent: true,
        opacity: 0.6,
        linewidth: 1,
      });
      s.trailLine = new THREE.Line(geo, mat);
      s.trailLine.visible = false;
      s.earthGroup.add(s.trailLine);
    }
    if (!s.predictedLine) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineDashedMaterial({
        color: 0xeab308,
        transparent: true,
        opacity: 0.5,
        dashSize: 0.02,
        gapSize: 0.01,
        linewidth: 1,
      });
      s.predictedLine = new THREE.Line(geo, mat);
      s.predictedLine.visible = false;
      s.earthGroup.add(s.predictedLine);
    }

    if (trail && trail.length > 1) {
      s.trailLine.geometry.setFromPoints(trail);
      s.trailLine.visible = true;
    } else {
      s.trailLine.visible = false;
    }

    if (predicted && predicted.length > 1) {
      s.predictedLine.geometry.setFromPoints(predicted);
      s.predictedLine.computeLineDistances();
      s.predictedLine.visible = true;
    } else {
      s.predictedLine.visible = false;
    }
  }, []);

  // ---- update threat encounter visualization ----
  const updateThreatEncounter = useCallback((
    threat: ConjunctionEvent | null | undefined,
    debrisList: DebrisTuple[],
    sats: SatelliteSnapshot[],
  ) => {
    const s = sceneRef.current;
    if (!s) return;

    if (!s.threatReticle) {
      const grp = new THREE.Group();
      // Outer diamond bracket
      const outerRingGeo = new THREE.RingGeometry(SAT_SIZE * 2.2, SAT_SIZE * 2.6, 4);
      const outerMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
      grp.add(new THREE.Mesh(outerRingGeo, outerMat));

      // Inner warning circle
      const innerRingGeo = new THREE.RingGeometry(SAT_SIZE * 1.2, SAT_SIZE * 1.5, 32);
      const innerMat = new THREE.MeshBasicMaterial({
        color: 0xff3333,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      });
      grp.add(new THREE.Mesh(innerRingGeo, innerMat));

      grp.visible = false;
      s.earthGroup.add(grp);
      s.threatReticle = grp;
    }

    if (!s.collisionLine) {
      const geo = new THREE.BufferGeometry();
      const mat = new THREE.LineDashedMaterial({
        color: 0xef4444,
        dashSize: 0.015,
        gapSize: 0.01,
        transparent: true,
        opacity: 0.9,
        linewidth: 2,
        depthWrite: false,
      });
      s.collisionLine = new THREE.Line(geo, mat);
      s.collisionLine.visible = false;
      s.earthGroup.add(s.collisionLine);
    }

    if (!s.safetyBubble) {
      const bubbleGeo = new THREE.SphereGeometry(SAT_SIZE * 3.2, 20, 20);
      const bubbleMat = new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        wireframe: true,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      });
      s.safetyBubble = new THREE.Mesh(bubbleGeo, bubbleMat);
      s.safetyBubble.visible = false;
      s.earthGroup.add(s.safetyBubble);
    }

    if (!s.threatTcaMarker) {
      const tcaGeo = new THREE.SphereGeometry(SAT_SIZE * 0.9, 16, 16);
      const tcaMat = new THREE.MeshBasicMaterial({
        color: 0xff4444,
        transparent: true,
        opacity: 0.95,
      });
      s.threatTcaMarker = new THREE.Mesh(tcaGeo, tcaMat);
      s.threatTcaMarker.visible = false;
      s.earthGroup.add(s.threatTcaMarker);
    }

    if (!threat) {
      s.threatReticle.visible = false;
      s.collisionLine.visible = false;
      s.safetyBubble.visible = false;
      s.threatTcaMarker.visible = false;
      return;
    }

    // Satellite position
    const satMesh = s.satMeshes.get(threat.satellite_id);
    let satPos: THREE.Vector3 | null = satMesh ? satMesh.position.clone() : null;
    if (!satPos) {
      const sat = sats.find(item => item.id === threat.satellite_id);
      if (sat) {
        satPos = geoTo3D(sat.lat, sat.lon, 550).multiplyScalar(1 + SAT_ALT_OFFSET);
      }
    }

    // Threatening debris position
    const debTuple = debrisList.find(d => d[0] === threat.debris_id);
    let debPos: THREE.Vector3 | null = null;
    if (debTuple) {
      debPos = geoTo3D(debTuple[1], debTuple[2], debTuple[3]);
    } else if (satPos && threat.deb_pos_eci_km && threat.sat_pos_eci_km) {
      const dx = (threat.deb_pos_eci_km[0] - threat.sat_pos_eci_km[0]) * SCALE * 8.0;
      const dy = (threat.deb_pos_eci_km[1] - threat.sat_pos_eci_km[1]) * SCALE * 8.0;
      const dz = (threat.deb_pos_eci_km[2] - threat.sat_pos_eci_km[2]) * SCALE * 8.0;
      debPos = satPos.clone().add(new THREE.Vector3(-dx, dz, dy));
    }

    if (!satPos || !debPos) {
      s.threatReticle.visible = false;
      s.collisionLine.visible = false;
      s.safetyBubble.visible = false;
      s.threatTcaMarker.visible = false;
      return;
    }

    // Position reticle over threatening debris
    s.threatReticle.position.copy(debPos);
    s.threatReticle.lookAt(0, 0, 0);
    s.threatReticle.visible = true;

    // Connect collision trajectory line
    s.collisionLine.geometry.setFromPoints([satPos, debPos]);
    s.collisionLine.computeLineDistances();
    s.collisionLine.visible = true;

    // Safety bubble around satellite (green nominal, pulsing red critical)
    s.safetyBubble.position.copy(satPos);
    const isCritical = threat.miss_distance_km < 0.1;
    const isWarning = threat.miss_distance_km < 1.0;
    const bubbleColor = isCritical ? 0xef4444 : isWarning ? 0xeab308 : 0x22c55e;
    (s.safetyBubble.material as THREE.MeshBasicMaterial).color.setHex(bubbleColor);
    s.safetyBubble.visible = true;

    // Position TCA point marker
    const mid = satPos.clone().lerp(debPos, 0.5);
    s.threatTcaMarker.position.copy(mid);
    s.threatTcaMarker.visible = true;
  }, []);

  // ---- sync data to scene ----
  useEffect(() => {
    updateDebris(debris);
  }, [debris, updateDebris]);

  useEffect(() => {
    updateSatellites(satellites, selectedSatId);
  }, [satellites, selectedSatId, updateSatellites]);

  useEffect(() => {
    updateTrajectory(trailPoints, predictedPoints);
  }, [trailPoints, predictedPoints, updateTrajectory]);

  useEffect(() => {
    updateThreatEncounter(threatEvent, debris, satellites);
  }, [threatEvent, debris, satellites, updateThreatEncounter]);

  const [isCloseUpFocus, setIsCloseUpFocus] = useState(false);

  const toggleFocus = () => {
    const s = sceneRef.current;
    if (!s) return;
    s.autoRotate = false;

    if (!isCloseUpFocus && threatEvent) {
      const satMesh = s.satMeshes.get(threatEvent.satellite_id);
      if (satMesh) {
        const satPos = satMesh.position;
        const dir = satPos.clone().normalize();
        s.targetLookAt = satPos.clone();
        s.targetCamPos = satPos.clone().add(dir.multiplyScalar(0.32)).add(new THREE.Vector3(0.06, 0.06, 0.06));
        s.isFocusingEncounter = true;
        setIsCloseUpFocus(true);
      }
    } else {
      s.targetLookAt = new THREE.Vector3(0, 0, 0);
      s.targetCamPos = new THREE.Vector3(0, 0.6, CAMERA_DISTANCE);
      s.isFocusingEncounter = true;
      setIsCloseUpFocus(false);
    }
  };

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        ...style,
      }}
    >
      <div
        ref={mountRef}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 0,
        }}
      />

      {/* Tactical Encounter HUD Overlay */}
      {threatEvent && (
        <div
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            zIndex: 10,
            background: 'rgba(8, 10, 15, 0.92)',
            border: `1px solid ${threatEvent.miss_distance_km < 0.1 ? '#ef4444' : '#58b8ff'}88`,
            boxShadow: `0 8px 24px rgba(0,0,0,0.8), 0 0 16px ${threatEvent.miss_distance_km < 0.1 ? 'rgba(239, 68, 68, 0.25)' : 'rgba(88, 184, 255, 0.15)'}`,
            borderRadius: '4px',
            padding: '10px 12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            width: '240px',
            backdropFilter: 'blur(8px)',
            pointerEvents: 'auto',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: threatEvent.miss_distance_km < 0.1 ? '#ef4444' : '#eab308',
                  boxShadow: `0 0 8px ${threatEvent.miss_distance_km < 0.1 ? '#ef4444' : '#eab308'}`,
                }}
              />
              <span style={{ color: '#fff', fontSize: '10px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                Tactical Encounter HUD
              </span>
            </div>
            <span
              style={{
                fontSize: '8px',
                color: threatEvent.miss_distance_km < 0.1 ? '#ef4444' : '#eab308',
                background: threatEvent.miss_distance_km < 0.1 ? 'rgba(239, 68, 68, 0.16)' : 'rgba(234, 179, 8, 0.16)',
                padding: '2px 5px',
                borderRadius: '3px',
                fontWeight: 700,
                textTransform: 'uppercase',
              }}
            >
              {threatEvent.miss_distance_km < 0.1 ? 'CRITICAL BREACH' : 'WARNING'}
            </span>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: '6px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>Encounter:</span>
              <span style={{ color: '#58b8ff', fontWeight: 600 }}>
                {threatEvent.satellite_id} <span style={{ color: 'rgba(255,255,255,0.4)' }}>⚔️</span> <span style={{ color: '#ef4444' }}>{threatEvent.debris_id}</span>
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>Miss Distance:</span>
              <span style={{ color: threatEvent.miss_distance_km < 0.1 ? '#ef4444' : '#fff', fontWeight: 700 }}>
                {threatEvent.miss_distance_km < 1 ? `${Math.round(threatEvent.miss_distance_km * 1000)} m` : `${threatEvent.miss_distance_km.toFixed(2)} km`}
                {threatEvent.miss_distance_km < 0.1 && ' (< 100m!)'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'rgba(255,255,255,0.5)' }}>Closing Speed:</span>
              <span style={{ color: '#fff' }}>{threatEvent.approach_speed_km_s.toFixed(2)} km/s</span>
            </div>
            {nowEpochS != null && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)' }}>Time to TCA:</span>
                <span style={{ color: '#eab308', fontWeight: 600 }}>
                  {(() => {
                    const dt = Math.round(threatEvent.tca_epoch_s - nowEpochS);
                    const sign = dt >= 0 ? 'T-' : 'T+';
                    const s = Math.abs(dt);
                    const m = Math.floor(s / 60);
                    return `${sign}${m}m ${s % 60}s`;
                  })()}
                </span>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
            <button
              type="button"
              onClick={toggleFocus}
              style={{
                flex: 1,
                background: isCloseUpFocus ? 'rgba(88, 184, 255, 0.25)' : 'rgba(239, 68, 68, 0.2)',
                border: `1px solid ${isCloseUpFocus ? '#58b8ff' : '#ef4444'}`,
                color: '#fff',
                padding: '5px 8px',
                borderRadius: '3px',
                fontSize: '9px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              {isCloseUpFocus ? '🌍 Reset Fleet View' : '🎯 Focus Close-up'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Export the helper so App.tsx can convert trajectory data to Vector3[]
export function trajectoryToVectors(
  points: { lat: number; lon: number; alt_km: number }[],
): THREE.Vector3[] {
  return points.map(p => geoTo3D(p.lat, p.lon, p.alt_km));
}
