import * as THREE from 'three';
import { getBiomeAtDistance, getBiomeWeightsAtDistance, BIOME_COLORS, BIOME_HEIGHT, BiomeWeight } from './biome';
import { terrainFbm, noise2D } from '../utils/noise';
import { TrackSegment } from './trackSegment';
import { createTerrainMaterial } from './terrainShader';

// Terrain adaptation thresholds
const HEIGHT_DIFF_THRESHOLD = 5; // meters — beyond this, use bridge or tunnel
const DEFORM_RADIUS = 60; // lateral distance over which terrain deforms toward track
const TRACK_BED_HALF_WIDTH = 2.0; // half-width of flat area at base of roadbed (matches roadbedBottomWidth)
const EMBANKMENT_WIDTH = 12; // width of raised embankment zone around track
const BRIDGE_PILLAR_SPACING = 15; // world units between bridge pillars
const TUNNEL_MIN_LENGTH = 10; // minimum continuous length (meters) to qualify as tunnel
const TUNNEL_RADIUS = 5; // radius of tunnel tube
const TUNNEL_EXTENSION = 8; // meters to extend tunnel beyond mountain surface on each end

// Multi-resolution terrain constants
const NEAR_WIDTH = 80; // must be >= DEFORM_RADIUS to avoid seam artifacts
const NEAR_SAMPLES_ACROSS = 60;
const FAR_INNER = 80; // must match NEAR_WIDTH
const FAR_OUTER = 300;
const FAR_SAMPLES_ACROSS = 30;
const SAMPLES_ALONG = 40;

// Biome index mapping for shader attributes
const BIOME_INDEX_MAP: Record<string, number> = {
  grassland: 0,
  forest: 1,
  mountains: 2,
  desert: 3,
  lake: 4,
};

/**
 * Compute natural terrain height at a world position.
 */
function computeNaturalHeight(
  wx: number, wz: number, distAlongTrack: number
): { h: number; weights: BiomeWeight[]; ridgeFactor: number } {
  const weights = getBiomeWeightsAtDistance(distAlongTrack);

  let ridgeFactor = 0;
  for (const w of weights) {
    ridgeFactor += BIOME_HEIGHT[w.biome].ridge * w.weight;
  }
  const largeFbm = terrainFbm(wx * 0.004, wz * 0.004, 4, ridgeFactor);
  const detailNoise = noise2D(wx * 0.015, wz * 0.015) * 0.8
    + noise2D(wx * 0.04, wz * 0.04) * 0.3;

  let h = 0;
  for (const w of weights) {
    const bh = BIOME_HEIGHT[w.biome];
    h += (largeFbm * bh.scale + bh.base + detailNoise) * w.weight;
  }

  return { h, weights, ridgeFactor };
}

/**
 * Store biome weight/index data into attribute arrays for a given vertex.
 */
function storeBiomeAttributes(
  weights: BiomeWeight[],
  biomeWeightsArr: Float32Array,
  biomeIndicesArr: Float32Array,
  vertIdx: number,
): void {
  for (let k = 0; k < 3; k++) {
    if (k < weights.length) {
      biomeWeightsArr[vertIdx * 3 + k] = weights[k].weight;
      biomeIndicesArr[vertIdx * 3 + k] = BIOME_INDEX_MAP[weights[k].biome];
    } else {
      biomeWeightsArr[vertIdx * 3 + k] = 0;
      biomeIndicesArr[vertIdx * 3 + k] = 0;
    }
  }
}

/**
 * Compute steepness attribute from vertex normals after geometry normals are computed.
 */
function computeSteepnessAttribute(geo: THREE.BufferGeometry): void {
  const normals = geo.attributes.normal;
  const count = normals.count;
  const steepness = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    steepness[i] = 1.0 - Math.abs(normals.getY(i));
  }
  geo.setAttribute('steepness', new THREE.BufferAttribute(steepness, 1));
}

/**
 * Compute vertex color for a position given biome weights and height.
 */
function computeVertexColor(
  weights: BiomeWeight[],
  largeFbm: number,
  detailNoise: number,
): THREE.Color {
  const col = new THREE.Color(0, 0, 0);
  for (const w of weights) {
    const bh = BIOME_HEIGHT[w.biome];
    const bc = BIOME_COLORS[w.biome];
    const biomeH = largeFbm * bh.scale + bh.base + detailNoise;
    const heightFactor = Math.max(0, Math.min(1, biomeH / (bh.scale || 1)));
    const biomeCol = bc.ground.clone().lerp(bc.hill, heightFactor * 0.5);

    // Snow on mountain peaks
    if (w.biome === 'mountains' && biomeH > 30) {
      biomeCol.lerp(new THREE.Color(0.95, 0.95, 0.98), (biomeH - 30) / 15);
    }

    col.r += biomeCol.r * w.weight;
    col.g += biomeCol.g * w.weight;
    col.b += biomeCol.b * w.weight;
  }
  return col;
}

