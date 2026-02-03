import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

/**
 * MinerLife (tiny voxel prototype)
 * - Pointer lock FPS controls
 * - Simple voxel terrain
 * - Left click: remove block
 * - Right click: place block
 */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f14);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.05,
  500
);
camera.position.set(8, 4, 8);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.domElement.tabIndex = 0; // helps pointer-lock / focus in some browsers
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// lights
scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const sun = new THREE.DirectionalLight(0xffffff, 1.0);
sun.position.set(30, 60, 20);
scene.add(sun);

// ground (visual reference)
const grid = new THREE.GridHelper(128, 128, 0x223043, 0x121a24);
grid.position.y = 0;
scene.add(grid);

// -------------------- controls --------------------
const controls = new PointerLockControls(camera, renderer.domElement);

const blocker = document.getElementById("blocker");
const startBtn = document.getElementById("start");

function requestLock() {
  renderer.domElement.focus?.();
  controls.lock();
}

startBtn.addEventListener("click", requestLock);

// allow clicking the canvas to lock too
renderer.domElement.addEventListener("click", () => {
  if (!controls.isLocked) requestLock();
});

// overlay updates
controls.addEventListener("lock", () => (blocker.style.display = "none"));
controls.addEventListener("unlock", () => (blocker.style.display = "grid"));

// movement input
const keys = new Set();
window.addEventListener("keydown", (e) => keys.add(e.code));
window.addEventListener("keyup", (e) => keys.delete(e.code));

// Prevent right-click menu (we use RMB for placing)
window.addEventListener("contextmenu", (e) => e.preventDefault());

// -------------------- voxel world --------------------
const SIZE_X = 32,
  SIZE_Y = 16,
  SIZE_Z = 32;

// Store blocks in a Set as "x,y,z"
const blocks = new Set();
const keyOf = (x, y, z) => `${x},${y},${z}`;

function addBlock(x, y, z) {
  if (x < 0 || x >= SIZE_X || y < 0 || y >= SIZE_Y || z < 0 || z >= SIZE_Z)
    return false;
  const k = keyOf(x, y, z);
  if (blocks.has(k)) return false;
  blocks.add(k);
  return true;
}

function removeBlock(x, y, z) {
  return blocks.delete(keyOf(x, y, z));
}

// Terrain: flat-ish with small hills
for (let x = 0; x < SIZE_X; x++) {
  for (let z = 0; z < SIZE_Z; z++) {
    const h =
      2 +
      Math.floor(Math.sin(x * 0.35) * 1.2 + Math.cos(z * 0.3) * 1.2);
    for (let y = 0; y <= h; y++) addBlock(x, y, z);
  }
}

// Instanced mesh for blocks
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const boxMat = new THREE.MeshStandardMaterial({
  color: 0x4aa35a,
  roughness: 1,
});

let instanced = null;
let instanceToPos = []; // instanceId -> {x,y,z}

function rebuildInstances() {
  if (instanced) {
    scene.remove(instanced);
    instanced = null;
  }

  const count = blocks.size;
  instanced = new THREE.InstancedMesh(boxGeo, boxMat, count);
  instanced.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  instanced.frustumCulled = false;
  instanced.name = "voxels";
  scene.add(instanced);

  instanceToPos = new Array(count);

  const dummy = new THREE.Object3D();
  let i = 0;

  for (const k of blocks) {
    const [x, y, z] = k.split(",").map(Number);

    dummy.position.set(x + 0.5, y + 0.5, z + 0.5);
    dummy.updateMatrix();
    instanced.setMatrixAt(i, dummy.matrix);

    instanceToPos[i] = { x, y, z };
    i++;
  }

  instanced.instanceMatrix.needsUpdate = true;
}

rebuildInstances();

// -------------------- raycast place/break --------------------
const raycaster = new THREE.Raycaster();
raycaster.far = 6; // reach distance

function worldPointToVoxel(p) {
  return {
    x: Math.floor(p.x),
    y: Math.floor(p.y),
    z: Math.floor(p.z),
  };
}

function tryBreak() {
  if (!instanced) return;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObject(instanced, false);
  if (!hits.length) return;

  const hit = hits[0];
  const id = hit.instanceId;
  if (id == null) return;

  const pos = instanceToPos[id];
  if (!pos) return;

  if (removeBlock(pos.x, pos.y, pos.z)) rebuildInstances();
}

function tryPlace() {
  if (!instanced) return;
  raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hits = raycaster.intersectObject(instanced, false);
  if (!hits.length) return;

  const hit = hits[0];

  // place just outside the hit face
  const placePoint = hit.point
    .clone()
    .add(hit.face.normal.clone().multiplyScalar(0.01));
  const v = worldPointToVoxel(placePoint);

  if (addBlock(v.x, v.y, v.z)) rebuildInstances();
}

// mouse buttons: 0 = left, 2 = right
window.addEventListener("mousedown", (e) => {
  if (!controls.isLocked) return;
  if (e.button === 0) tryBreak();
  if (e.button === 2) tryPlace();
});

// -------------------- loop --------------------
const clock = new THREE.Clock();
const velocity = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);

  if (controls.isLocked) {
    // fly-style movement (no collision yet)
    const speed = 8.0;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    // FIX: correct right vector so A/D are not swapped
    const up = new THREE.Vector3(0, 1, 0);
const right = new THREE.Vector3().crossVectors(forward, up).normalize();

    velocity.set(0, 0, 0);
    if (keys.has("KeyW")) velocity.add(forward);
    if (keys.has("KeyS")) velocity.sub(forward);
    if (keys.has("KeyA")) velocity.sub(right);
    if (keys.has("KeyD")) velocity.add(right);
    if (keys.has("Space")) velocity.y += 1;
    if (keys.has("ShiftLeft") || keys.has("ShiftRight")) velocity.y -= 1;

    if (velocity.lengthSq() > 0) {
      velocity.normalize().multiplyScalar(speed * dt);
    }

    controls.getObject().position.add(velocity);

    // keep camera above ground-ish
    controls.getObject().position.y = Math.max(1.2, controls.getObject().position.y);
  }

  renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
