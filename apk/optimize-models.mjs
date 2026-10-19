// Allège les modèles KayKit (CC0) : ne garde que les animations utilisées par le jeu.
// Entrée : dnd3d/models/src/   Sortie : dnd3d/models/*.glb
import { NodeIO } from '@gltf-transform/core';
import { prune, dedup, resample } from '@gltf-transform/functions';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, '../dnd3d/models/src');
const out = path.resolve(here, '../dnd3d/models');

const HERO = ['Idle', 'Walking_A', 'Running_A', 'Dodge_Forward', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal',
  '1H_Melee_Attack_Chop', '1H_Melee_Attack_Stab', 'Block', 'Blocking', 'Hit_A', 'Death_A', 'Spellcast_Shoot', 'Spellcast_Long', 'Spellcast_Raise',
  'Dualwield_Melee_Attack_Slice', 'Dualwield_Melee_Attack_Chop', 'Dualwield_Melee_Attack_Stab', 'Throw', 'Use_Item', '2H_Melee_Attack_Spinning', 'Cheer'];
const SKEL = ['Idle', 'Idle_Combat', 'Walking_D_Skeletons', 'Running_A', '1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '2H_Ranged_Aiming',
  '2H_Ranged_Shoot', 'Hit_A', 'Hit_B', 'Death_C_Skeletons', 'Skeletons_Awaken_Floor', 'Taunt'];

const JOBS = [
  // [fichier source, sortie, animations gardées (null = aucune), garder les maillages]
  ['Knight', 'Knight', null, true], ['Mage', 'Mage', null, true], ['Rogue_Hooded', 'Rogue_Hooded', null, true],
  ['Skeleton_Warrior', 'Skeleton_Warrior', null, true], ['Skeleton_Rogue', 'Skeleton_Rogue', null, true], ['Skeleton_Minion', 'Skeleton_Minion', null, true],
  ['Skeleton_Blade', 'Skeleton_Blade', null, true], ['Skeleton_Shield_Small_A', 'Skeleton_Shield_Small_A', null, true], ['Skeleton_Crossbow', 'Skeleton_Crossbow', null, true],
  // animations partagées (même squelette d'os pour tous)
  ['Knight', 'anims_hero', HERO, false], ['Skeleton_Warrior', 'anims_skeleton', SKEL, false],
];

const io = new NodeIO();
for (const [name, outName, keep, meshes] of JOBS) {
  const file = fs.existsSync(path.join(src, name + '.glb')) ? name + '.glb' : name + '.gltf';
  const doc = await io.read(path.join(src, file));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) {
    if (!keep || !keep.includes(a.getName())) {
      for (const c of a.listChannels()) c.dispose();
      for (const sm of a.listSamplers()) sm.dispose();
      a.dispose();
      continue;
    }
    // les pistes d'échelle sont constantes : inutiles
    for (const c of a.listChannels()) if (c.getTargetPath() === 'scale') { c.getSampler().dispose(); c.dispose(); }
  }
  if (keep) {
    const missing = keep.filter((k) => !root.listAnimations().some((a) => a.getName() === k));
    if (missing.length) console.warn(name, 'animations absentes :', missing.join(', '));
  }
  if (!meshes) {
    for (const n of root.listNodes()) { if (n.getMesh()) n.setMesh(null); if (n.getSkin()) n.setSkin(null); }
    for (const m of root.listMeshes()) m.dispose();
    for (const t of root.listTextures()) t.dispose();
  }
  await doc.transform(resample({ tolerance: 1e-4 }), dedup());
  // supprime les données orphelines (accesseurs des animations retirées)
  for (const acc of root.listAccessors()) if (acc.listParents().every((p) => p === root)) acc.dispose();
  await doc.transform(prune({ keepLeaves: true }));
  const dest = path.join(out, outName + '.glb');
  await io.write(dest, doc);
  console.log(`${outName}: ${(fs.statSync(dest).size / 1024) | 0} Ko`);
}