// Shared material instance (lazy-initialized)
let sharedTerrainMat: THREE.Material | null = null;
function getTerrainMaterial(): THREE.Material {
  if (!sharedTerrainMat) {
    sharedTerrainMat = createTerrainMaterial();
  }
  return sharedTerrainMat;
}

/**
 * Generate terrain strip around a single track segment.
 * Uses multi-resolution: high-detail near terrain (±40m) and low-detail far terrain (40m-300m).
 * Adapts terrain to track: deformation, bridges, and tunnels.
 */
export function createSegmentTerrain(
  segment: TrackSegment,
  cumulativeDistance: number,
): void {
  // Track data we collect per along-sample for bridge/tunnel decisions
  const trackHeights: number[] = [];
  const naturalHeightsAtTrack: number[] = [];

  // First pass: compute natural terrain heights at track center for each along-sample
  for (let i = 0; i <= SAMPLES_ALONG; i++) {
    const t = i / SAMPLES_ALONG;
    const trackPoint = segment.getPointAt(t);
    const distAlongTrack = cumulativeDistance + t * segment.arcLength;
    const { h } = computeNaturalHeight(trackPoint.x, trackPoint.z, distAlongTrack);

    trackHeights.push(trackPoint.y);
    naturalHeightsAtTrack.push(h);
  }

  // Detect tunnel regions (continuous 10m+ of terrain above track by >5m)
  const tunnelRegions = detectTunnelRegions(segment, trackHeights, naturalHeightsAtTrack, SAMPLES_ALONG);

  const mat = getTerrainMaterial();

  // --- Near terrain: ±NEAR_WIDTH from track center ---
  createNearTerrain(segment, cumulativeDistance, trackHeights, tunnelRegions, mat);

  // --- Far terrain: FAR_INNER to FAR_OUTER on each side ---
  createFarTerrain(segment, cumulativeDistance, mat);

  // Add bridge pillars where track is significantly above terrain
  addBridgePillars(segment, cumulativeDistance, trackHeights, naturalHeightsAtTrack, SAMPLES_ALONG);

  // Add tunnel tubes where terrain is continuously above track
  addTunnels(segment, tunnelRegions);

  // Add water plane if lake biome
  if (biomeHasWater(cumulativeDistance, segment.arcLength)) {
    addWaterSurface(segment);
  }
}

/**
 * Create the high-resolution near terrain mesh (±NEAR_WIDTH from track).
 * Includes all track deformation logic.
 */
