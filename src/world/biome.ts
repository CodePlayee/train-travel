import * as THREE from 'three';

export type BiomeName = 'grassland' | 'forest' | 'mountains' | 'desert' | 'lake';

export interface BiomeColorConfig {
  ground: THREE.Color;
  hill: THREE.Color;
}

export interface BiomeHeightConfig {
  scale: number;
  base: number;
}

export interface BiomeInfo {
  biome: BiomeName;
  dist: number;
  t: number;
}

export interface BiomeWeight {
  biome: BiomeName;
  weight: number;
  dist: number;
  t: number;
}

// Biome sequence repeats every CYCLE_LENGTH units of track distance
const BIOME_SEQUENCE: { biome: BiomeName; length: number }[] = [
  { biome: 'grassland', length: 200 },
  { biome: 'forest', length: 200 },
  { biome: 'mountains', length: 150 },
  { biome: 'desert', length: 150 },
  { biome: 'lake', length: 150 },
  { biome: 'grassland', length: 150 },
];

const CYCLE_LENGTH = BIOME_SEQUENCE.reduce((sum, b) => sum + b.length, 0);

/**
 * Get biome for a given cumulative track distance.
 * Biomes cycle in a repeating pattern.
 */
export function getBiomeAtDistance(distance: number): BiomeName {
  const d = ((distance % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH;
  let acc = 0;
  for (const entry of BIOME_SEQUENCE) {
    acc += entry.length;
    if (d < acc) return entry.biome;
  }
  return 'grassland';
}

/**
 * Get biome blending weights for a given distance.
 * Blends across biome boundaries within BLEND_RANGE.
 */
export function getBiomeWeightsAtDistance(distance: number): BiomeWeight[] {
  const BLEND_RANGE = 30; // world units for transition blending

  const d = ((distance % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH;
  let acc = 0;
  let currentBiome: BiomeName = 'grassland';
  let distInBiome = 0;
  let currentBiomeLength = BIOME_SEQUENCE[0].length;
  let currentIndex = 0;

  for (let i = 0; i < BIOME_SEQUENCE.length; i++) {
    if (d < acc + BIOME_SEQUENCE[i].length) {
      currentBiome = BIOME_SEQUENCE[i].biome;
      distInBiome = d - acc;
      currentBiomeLength = BIOME_SEQUENCE[i].length;
      currentIndex = i;
      break;
    }
    acc += BIOME_SEQUENCE[i].length;
  }

  // Check if we're near a boundary
  const distToEnd = currentBiomeLength - distInBiome;
  const distToStart = distInBiome;

  const weights: BiomeWeight[] = [];

  if (distToStart < BLEND_RANGE) {
    // Near start boundary — blend with previous biome
    const prevIndex = (currentIndex - 1 + BIOME_SEQUENCE.length) % BIOME_SEQUENCE.length;
    const prevBiome = BIOME_SEQUENCE[prevIndex].biome;
    const blendFactor = distToStart / BLEND_RANGE;

    if (prevBiome !== currentBiome) {
      weights.push({ biome: prevBiome, weight: 1 - blendFactor, dist: 0, t: 0 });
      weights.push({ biome: currentBiome, weight: blendFactor, dist: 0, t: 0 });
    } else {
      weights.push({ biome: currentBiome, weight: 1, dist: 0, t: 0 });
    }
  } else if (distToEnd < BLEND_RANGE) {
    // Near end boundary — blend with next biome
    const nextIndex = (currentIndex + 1) % BIOME_SEQUENCE.length;
    const nextBiome = BIOME_SEQUENCE[nextIndex].biome;
    const blendFactor = distToEnd / BLEND_RANGE;

    if (nextBiome !== currentBiome) {
      weights.push({ biome: currentBiome, weight: blendFactor, dist: 0, t: 0 });
      weights.push({ biome: nextBiome, weight: 1 - blendFactor, dist: 0, t: 0 });
    } else {
      weights.push({ biome: currentBiome, weight: 1, dist: 0, t: 0 });
    }
  } else {
    weights.push({ biome: currentBiome, weight: 1, dist: 0, t: 0 });
  }

  return weights;
}

// Keep old API for backwards compatibility during transition
export function getBiome(t: number): BiomeName {
  return getBiomeAtDistance(t * CYCLE_LENGTH);
}

export function getBiomeAtPosition(
  x: number,
  z: number,
  curve: THREE.CatmullRomCurve3,
): BiomeInfo {
  let minDist = Infinity;
  let closestT = 0;

  for (let t = 0; t <= 1; t += 0.005) {
    const p = curve.getPointAt(t);
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < minDist) {
      minDist = d;
      closestT = t;
    }
  }

  return { biome: getBiome(closestT), dist: Math.sqrt(minDist), t: closestT };
}

export function getBiomeWeights(
  x: number,
  z: number,
  curve: THREE.CatmullRomCurve3,
): BiomeWeight[] {
  let minDist = Infinity;
  let closestT = 0;

  for (let t = 0; t <= 1; t += 0.005) {
    const p = curve.getPointAt(t);
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < minDist) {
      minDist = d;
      closestT = t;
    }
  }

  const dist = Math.sqrt(minDist);
  const primaryBiome = getBiome(closestT);

  const BLEND_RANGE = 0.04;
  const biomeMap = new Map<BiomeName, { weight: number; dist: number; t: number }>();

  const steps = 20;
  for (let i = -steps; i <= steps; i++) {
    const sampleT = ((closestT + (i / steps) * BLEND_RANGE) % 1 + 1) % 1;
    const biome = getBiome(sampleT);
    const p = curve.getPointAt(sampleT);
    const d = Math.sqrt((p.x - x) ** 2 + (p.z - z) ** 2);

    const tDist = Math.abs(i / steps);
    const w = Math.max(0, 1 - tDist);

    const existing = biomeMap.get(biome);
    if (!existing || w > existing.weight) {
      biomeMap.set(biome, { weight: w, dist: d, t: sampleT });
    }
  }

  const results: BiomeWeight[] = [];
  let totalWeight = 0;
  biomeMap.forEach((val) => { totalWeight += val.weight; });
  biomeMap.forEach((val, biome) => {
    results.push({
      biome,
      weight: val.weight / totalWeight,
      dist: val.dist,
      t: val.t,
    });
  });

  if (results.length === 0) {
    results.push({ biome: primaryBiome, weight: 1, dist, t: closestT });
  }

  return results;
}

export const BIOME_COLORS: Record<BiomeName, BiomeColorConfig> = {
  grassland: { ground: new THREE.Color(0.25, 0.55, 0.18), hill: new THREE.Color(0.3, 0.6, 0.2) },
  forest:    { ground: new THREE.Color(0.15, 0.4, 0.12),  hill: new THREE.Color(0.1, 0.35, 0.1) },
  mountains: { ground: new THREE.Color(0.45, 0.4, 0.35),  hill: new THREE.Color(0.55, 0.5, 0.45) },
  desert:    { ground: new THREE.Color(0.76, 0.65, 0.4),   hill: new THREE.Color(0.85, 0.75, 0.5) },
  lake:      { ground: new THREE.Color(0.2, 0.5, 0.2),     hill: new THREE.Color(0.25, 0.55, 0.22) },
};

export const BIOME_HEIGHT: Record<BiomeName, BiomeHeightConfig> = {
  grassland: { scale: 5, base: 0 },
  forest:    { scale: 4, base: 0 },
  mountains: { scale: 45, base: 3 },
  desert:    { scale: 3, base: 0 },
  lake:      { scale: 4, base: -2 },
};
