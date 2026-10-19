// Personnages animés (modèles KayKit de Kay Lousberg, licence CC0) : chargement, clonage, animations.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const FILES = ['Knight', 'Mage', 'Rogue_Hooded', 'Skeleton_Warrior', 'Skeleton_Rogue', 'Skeleton_Minion',
  'Skeleton_Blade', 'Skeleton_Shield_Small_A', 'Skeleton_Crossbow', 'anims_hero', 'anims_skeleton'];
const store = {};

export async function loadAssets(onProgress) {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(FILES.map((n) => loader.loadAsync(`models/${n}.glb`).then((g) => {
    store[n] = g;
    onProgress && onProgress(++done / FILES.length);
  })));
}
export const hasAssets = () => !!store.anims_hero;

// ---------------------------------------------------------------- Lecteur d'animations
export class Animator {
  constructor(mixer, clips) {
    this.mixer = mixer;
    this.actions = {};
    for (const c of clips) this.actions[c.name] = mixer.clipAction(c);
    this.cur = null;
    this.curName = '';
    this.key = null;
  }
  duration(name) { const a = this.actions[name]; return a ? a.getClip().duration : 1; }
  // key : change de valeur pour forcer le redémarrage d'un même clip (combo, nouvelle attaque…)
  play(name, { fade = 0.15, loop = true, speed = 1, key = null } = {}) {
    const a = this.actions[name];
    if (!a) return;
    if (this.curName === name && key === this.key) { a.timeScale = speed; return; }
    this.key = key;
    const prev = this.cur;
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = !loop;
    a.timeScale = speed;
    a.setEffectiveWeight(1);
    a.play();
    if (prev && prev !== a) a.crossFadeFrom(prev, fade, false);
    this.cur = a;
    this.curName = name;
  }
  update(dt) { this.mixer.update(dt); }
}

// ---------------------------------------------------------------- Fabrique de personnages
// opts : { anims:'hero'|'skeleton', hide:[noms], height, weapons:[{ model, bone }], tint }
export function createCharacter(name, opts = {}) {
  const src = store[name];
  const model = SkeletonUtils.clone(src.scene);
  const hide = new Set(opts.hide || []);
  const mats = new Map();
  model.traverse((o) => {
    if (hide.has(o.name)) o.visible = false;
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    if (!mats.has(o.material)) {
      const m = o.material.clone();
      m.roughness = Math.min(m.roughness ?? 1, 0.8);
      m.envMapIntensity = 0.7;
      if (opts.tint) m.color.multiply(new THREE.Color(opts.tint));
      mats.set(o.material, m);
    }
    o.material = mats.get(o.material);
  });
  // GLTFLoader retire les caractères réservés des noms (« handslot.r » -> « handslotr »)
  const bone = (n) => model.getObjectByName(n) || model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(n));
  for (const w of opts.weapons || []) {
    const wm = store[w.model].scene.clone(true);
    wm.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.material = o.material.clone();
    });
    bone(w.bone).add(wm);
  }
  // mise à l'échelle sur une hauteur cible (pose de repos)
  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  model.traverse((o) => { if (o.isMesh && o.visible && o.parent && o.parent.visible !== false) box.expandByObject(o); });
  const h = Math.max(0.5, box.max.y - box.min.y);
  const root = new THREE.Group();
  root.add(model);
  model.scale.setScalar((opts.height || 1.85) / h);
  const mixer = new THREE.AnimationMixer(model);
  const anim = new Animator(mixer, store['anims_' + (opts.anims || 'hero')].animations);
  anim.play('Idle', { fade: 0 });
  return { root, model, anim, bone };
}

// marqueurs base / pointe le long du plus grand axe d'une arme (pour la traînée lumineuse)
export function weaponMarkers(node) {
  let mesh = null;
  node.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
  if (!mesh) return null;
  mesh.geometry.computeBoundingBox();
  const b = mesh.geometry.boundingBox;
  const size = new THREE.Vector3().subVectors(b.max, b.min);
  const axis = size.x > size.y ? (size.x > size.z ? 'x' : 'z') : size.y > size.z ? 'y' : 'z';
  const base = new THREE.Object3D(), tip = new THREE.Object3D();
  const c = new THREE.Vector3().addVectors(b.min, b.max).multiplyScalar(0.5);
  base.position.copy(c);
  tip.position.copy(c);
  // la poignée est du côté le plus proche de l'origine (la main)
  const minNear = Math.abs(b.min[axis]) < Math.abs(b.max[axis]);
  base.position[axis] = minNear ? b.min[axis] + size[axis] * 0.3 : b.max[axis] - size[axis] * 0.3;
  tip.position[axis] = minNear ? b.max[axis] : b.min[axis];
  mesh.add(base, tip);
  return { w: mesh, base, tip };
}