function createNearTerrain(
  segment: TrackSegment,
  cumulativeDistance: number,
  trackHeights: number[],
  tunnelRegions: Array<{ startT: number; endT: number }>,
  mat: THREE.Material,
): void {
  const nearGeo = new THREE.PlaneGeometry(1, 1, SAMPLES_ALONG, NEAR_SAMPLES_ACROSS);
  const nearPos = nearGeo.attributes.position;
  const nearColors = new Float32Array(nearPos.count * 3);
  const nearBiomeWeights = new Float32Array(nearPos.count * 3);
  const nearBiomeIndices = new Float32Array(nearPos.count * 3);

  for (let j = 0; j <= NEAR_SAMPLES_ACROSS; j++) {
    for (let i = 0; i <= SAMPLES_ALONG; i++) {
      const vertIdx = j * (SAMPLES_ALONG + 1) + i;
      const t = i / SAMPLES_ALONG;
      const lateralFrac = (j / NEAR_SAMPLES_ACROSS) * 2 - 1; // -1 to 1

      const trackPoint = segment.getPointAt(t);
      const tangent = segment.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      const wx = trackPoint.x + normal.x * lateralFrac * NEAR_WIDTH;
      const wz = trackPoint.z + normal.z * lateralFrac * NEAR_WIDTH;
      const distAlongTrack = cumulativeDistance + t * segment.arcLength;

      const { h: naturalH, weights, ridgeFactor } = computeNaturalHeight(wx, wz, distAlongTrack);

      // Recompute fbm/detail for vertex color (matches computeNaturalHeight internals)
      const largeFbm = terrainFbm(wx * 0.004, wz * 0.004, 4, ridgeFactor);
      const detailNoise = noise2D(wx * 0.015, wz * 0.015) * 0.8
        + noise2D(wx * 0.04, wz * 0.04) * 0.3;

      const col = computeVertexColor(weights, largeFbm, detailNoise);

      let h = naturalH;
      const lateralDist = Math.abs(lateralFrac) * NEAR_WIDTH;
      const trackH = trackHeights[i];
      const heightDiff = trackH - naturalH; // positive = track above terrain

      const inTunnelZone = isInTunnel(t, tunnelRegions);

      // Subtle noise to break up perfectly smooth deformation edges
      const edgeNoise = noise2D(wx * 0.08, wz * 0.08) * 0.4;

      if (inTunnelZone) {
        // Tunnel zone: terrain stays at natural height
      } else {
        // Continuous road-aware terrain blending.
        // The terrain is shaped to meet the BASE of the roadbed (trackH - 1.2) within the
        // roadbed footprint, so the roadbed's trapezoidal mound stays clearly visible above ground.
        const trackBedH = trackH - 0.8;
        const absDiff = Math.abs(heightDiff);
        const influenceT = Math.min(1, absDiff / (HEIGHT_DIFF_THRESHOLD * 2));
        const heightInfluence = 1.0 - influenceT * influenceT * influenceT *
          (influenceT * (influenceT * 6 - 15) + 10);

        if (lateralDist < TRACK_BED_HALF_WIDTH) {
          h = THREE.MathUtils.lerp(naturalH, trackBedH, heightInfluence);
        } else if (lateralDist < EMBANKMENT_WIDTH) {
          const embankT = (lateralDist - TRACK_BED_HALF_WIDTH) / (EMBANKMENT_WIDTH - TRACK_BED_HALF_WIDTH);
          const smooth = embankT * embankT * embankT * (embankT * (embankT * 6 - 15) + 10);
          const embankTarget = THREE.MathUtils.lerp(trackBedH, naturalH, 0.3);
          const deformedH = THREE.MathUtils.lerp(trackBedH, embankTarget + edgeNoise, smooth);
          h = THREE.MathUtils.lerp(naturalH, deformedH, heightInfluence);
        } else if (lateralDist < DEFORM_RADIUS) {
          const blendT = (lateralDist - EMBANKMENT_WIDTH) / (DEFORM_RADIUS - EMBANKMENT_WIDTH);
          const smooth = blendT * blendT * blendT * (blendT * (blendT * 6 - 15) + 10);
          const embankEdgeH = THREE.MathUtils.lerp(trackBedH, naturalH, 0.3) + edgeNoise;
          const deformedH = THREE.MathUtils.lerp(embankEdgeH, naturalH, smooth);
          h = THREE.MathUtils.lerp(naturalH, deformedH, heightInfluence);
        }

        // Color: darken near track to suggest gravel/earth — confined to roadbed footprint
        // so we don't paint dirt on bare grass beyond the embankment toe.
        if (lateralDist < TRACK_BED_HALF_WIDTH && heightInfluence > 0.1) {
          const darkT = (1 - lateralDist / TRACK_BED_HALF_WIDTH) * heightInfluence;
          col.r = THREE.MathUtils.lerp(col.r, 0.35, darkT * 0.3);
          col.g = THREE.MathUtils.lerp(col.g, 0.30, darkT * 0.3);
          col.b = THREE.MathUtils.lerp(col.b, 0.25, darkT * 0.3);
        }
      }

      // Water areas in lake biome: smooth shoreline
      const biome = getBiomeAtDistance(distAlongTrack);
      if (biome === 'lake' && lateralDist > 15 && h < 1.0) {
        const waterBlend = Math.max(0, Math.min(1, (1.0 - h) / 2.0));
        h = THREE.MathUtils.lerp(h, Math.min(h, -1.5), waterBlend);
        if (h < 0.5 && h > -1.0) {
          col.r = THREE.MathUtils.lerp(col.r, 0.18, 0.3);
          col.g = THREE.MathUtils.lerp(col.g, 0.40, 0.3);
          col.b = THREE.MathUtils.lerp(col.b, 0.22, 0.3);
        }
      }

      nearPos.setXYZ(vertIdx, wx, h, wz);

      nearColors[vertIdx * 3] = col.r;
      nearColors[vertIdx * 3 + 1] = col.g;
      nearColors[vertIdx * 3 + 2] = col.b;

      // Store biome attributes
      storeBiomeAttributes(weights, nearBiomeWeights, nearBiomeIndices, vertIdx);
    }
  }

  nearGeo.setAttribute('color', new THREE.BufferAttribute(nearColors, 3));
  nearGeo.setAttribute('biomeWeights', new THREE.BufferAttribute(nearBiomeWeights, 3));
  nearGeo.setAttribute('biomeIndices', new THREE.BufferAttribute(nearBiomeIndices, 3));
  nearGeo.computeVertexNormals();
  computeSteepnessAttribute(nearGeo);
  const nearTunnelDist = computeTunnelDistances(nearGeo.attributes.position as THREE.BufferAttribute, segment, tunnelRegions);
  nearGeo.setAttribute('tunnelDist', new THREE.BufferAttribute(nearTunnelDist, 1));

  const nearMesh = new THREE.Mesh(nearGeo, mat);
  segment.terrainGroup.add(nearMesh);
}

/**
 * Compute per-vertex 3D distance to the nearest tunnel centerline sample for a
 * given set of position attributes. Used by the terrain shader to discard
 * fragments inside tunnel volumes — gives a smooth, sub-vertex hole boundary
 * without needing CSG or manifold geometry.
 *
 * Returns a Float32Array of length pos.count, filled with a large sentinel
 * (1e6) where no tunnel is nearby so the shader's `vTunnelDist < radius`
 * test passes through.
 */
