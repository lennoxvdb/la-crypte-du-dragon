// Effets de shader ajoutés aux matériaux des personnages :
//  - contour lumineux (lueur de bord / « rim light ») : cible visée, coup reçu
//  - dissolution avec bord incandescent : disparition des monstres vaincus
import * as THREE from 'three';

const NOISE = /* glsl */ `
float fxHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float fxNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(fxHash(i), fxHash(i + vec3(1, 0, 0)), f.x), mix(fxHash(i + vec3(0, 1, 0)), fxHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(fxHash(i + vec3(0, 0, 1)), fxHash(i + vec3(1, 0, 1)), f.x), mix(fxHash(i + vec3(0, 1, 1)), fxHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

// Ajoute les effets à un matériau standard (une seule fois) et renvoie ses réglages.
export function enhance(mat) {
  if (mat.userData.fx) return mat.userData.fx;
  const u = {
    uRim: { value: 0 },
    uRimColor: { value: new THREE.Color(1, 0.78, 0.3) },
    uDissolve: { value: 0 },
    uEdgeColor: { value: new THREE.Color(1, 0.42, 0.08) },
    uNoiseScale: { value: 7 },
  };
  mat.userData.fx = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFxPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFxPos = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFxPos;
uniform float uRim, uDissolve, uNoiseScale;
uniform vec3 uRimColor, uEdgeColor;
${NOISE}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
float fxN = fxNoise(vFxPos * uNoiseScale) * 0.7 + fxNoise(vFxPos * uNoiseScale * 2.7) * 0.3;
if (uDissolve > 0.0 && fxN < uDissolve) discard;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float fxFr = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.2);
  totalEmissiveRadiance += uRimColor * uRim * fxFr;
  if (uDissolve > 0.0) totalEmissiveRadiance += uEdgeColor * smoothstep(uDissolve + 0.08, uDissolve, fxN) * 6.0;
}`);
  };
  mat.customProgramCacheKey = () => 'fx1';
  mat.needsUpdate = true;
  return u;
}

// Pilote un ensemble de matériaux (un personnage)
export class FxSet {
  constructor(root) {
    this.list = [];
    const seen = new Set();
    root.traverse((o) => {
      if (!o.isMesh || seen.has(o.material) || !o.material.isMeshStandardMaterial) return;
      seen.add(o.material);
      this.list.push(enhance(o.material));
    });
    this.rim = 0;
    this.dissolve = 0;
  }
  setRim(v, color) {
    if (Math.abs(v - this.rim) < 0.003 && !color) return;
    this.rim = v;
    for (const u of this.list) { u.uRim.value = v; if (color) u.uRimColor.value.copy(color); }
  }
  setDissolve(v, scale) {
    this.dissolve = v;
    for (const u of this.list) { u.uDissolve.value = v; if (scale) u.uNoiseScale.value = scale; }
  }
}
