import * as THREE from 'three';
import { getBiomeAtDistance, getBiomeWeightsAtDistance, BIOME_COLORS, BIOME_HEIGHT } from './biome';
import { fbm, noise2D } from '../utils/noise';
import { TrackSegment } from './trackSegment';

// Terrain adaptation thresholds
const HEIGHT_DIFF_THRESHOLD = 5; // meters — beyond this, use bridge or tunnel
const DEFORM_RADIUS = 60; // lateral distance over which terrain deforms toward track
const TRACK_BED_HALF_WIDTH = 6; // half-width of flat track bed area
const EMBANKMENT_WIDTH = 12; // width of raised embankment zone around track
const BRIDGE_PILLAR_SPACING = 15; // world units between bridge pillars
const TUNNEL_MIN_LENGTH = 10; // minimum continuous length (meters) to qualify as tunnel
const TUNNEL_RADIUS = 5; // radius of tunnel tube
const TUNNEL_EXTENSION = 8; // meters to extend tunnel beyond mountain surface on each end

/**
 * Generate terrain strip around a single track segment.
 * The terrain is a rectangular strip aligned along the segment's path.
 * Adapts terrain to track: deformation, bridges, and tunnels.
 */
export function createSegmentTerrain(
  segment: TrackSegment,
  cumulativeDistance: number,
): void {
  const HALF_WIDTH = 100; // terrain extends this far on each side of track
  const SAMPLES_ALONG = 40; // samples along segment length
  const SAMPLES_ACROSS = 40; // samples across width

  const geo = new THREE.PlaneGeometry(
    1, 1, // placeholder, we'll set vertices manually
    SAMPLES_ALONG, SAMPLES_ACROSS,
  );

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  // Track data we collect per along-sample for bridge/tunnel decisions
  const trackHeights: number[] = [];
  const naturalHeightsAtTrack: number[] = [];

  // First pass: compute natural terrain heights at track center for each along-sample
  for (let i = 0; i <= SAMPLES_ALONG; i++) {
    const t = i / SAMPLES_ALONG;
    const trackPoint = segment.getPointAt(t);
    const distAlongTrack = cumulativeDistance + t * segment.arcLength;
    const weights = getBiomeWeightsAtDistance(distAlongTrack);

    // Low-frequency fbm for smooth, broad terrain features
    const largeFbm = fbm(trackPoint.x * 0.004, trackPoint.z * 0.004, 3);
    // Mild detail — just enough to avoid perfectly flat plains
    const detailNoise = noise2D(trackPoint.x * 0.015, trackPoint.z * 0.015) * 0.8;

    let h = 0;
    for (const w of weights) {
      const bh = BIOME_HEIGHT[w.biome];
      const biomeH = largeFbm * bh.scale + bh.base + detailNoise;
      h += biomeH * w.weight;
    }

    trackHeights.push(trackPoint.y);
    naturalHeightsAtTrack.push(h);
  }

  // Detect tunnel regions (continuous 10m+ of terrain above track by >5m)
  const tunnelRegions = detectTunnelRegions(segment, trackHeights, naturalHeightsAtTrack, SAMPLES_ALONG);

  for (let j = 0; j <= SAMPLES_ACROSS; j++) {
    for (let i = 0; i <= SAMPLES_ALONG; i++) {
      const vertIdx = j * (SAMPLES_ALONG + 1) + i;
      const t = i / SAMPLES_ALONG;
      const lateralFrac = (j / SAMPLES_ACROSS) * 2 - 1; // -1 to 1

      // Get track position and direction at this t
      const trackPoint = segment.getPointAt(t);
      const tangent = segment.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      // World position of this vertex
      const wx = trackPoint.x + normal.x * lateralFrac * HALF_WIDTH;
      const wz = trackPoint.z + normal.z * lateralFrac * HALF_WIDTH;

      // Distance along track for biome lookup
      const distAlongTrack = cumulativeDistance + t * segment.arcLength;
      const weights = getBiomeWeightsAtDistance(distAlongTrack);

      // Height calculation — smooth, broad terrain features
      const largeFbm = fbm(wx * 0.004, wz * 0.004, 3);
      // Mild detail noise for subtle variation
      const detailNoise = noise2D(wx * 0.015, wz * 0.015) * 0.8
        + noise2D(wx * 0.04, wz * 0.04) * 0.3;

      let h = 0;
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

        h += biomeH * w.weight;
        col.r += biomeCol.r * w.weight;
        col.g += biomeCol.g * w.weight;
        col.b += biomeCol.b * w.weight;
      }

      const naturalH = h;
      const lateralDist = Math.abs(lateralFrac) * HALF_WIDTH;
      const trackH = trackHeights[i];
      const heightDiff = trackH - naturalH; // positive = track above terrain

      const inTunnelZone = isInTunnel(t, tunnelRegions);

      // Subtle noise to break up perfectly smooth deformation edges
      const edgeNoise = noise2D(wx * 0.08, wz * 0.08) * 0.4;

      if (inTunnelZone) {
        // Tunnel zone: terrain stays at natural height (the tube covers the track)
        // No terrain carving needed — the TubeGeometry forms the tunnel shell
      } else if (Math.abs(heightDiff) < HEIGHT_DIFF_THRESHOLD) {
        // Case 1: Small height difference — deform terrain toward track
        // Use embankment shape: flat track bed, then gentle slope, then smooth blend to natural
        const trackBedH = trackH - 1.0;
        if (lateralDist < TRACK_BED_HALF_WIDTH) {
          // Flat track bed
          h = trackBedH;
        } else if (lateralDist < EMBANKMENT_WIDTH) {
          // Embankment slope: raised area that slopes down from track bed
          const embankT = (lateralDist - TRACK_BED_HALF_WIDTH) / (EMBANKMENT_WIDTH - TRACK_BED_HALF_WIDTH);
          // Quintic smoothstep for smoother transition (C2 continuous)
          const smooth = embankT * embankT * embankT * (embankT * (embankT * 6 - 15) + 10);
          const embankTarget = THREE.MathUtils.lerp(trackBedH, naturalH, 0.3);
          h = THREE.MathUtils.lerp(trackBedH, embankTarget + edgeNoise, smooth);
        } else if (lateralDist < DEFORM_RADIUS) {
          // Gradual blend from embankment edge to natural terrain
          const blendT = (lateralDist - EMBANKMENT_WIDTH) / (DEFORM_RADIUS - EMBANKMENT_WIDTH);
          // Quintic smoothstep
          const smooth = blendT * blendT * blendT * (blendT * (blendT * 6 - 15) + 10);
          const embankEdgeH = THREE.MathUtils.lerp(trackBedH, naturalH, 0.3) + edgeNoise;
          h = THREE.MathUtils.lerp(embankEdgeH, naturalH, smooth);
        }
        // Color: darken near track to suggest gravel/earth
        if (lateralDist < EMBANKMENT_WIDTH) {
          const darkT = 1 - lateralDist / EMBANKMENT_WIDTH;
          col.r = THREE.MathUtils.lerp(col.r, 0.35, darkT * 0.3);
          col.g = THREE.MathUtils.lerp(col.g, 0.30, darkT * 0.3);
          col.b = THREE.MathUtils.lerp(col.b, 0.25, darkT * 0.3);
        }
      } else if (heightDiff > HEIGHT_DIFF_THRESHOLD) {
        // Case 2: Track much higher than terrain — bridge area
        // Don't carve terrain, just leave it natural under the bridge
        if (lateralDist < TRACK_BED_HALF_WIDTH) {
          h = Math.min(naturalH, trackH - HEIGHT_DIFF_THRESHOLD);
        }
      }
      // Case 3 (tunnel) is handled by inTunnelZone above — terrain stays natural

      // Water areas in lake biome: smooth shoreline
      const biome = getBiomeAtDistance(distAlongTrack);
      if (biome === 'lake' && lateralDist > 15 && h < 1.0) {
        // Smooth transition into water — no abrupt cut
        const waterBlend = Math.max(0, Math.min(1, (1.0 - h) / 2.0));
        h = THREE.MathUtils.lerp(h, Math.min(h, -1.5), waterBlend);
        // Tint terrain near water edge
        if (h < 0.5 && h > -1.0) {
          col.r = THREE.MathUtils.lerp(col.r, 0.18, 0.3);
          col.g = THREE.MathUtils.lerp(col.g, 0.40, 0.3);
          col.b = THREE.MathUtils.lerp(col.b, 0.22, 0.3);
        }
      }

      pos.setXYZ(vertIdx, wx, h, wz);

      colors[vertIdx * 3] = col.r;
      colors[vertIdx * 3 + 1] = col.g;
      colors[vertIdx * 3 + 2] = col.b;
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.0,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  segment.terrainGroup.add(mesh);

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
 * Add water surface with gentle wave displacement for lake biomes.
 * Uses two layers: a darker deep layer and a lighter rippled surface.
 */
function addWaterSurface(segment: TrackSegment): void {
  const HALF_WIDTH_VAL = 100;
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
  const tunnelMat = new THREE.MeshStandardMaterial({
    color: 0x555550,
    roughness: 0.85,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const portalMat = new THREE.MeshStandardMaterial({
    color: 0x665544,
    roughness: 0.9,
    metalness: 0.05,
  });
  const keystoneMat = new THREE.MeshStandardMaterial({
    color: 0x887766,
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

    // Add portal arches at each end of the tunnel
    const portalEnds: Array<{ t: number; sign: number }> = [];
    if (region.startT > 0.01) portalEnds.push({ t: region.startT, sign: 1 });
    if (region.endT < 0.99) portalEnds.push({ t: region.endT, sign: -1 });

    for (const portal of portalEnds) {
      const portalPoint = segment.getPointAt(portal.t);
      const tangent = segment.getTangentAt(portal.t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      // Portal arch (torus segment forming archway)
      const archRadius = TUNNEL_RADIUS + 0.5;
      const archGeo = new THREE.TorusGeometry(archRadius, 0.6, 6, 12, Math.PI);
      const arch = new THREE.Mesh(archGeo, portalMat);
      arch.position.set(portalPoint.x, portalPoint.y, portalPoint.z);

      // Orient arch to face outward along track
      const lookTarget = new THREE.Vector3(
        portalPoint.x + tangent.x * portal.sign,
        portalPoint.y,
        portalPoint.z + tangent.z * portal.sign,
      );
      arch.lookAt(lookTarget);
      arch.rotateX(Math.PI / 2);
      segment.terrainGroup.add(arch);

      // Portal side pillars (stone columns flanking the entrance)
      for (const side of [-1, 1]) {
        const pillarX = portalPoint.x + normal.x * side * (TUNNEL_RADIUS - 0.5);
        const pillarZ = portalPoint.z + normal.z * side * (TUNNEL_RADIUS - 0.5);
        const pillarGeo = new THREE.BoxGeometry(0.8, TUNNEL_RADIUS * 1.5, 0.8);
        const pillar = new THREE.Mesh(pillarGeo, portalMat);
        pillar.position.set(
          pillarX,
          portalPoint.y - TUNNEL_RADIUS * 0.25,
          pillarZ,
        );
        segment.terrainGroup.add(pillar);
      }

      // Keystone at top of arch
      const keystone = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.8, 0.8),
        keystoneMat,
      );
      keystone.position.set(
        portalPoint.x,
        portalPoint.y + archRadius - 0.3,
        portalPoint.z,
      );
      segment.terrainGroup.add(keystone);
    }
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