function computeTunnelDistances(
  pos: THREE.BufferAttribute,
  segment: TrackSegment,
  tunnelRegions: Array<{ startT: number; endT: number }>,
): Float32Array {
  const out = new Float32Array(pos.count).fill(1e6);
  if (tunnelRegions.length === 0) return out;

  // Densely sample tunnel centerlines.
  const samples: THREE.Vector3[] = [];
  for (const region of tunnelRegions) {
    const arcSpan = (region.endT - region.startT) * segment.arcLength;
    const sampleCount = Math.max(8, Math.round(arcSpan));
    for (let i = 0; i <= sampleCount; i++) {
      const t = region.startT + (i / sampleCount) * (region.endT - region.startT);
      samples.push(segment.getPointAt(t));
    }
  }

  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    let minSq = Infinity;
    for (let s = 0; s < samples.length; s++) {
      const sp = samples[s];
      const dx = v.x - sp.x;
      const dy = v.y - sp.y;
      const dz = v.z - sp.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < minSq) minSq = d2;
    }
    out[i] = Math.sqrt(minSq);
  }

  return out;
}

/**
 * Create the low-resolution far terrain meshes (FAR_INNER to FAR_OUTER on each side).
 * No track deformation applied (too far from track).
 */
function createFarTerrain(
  segment: TrackSegment,
  cumulativeDistance: number,
  mat: THREE.Material,
): void {
  for (const side of [-1, 1] as const) {
    const farGeo = new THREE.PlaneGeometry(1, 1, SAMPLES_ALONG, FAR_SAMPLES_ACROSS);
    const farPos = farGeo.attributes.position;
    const farColors = new Float32Array(farPos.count * 3);
    const farBiomeWeights = new Float32Array(farPos.count * 3);
    const farBiomeIndices = new Float32Array(farPos.count * 3);

    for (let j = 0; j <= FAR_SAMPLES_ACROSS; j++) {
      for (let i = 0; i <= SAMPLES_ALONG; i++) {
        const vertIdx = j * (SAMPLES_ALONG + 1) + i;
        const t = i / SAMPLES_ALONG;

        // lateralDist: for side=1 (right) goes inner→outer as j increases;
        // for side=-1 (left) goes outer→inner to preserve face winding order
        const lateralDist = side === 1
          ? FAR_INNER + (j / FAR_SAMPLES_ACROSS) * (FAR_OUTER - FAR_INNER)
          : FAR_OUTER - (j / FAR_SAMPLES_ACROSS) * (FAR_OUTER - FAR_INNER);

        const trackPoint = segment.getPointAt(t);
        const tangent = segment.getTangentAt(t);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

        const wx = trackPoint.x + normal.x * side * lateralDist;
        const wz = trackPoint.z + normal.z * side * lateralDist;
        const distAlongTrack = cumulativeDistance + t * segment.arcLength;

        const { h, weights, ridgeFactor } = computeNaturalHeight(wx, wz, distAlongTrack);

        // Compute vertex color
        const largeFbm = terrainFbm(wx * 0.004, wz * 0.004, 4, ridgeFactor);
        const detailNoise = noise2D(wx * 0.015, wz * 0.015) * 0.8
          + noise2D(wx * 0.04, wz * 0.04) * 0.3;
        const col = computeVertexColor(weights, largeFbm, detailNoise);

        // Water areas in lake biome
        let finalH = h;
        const biome = getBiomeAtDistance(distAlongTrack);
        if (biome === 'lake' && lateralDist > 15 && finalH < 1.0) {
          const waterBlend = Math.max(0, Math.min(1, (1.0 - finalH) / 2.0));
          finalH = THREE.MathUtils.lerp(finalH, Math.min(finalH, -1.5), waterBlend);
          if (finalH < 0.5 && finalH > -1.0) {
            col.r = THREE.MathUtils.lerp(col.r, 0.18, 0.3);
            col.g = THREE.MathUtils.lerp(col.g, 0.40, 0.3);
            col.b = THREE.MathUtils.lerp(col.b, 0.22, 0.3);
          }
        }

        farPos.setXYZ(vertIdx, wx, finalH, wz);

        farColors[vertIdx * 3] = col.r;
        farColors[vertIdx * 3 + 1] = col.g;
        farColors[vertIdx * 3 + 2] = col.b;

        // Store biome attributes
        storeBiomeAttributes(weights, farBiomeWeights, farBiomeIndices, vertIdx);
      }
    }

    farGeo.setAttribute('color', new THREE.BufferAttribute(farColors, 3));
    farGeo.setAttribute('biomeWeights', new THREE.BufferAttribute(farBiomeWeights, 3));
    farGeo.setAttribute('biomeIndices', new THREE.BufferAttribute(farBiomeIndices, 3));
    farGeo.computeVertexNormals();
    computeSteepnessAttribute(farGeo);
    const farTunnelDist = new Float32Array(farGeo.attributes.position.count).fill(1e6);
    farGeo.setAttribute('tunnelDist', new THREE.BufferAttribute(farTunnelDist, 1));

    const farMesh = new THREE.Mesh(farGeo, mat);
    segment.terrainGroup.add(farMesh);
  }
}

/**
 * Add water surface with gentle wave displacement for lake biomes.
 * Uses two layers: a darker deep layer and a lighter rippled surface.
 */
function addWaterSurface(segment: TrackSegment): void {
  const HALF_WIDTH_VAL = 300;
  const center = segment.getPointAt(0.5);
  const tangent = segment.getTangentAt(0.5);
  const angle = Math.atan2(tangent.x, tangent.z);

  // Deep water layer — darker, still
  const deepWaterGeo = new THREE.PlaneGeometry(
    HALF_WIDTH_VAL * 2, segment.arcLength * 1.2, 1, 1,
  );
  deepWaterGeo.rotateX(-Math.PI / 2);
  const deepWaterMat = new THREE.MeshStandardMaterial({
    color: 0x0e3d4a,
    transparent: true,
    opacity: 0.6,
    metalness: 0.1,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  const deepWater = new THREE.Mesh(deepWaterGeo, deepWaterMat);
  deepWater.position.set(center.x, -1.8, center.z);
  deepWater.rotation.y = angle;
  segment.terrainGroup.add(deepWater);

  // Surface water layer — lighter with wave displacement
  const surfSegsX = 24;
  const surfSegsZ = Math.max(8, Math.round(segment.arcLength / 8));
  const surfaceWaterGeo = new THREE.PlaneGeometry(
    HALF_WIDTH_VAL * 2 - 10, segment.arcLength * 1.1,
    surfSegsX, surfSegsZ,
  );
  surfaceWaterGeo.rotateX(-Math.PI / 2);

  // Apply wave displacement to vertices
  const surfPos = surfaceWaterGeo.attributes.position;
  for (let i = 0; i < surfPos.count; i++) {
    const x = surfPos.getX(i);
    const z = surfPos.getZ(i);
    // Multiple wave frequencies for natural-looking ripples
    const wave1 = Math.sin(x * 0.15 + z * 0.1) * 0.12;
    const wave2 = Math.sin(x * 0.3 - z * 0.2) * 0.06;
    const wave3 = noise2D((center.x + x) * 0.05, (center.z + z) * 0.05) * 0.15;
    surfPos.setY(i, surfPos.getY(i) + wave1 + wave2 + wave3);
  }
  surfaceWaterGeo.computeVertexNormals();

  const surfaceWaterMat = new THREE.MeshStandardMaterial({
    color: 0x1a8899,
    transparent: true,
    opacity: 0.45,
    metalness: 0.4,
    roughness: 0.1,
    side: THREE.DoubleSide,
  });
  const surfaceWater = new THREE.Mesh(surfaceWaterGeo, surfaceWaterMat);
  surfaceWater.position.set(center.x, -0.4, center.z);
  surfaceWater.rotation.y = angle;
  segment.terrainGroup.add(surfaceWater);
}

/**
 * Add detailed bridge pillars with twin columns, cross-bracing, and guardrails.
 */
function addBridgePillars(
  segment: TrackSegment,
  _cumulativeDistance: number,
  trackHeights: number[],
  naturalHeights: number[],
  samplesAlong: number,
): void {
  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x999999,
    roughness: 0.8,
    metalness: 0.1,
  });
  const steelMat = new THREE.MeshStandardMaterial({
    color: 0x777777,
    roughness: 0.5,
    metalness: 0.6,
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x666666,
    roughness: 0.6,
    metalness: 0.4,
  });

  const pillarCount = Math.max(1, Math.floor(segment.arcLength / BRIDGE_PILLAR_SPACING));

  // Collect bridge pillar data for guardrails
  const bridgePoints: Array<{
    point: THREE.Vector3;
    trackH: number;
    normal: THREE.Vector3;
  }> = [];

  for (let i = 0; i < pillarCount; i++) {
    const t = (i + 0.5) / pillarCount;
    const sampleIdx = Math.round(t * samplesAlong);
    const clampedIdx = Math.min(sampleIdx, samplesAlong);

    const trackH = trackHeights[clampedIdx];
    const terrainH = naturalHeights[clampedIdx];
    const heightDiff = trackH - terrainH;

    if (heightDiff > HEIGHT_DIFF_THRESHOLD) {
      const trackPoint = segment.getPointAt(t);
      const tangent = segment.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const pillarHeight = heightDiff + 0.5;

      bridgePoints.push({
        point: trackPoint.clone(),
        trackH,
        normal: normal.clone(),
      });

      // Twin pillars (one on each side of track)
      for (const side of [-1, 1]) {
        const px = trackPoint.x + normal.x * side * 1.2;
        const pz = trackPoint.z + normal.z * side * 1.2;

        // Main pillar (tapered)
        const pillarGeo = new THREE.CylinderGeometry(0.4, 0.55, pillarHeight, 6);
        const pillar = new THREE.Mesh(pillarGeo, concreteMat);
        pillar.position.set(px, terrainH + pillarHeight / 2 - 0.25, pz);
        segment.terrainGroup.add(pillar);

        // Pillar footing
        const baseGeo = new THREE.BoxGeometry(1.4, 0.3, 1.4);
        const base = new THREE.Mesh(baseGeo, concreteMat);
        base.position.set(px, terrainH + 0.15, pz);
        segment.terrainGroup.add(base);
      }

      // Cross brace between twin pillars at ~60% height
      const braceH = terrainH + pillarHeight * 0.6;
      const braceGeo = new THREE.BoxGeometry(0.15, 0.15, 2.4);
      const brace = new THREE.Mesh(braceGeo, steelMat);
      brace.position.set(trackPoint.x, braceH, trackPoint.z);
      brace.lookAt(
        trackPoint.x + normal.x,
        braceH,
        trackPoint.z + normal.z,
      );
      segment.terrainGroup.add(brace);

      // Cap/deck beam spanning both pillars
      const capGeo = new THREE.BoxGeometry(3.5, 0.4, 1.5);
      const cap = new THREE.Mesh(capGeo, concreteMat);
      cap.position.set(trackPoint.x, trackH - 0.35, trackPoint.z);
      cap.lookAt(
        trackPoint.x + tangent.x,
        trackH - 0.35,
        trackPoint.z + tangent.z,
      );
      segment.terrainGroup.add(cap);
    }
  }

  // Continuous bridge deck slabs spanning contiguous bridge runs.
  // Detect runs by re-scanning along the segment at higher density than pillarCount,
  // so each contiguous "above terrain" stretch gets one strip mesh.
  addBridgeDecks(segment, trackHeights, naturalHeights, samplesAlong, concreteMat);

  // Guardrails connecting adjacent bridge pillars
  if (bridgePoints.length >= 2) {
    for (let i = 0; i < bridgePoints.length - 1; i++) {
      const a = bridgePoints[i];
      const b = bridgePoints[i + 1];

      for (const side of [-1, 1]) {
        const ax = a.point.x + a.normal.x * side * 1.8;
        const az = a.point.z + a.normal.z * side * 1.8;
        const bx = b.point.x + b.normal.x * side * 1.8;
        const bz = b.point.z + b.normal.z * side * 1.8;

        const midX = (ax + bx) / 2;
        const midZ = (az + bz) / 2;
        const midH = (a.trackH + b.trackH) / 2;
        const railLen = Math.sqrt((bx - ax) ** 2 + (bz - az) ** 2);

        // Top rail
        const topRailGeo = new THREE.CylinderGeometry(0.04, 0.04, railLen, 4);
        const topRail = new THREE.Mesh(topRailGeo, railMat);
        topRail.position.set(midX, midH + 0.5, midZ);
        topRail.lookAt(bx, midH + 0.5, bz);
        topRail.rotateX(Math.PI / 2);
        segment.terrainGroup.add(topRail);

        // Vertical posts along the rail
        const postCount = Math.max(2, Math.floor(railLen / 3));
        for (let p = 0; p <= postCount; p++) {
          const frac = p / postCount;
          const postX = ax + (bx - ax) * frac;
          const postZ = az + (bz - az) * frac;
          const postH = a.trackH + (b.trackH - a.trackH) * frac;

          const post = new THREE.Mesh(
            new THREE.CylinderGeometry(0.03, 0.03, 0.6, 4),
            railMat,
          );
          post.position.set(postX, postH + 0.2, postZ);
          segment.terrainGroup.add(post);
        }
      }
    }
  }
}

/**
 * Build continuous bridge deck slabs: for each contiguous along-segment run where
 * the track is on a bridge (trackH - terrainH > HEIGHT_DIFF_THRESHOLD), emit one
 * curved strip mesh that follows the track curve. This visually supports the roadbed
 * and fills the gaps between the discrete cap beams.
 */
function addBridgeDecks(
  segment: TrackSegment,
  trackHeights: number[],
  naturalHeights: number[],
  samplesAlong: number,
  concreteMat: THREE.Material,
): void {
  // Re-sample bridge state at the same resolution as the height arrays.
  const isBridge: boolean[] = [];
  for (let i = 0; i <= samplesAlong; i++) {
    isBridge.push((trackHeights[i] - naturalHeights[i]) > HEIGHT_DIFF_THRESHOLD);
  }

  // Find contiguous runs.
  const runs: Array<{ startT: number; endT: number }> = [];
  let runStart = -1;
  for (let i = 0; i <= samplesAlong; i++) {
    if (isBridge[i] && runStart < 0) {
      runStart = i;
    } else if (!isBridge[i] && runStart >= 0) {
      runs.push({ startT: runStart / samplesAlong, endT: (i - 1) / samplesAlong });
      runStart = -1;
    }
  }
  if (runStart >= 0) {
    runs.push({ startT: runStart / samplesAlong, endT: 1 });
  }

  // Deck dimensions — slightly wider than the cap beam so it's clearly visible from the side,
  // sits just below the roadbed bottom, thicker so the supporting plane reads at a distance.
  const DECK_HALF_WIDTH = 2.5;           // 5m total, matches roadbed top width
  const DECK_THICKNESS = 0.8;
  const DECK_TOP_OFFSET = -0.8;          // deck top sits flush with new roadbed bottom
  const DECK_BOTTOM_OFFSET = DECK_TOP_OFFSET - DECK_THICKNESS;

  for (const run of runs) {
    const runLength = (run.endT - run.startT) * segment.arcLength;
    if (runLength < 1) continue; // ignore degenerate single-sample runs

    // Sample the curve densely along the run for a smooth strip.
    const steps = Math.max(4, Math.round(runLength / 2));
    const csLen = 4; // 4 cross-section verts: BL, TL, TR, BR
    const vertexCount = (steps + 1) * csLen;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);

    for (let i = 0; i <= steps; i++) {
      const tLocal = i / steps;
      const t = run.startT + tLocal * (run.endT - run.startT);
      const pos = segment.getPointAt(t);
      const tangent = segment.getTangentAt(t);
      const lateral = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      const topY = pos.y + DECK_TOP_OFFSET;
      const botY = pos.y + DECK_BOTTOM_OFFSET;

      const base = i * csLen * 3;

      // 0: bottom-left
      positions[base + 0] = pos.x + lateral.x * -DECK_HALF_WIDTH;
      positions[base + 1] = botY;
      positions[base + 2] = pos.z + lateral.z * -DECK_HALF_WIDTH;
      // 1: top-left
      positions[base + 3] = pos.x + lateral.x * -DECK_HALF_WIDTH;
      positions[base + 4] = topY;
      positions[base + 5] = pos.z + lateral.z * -DECK_HALF_WIDTH;
      // 2: top-right
      positions[base + 6] = pos.x + lateral.x * DECK_HALF_WIDTH;
      positions[base + 7] = topY;
      positions[base + 8] = pos.z + lateral.z * DECK_HALF_WIDTH;
      // 3: bottom-right
      positions[base + 9]  = pos.x + lateral.x * DECK_HALF_WIDTH;
      positions[base + 10] = botY;
      positions[base + 11] = pos.z + lateral.z * DECK_HALF_WIDTH;

      // Normals: left-out, up, up, right-out
      normals[base + 0] = -lateral.x;
      normals[base + 1] = 0;
      normals[base + 2] = -lateral.z;
      normals[base + 3] = 0;
      normals[base + 4] = 1;
      normals[base + 5] = 0;
      normals[base + 6] = 0;
      normals[base + 7] = 1;
      normals[base + 8] = 0;
      normals[base + 9]  = lateral.x;
      normals[base + 10] = 0;
      normals[base + 11] = lateral.z;
    }

    // Index buffer: left side, top, right side (skip bottom — never visible).
    // Winding chosen so each face's outward normal points away from the deck:
    //   left side → -lateral, top → +Y, right side → +lateral.
    const indices: number[] = [];
    for (let i = 0; i < steps; i++) {
      const curr = i * csLen;
      const next = (i + 1) * csLen;
      // Left side (0-1): outward normal = -lateral
      indices.push(curr + 0, next + 1, next + 0);
      indices.push(curr + 0, curr + 1, next + 1);
      // Top (1-2): outward normal = +Y
      indices.push(curr + 1, next + 2, next + 1);
      indices.push(curr + 1, curr + 2, next + 2);
      // Right side (2-3): outward normal = +lateral
      indices.push(curr + 2, next + 3, next + 2);
      indices.push(curr + 2, curr + 3, next + 3);
    }

    // End caps (front + back) so the slab doesn't look hollow at run boundaries.
    const lastBase = steps * csLen;
    // Start cap (i=0): bottom-left, top-left, top-right, bottom-right (0,1,2,3)
    indices.push(0, 2, 1);
    indices.push(0, 3, 2);
    // End cap (i=steps): reverse winding
    indices.push(lastBase + 0, lastBase + 1, lastBase + 2);
    indices.push(lastBase + 0, lastBase + 2, lastBase + 3);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(indices);

    const deck = new THREE.Mesh(geo, concreteMat);
    segment.terrainGroup.add(deck);
  }
}

/**
 * Detect continuous tunnel regions where terrain is above track by >5m
 * for at least TUNNEL_MIN_LENGTH meters continuously.
 * Returns array of {startT, endT} ranges in [0,1] parameter space.
 */
function detectTunnelRegions(
  segment: TrackSegment,
  trackHeights: number[],
  naturalHeights: number[],
  samplesAlong: number,
): Array<{ startT: number; endT: number }> {
  const regions: Array<{ startT: number; endT: number }> = [];
  let regionStart = -1;

  for (let i = 0; i <= samplesAlong; i++) {
    const heightDiff = trackHeights[i] - naturalHeights[i];
    const isBelowTerrain = heightDiff < -HEIGHT_DIFF_THRESHOLD;

    if (isBelowTerrain && regionStart < 0) {
      regionStart = i;
    } else if (!isBelowTerrain && regionStart >= 0) {
      // Region ended — check if it's long enough
      const startT = regionStart / samplesAlong;
      const endT = i / samplesAlong;
      const regionLength = (endT - startT) * segment.arcLength;
      if (regionLength >= TUNNEL_MIN_LENGTH) {
        // Extend tunnel beyond mountain surface on each end for realism
        const extT = TUNNEL_EXTENSION / segment.arcLength;
        const extStartT = Math.max(0, startT - extT);
        const extEndT = Math.min(1, endT + extT);
        regions.push({ startT: extStartT, endT: extEndT });
      }
      regionStart = -1;
    }
  }
  // Handle region that extends to segment end
  if (regionStart >= 0) {
    const startT = regionStart / samplesAlong;
    const endT = 1;
    const regionLength = (endT - startT) * segment.arcLength;
    if (regionLength >= TUNNEL_MIN_LENGTH) {
      const extT = TUNNEL_EXTENSION / segment.arcLength;
      const extStartT = Math.max(0, startT - extT);
      // Don't extend past segment end — tunnel continues into next segment
      regions.push({ startT: extStartT, endT });
    }
  }

  return regions;
}

/**
 * Build tunnel tube geometry with portal entrances for detected tunnel regions.
 * The tube center line follows the track curve. Portals are stone archways
 * at each exposed tunnel end.
 */
function addTunnels(
  segment: TrackSegment,
  tunnelRegions: Array<{ startT: number; endT: number }>,
): void {
  // Tube radius 5, floor sits 0.8m below center → max chord half-width
  // = sqrt(5² − 0.8²) ≈ 4.94m. 4.5 gives a comfortable margin from the tube wall.
  const FLOOR_HALF_WIDTH = 4.5;
  const FLOOR_Y_OFFSET = -0.8;

  const tunnelMat = new THREE.MeshStandardMaterial({
    color: 0x555550,
    roughness: 0.85,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x4a4642,
    roughness: 0.85,
    metalness: 0.05,
  });

  for (const region of tunnelRegions) {
    // Sample points along the track curve for this tunnel region
    const tubePoints: THREE.Vector3[] = [];
    const steps = Math.max(8, Math.round((region.endT - region.startT) * 40));
    for (let i = 0; i <= steps; i++) {
      const t = region.startT + (i / steps) * (region.endT - region.startT);
      tubePoints.push(segment.getPointAt(t));
    }

    const tunnelCurve = new THREE.CatmullRomCurve3(tubePoints, false);
    const tubeGeo = new THREE.TubeGeometry(tunnelCurve, steps, TUNNEL_RADIUS, 12, false);
    const tubeMesh = new THREE.Mesh(tubeGeo, tunnelMat);
    segment.terrainGroup.add(tubeMesh);

    // Tunnel floor strip — a horizontal band flush with the roadbed bottom so
    // the tube doesn't look like a hollow drainpipe from inside the train.
    const regionArc = (region.endT - region.startT) * segment.arcLength;
    const floorSteps = Math.max(8, Math.round(regionArc / 2));
    const floorVertCount = (floorSteps + 1) * 2;
    const floorPositions = new Float32Array(floorVertCount * 3);

    for (let i = 0; i <= floorSteps; i++) {
      const t = region.startT + (i / floorSteps) * (region.endT - region.startT);
      const pos = segment.getPointAt(t);
      const tangent = segment.getTangentAt(t);
      const lateral = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      const y = pos.y + FLOOR_Y_OFFSET;

      const base = i * 2 * 3;
      // left vertex
      floorPositions[base + 0] = pos.x + lateral.x * -FLOOR_HALF_WIDTH;
      floorPositions[base + 1] = y;
      floorPositions[base + 2] = pos.z + lateral.z * -FLOOR_HALF_WIDTH;
      // right vertex
      floorPositions[base + 3] = pos.x + lateral.x * FLOOR_HALF_WIDTH;
      floorPositions[base + 4] = y;
      floorPositions[base + 5] = pos.z + lateral.z * FLOOR_HALF_WIDTH;
    }

    // Triangulate so face normals point +Y (single-sided, top-only).
    // For tangent=+X: lateral=+Z, left vertex at -Z, right at +Z.
    // Triangle (curr_left, curr_right, next_right): edges (+2Z, -X+Z) → cross = (0,+,0). ✓
    const floorIndices: number[] = [];
    for (let i = 1; i <= floorSteps; i++) {
      const base = (i - 1) * 2;
      floorIndices.push(base, base + 1, base + 3);
      floorIndices.push(base, base + 3, base + 2);
    }

    const floorGeo = new THREE.BufferGeometry();
    floorGeo.setAttribute('position', new THREE.BufferAttribute(floorPositions, 3));
    floorGeo.setIndex(floorIndices);
    floorGeo.computeVertexNormals();

    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    segment.terrainGroup.add(floorMesh);
  }
}

/**
 * Check if a given t value falls within any tunnel region.
 */
function isInTunnel(
  t: number,
  tunnelRegions: Array<{ startT: number; endT: number }>,
): boolean {
  for (const region of tunnelRegions) {
    if (t >= region.startT && t <= region.endT) return true;
  }
  return false;
}

function biomeHasWater(startDist: number, length: number): boolean {
  // Check if any part of the segment is in a lake biome
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const d = startDist + (i / steps) * length;
    if (getBiomeAtDistance(d) === 'lake') return true;
  }
  return false;
}
