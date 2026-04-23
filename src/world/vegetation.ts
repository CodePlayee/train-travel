import * as THREE from 'three';
import { getBiomeAtDistance, BIOME_HEIGHT } from './biome';
import { fbm } from '../utils/noise';
import { TrackSegment } from './trackSegment';

function seededRng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

function makePine(x: number, y: number, z: number, scale: number, rand: () => number): THREE.Group {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15 * scale, 0.2 * scale, 1.5 * scale, 6),
    new THREE.MeshStandardMaterial({ color: 0x5c3a1e }),
  );
  trunk.position.y = 0.75 * scale;
  tree.add(trunk);

  for (let layer = 0; layer < 3; layer++) {
    const s = (3 - layer) / 3;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.0 * s * scale, 1.2 * scale, 7),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(0.1 + rand() * 0.1, 0.35 + rand() * 0.15, 0.08),
      }),
    );
    cone.position.y = (1.5 + layer * 0.8) * scale;
    tree.add(cone);
  }
  tree.position.set(x, y, z);
  return tree;
}

function makeDeciduous(x: number, y: number, z: number, scale: number, rand: () => number): THREE.Group {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, 2 * scale, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4226 }),
  );
  trunk.position.y = 1 * scale;
  tree.add(trunk);

  const crown = new THREE.Mesh(
    new THREE.SphereGeometry(1.2 * scale, 8, 6),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.15 + rand() * 0.15, 0.45 + rand() * 0.2, 0.1),
    }),
  );
  crown.position.y = 2.5 * scale;
  tree.add(crown);

  tree.position.set(x, y, z);
  return tree;
}

function makeCactus(x: number, y: number, z: number): THREE.Group {
  const cactus = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2d7a3a });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 1.5, 6), mat);
  body.position.y = 0.75;
  cactus.add(body);

  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.6, 5), mat);
  arm1.position.set(0.25, 1.0, 0);
  arm1.rotation.z = -Math.PI / 4;
  cactus.add(arm1);

  const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.5, 5), mat);
  arm2.position.set(-0.2, 0.7, 0);
  arm2.rotation.z = Math.PI / 3;
  cactus.add(arm2);

  cactus.position.set(x, y, z);
  return cactus;
}

function makeRock(x: number, y: number, z: number, scale: number, rand: () => number): THREE.Group {
  const cluster = new THREE.Group();
  const baseColor = new THREE.Color(0.4 + rand() * 0.15, 0.38 + rand() * 0.1, 0.35);

  // Main rock
  const mainRock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.5 * scale, 1),
    new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.85, metalness: 0.05 }),
  );
  mainRock.rotation.set(rand() * Math.PI, rand() * Math.PI, 0);
  mainRock.scale.set(1, 0.6 + rand() * 0.4, 1 + rand() * 0.3);
  cluster.add(mainRock);

  // 1-2 smaller satellite rocks around the base
  const satelliteCount = rand() < 0.6 ? 1 : 2;
  for (let s = 0; s < satelliteCount; s++) {
    const angle = rand() * Math.PI * 2;
    const dist = 0.3 * scale + rand() * 0.3 * scale;
    const satScale = 0.3 + rand() * 0.3;
    const satRock = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.3 * scale * satScale, 0),
      new THREE.MeshStandardMaterial({
        color: baseColor.clone().offsetHSL(0, 0, (rand() - 0.5) * 0.1),
        roughness: 0.9,
        metalness: 0.05,
      }),
    );
    satRock.position.set(Math.cos(angle) * dist, -0.1 * scale, Math.sin(angle) * dist);
    satRock.rotation.set(rand() * Math.PI, rand() * Math.PI, 0);
    satRock.scale.set(1, 0.5 + rand() * 0.5, 1);
    cluster.add(satRock);
  }

  cluster.position.set(x, y + 0.2 * scale, z);
  return cluster;
}

function makeHouse(x: number, y: number, z: number, rand: () => number): THREE.Group {
  const house = new THREE.Group();

  const wallColor = new THREE.Color(0.85, 0.8 + rand() * 0.15, 0.7);
  const wallMat = new THREE.MeshStandardMaterial({ color: wallColor });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 2.5), wallMat);
  walls.position.y = 0.75;
  house.add(walls);

  // Roof with slight overhang
  const roofColor = rand() < 0.5 ? 0x8b3a3a : 0x6b4226;
  const roofMat = new THREE.MeshStandardMaterial({ color: roofColor });
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.8, 1, 4), roofMat);
  roof.position.y = 2.0;
  roof.rotation.y = Math.PI / 4;
  house.add(roof);

  // Chimney on roof
  const chimneyMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 });
  const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), chimneyMat);
  chimney.position.set(0.5, 2.3, -0.4);
  house.add(chimney);

  // Door
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e });
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.05), doorMat);
  door.position.set(0, 0.45, 1.26);
  house.add(door);

  // Door frame
  const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x3a2010 });
  const doorFrameTop = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.06), doorFrameMat);
  doorFrameTop.position.set(0, 0.92, 1.27);
  house.add(doorFrameTop);
  for (const side of [-1, 1]) {
    const doorFrameSide = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, 0.06), doorFrameMat);
    doorFrameSide.position.set(side * 0.28, 0.45, 1.27);
    house.add(doorFrameSide);
  }

  // Windows (2 on front, 1 on each side)
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0xaaddff,
    emissive: 0x334466,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.4,
  });
  const windowFrameMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee });

  // Front windows (flanking the door)
  for (const side of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.05), windowMat);
    win.position.set(side * 0.65, 0.9, 1.26);
    house.add(win);

    // Window frame cross
    const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.06), windowFrameMat);
    hBar.position.set(side * 0.65, 0.9, 1.27);
    house.add(hBar);
    const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.06), windowFrameMat);
    vBar.position.set(side * 0.65, 0.9, 1.27);
    house.add(vBar);
  }

  // Side windows
  for (const side of [-1, 1]) {
    const sideWin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.35, 0.35), windowMat);
    sideWin.position.set(side * 1.01, 0.9, 0);
    house.add(sideWin);
  }

  // Foundation/base
  const foundationMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.9 });
  const foundation = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 2.7), foundationMat);
  foundation.position.y = -0.01;
  house.add(foundation);

  house.position.set(x, y, z);
  house.rotation.y = rand() * Math.PI * 2;
  return house;
}

function makeSignal(x: number, y: number, z: number): THREE.Group {
  const sig = new THREE.Group();

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 3, 6),
    new THREE.MeshStandardMaterial({ color: 0x555555 }),
  );
  pole.position.y = 1.5;
  sig.add(pole);

  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 6, 6),
    new THREE.MeshStandardMaterial({ color: 0x22cc22, emissive: 0x22cc22, emissiveIntensity: 0.5 }),
  );
  light.position.y = 2.8;
  sig.add(light);

  sig.position.set(x, y, z);
  return sig;
}

/**
 * Generate vegetation for a single track segment.
 * Uses segment index as RNG seed for deterministic placement.
 */
export function createSegmentVegetation(
  segment: TrackSegment,
  cumulativeDistance: number,
): void {
  // Seed RNG with segment index for determinism
  const rand = seededRng(segment.index * 7919 + 42);
  const OBJECT_COUNT = 80; // objects per segment
  const HALF_WIDTH = 200;

  for (let i = 0; i < OBJECT_COUNT; i++) {
    const t = rand(); // position along segment
    const lateralFrac = (rand() * 2 - 1); // -1 to 1

    const trackPoint = segment.getPointAt(t);
    const tangent = segment.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    const lateralDist = lateralFrac * HALF_WIDTH;
    // Skip objects too close to track
    if (Math.abs(lateralDist) < 8) continue;

    const x = trackPoint.x + normal.x * lateralDist;
    const z = trackPoint.z + normal.z * lateralDist;

    const distAlongTrack = cumulativeDistance + t * segment.arcLength;
    const biome = getBiomeAtDistance(distAlongTrack);
    const bh = BIOME_HEIGHT[biome];

    const h = fbm(x * 0.008, z * 0.008) * bh.scale + bh.base;

    if (biome === 'lake' && h < 0) continue;

    switch (biome) {
      case 'forest':
        if (rand() < 0.7) segment.vegetationGroup.add(makePine(x, h, z, 0.8 + rand() * 0.8, rand));
        else segment.vegetationGroup.add(makeDeciduous(x, h, z, 0.7 + rand() * 0.6, rand));
        break;
      case 'grassland':
        if (rand() < 0.35) segment.vegetationGroup.add(makeDeciduous(x, h, z, 0.8 + rand() * 0.5, rand));
        else if (rand() < 0.15) segment.vegetationGroup.add(makeRock(x, h, z, 0.5 + rand() * 0.5, rand));
        break;
      case 'mountains':
        if (rand() < 0.3 && h < 25) segment.vegetationGroup.add(makePine(x, h, z, 0.6 + rand() * 0.5, rand));
        else if (rand() < 0.4) segment.vegetationGroup.add(makeRock(x, h, z, 0.8 + rand() * 1.5, rand));
        break;
      case 'desert':
        if (rand() < 0.15) segment.vegetationGroup.add(makeCactus(x, h, z));
        else if (rand() < 0.1) segment.vegetationGroup.add(makeRock(x, h, z, 0.3 + rand() * 0.8, rand));
        break;
      case 'lake':
        if (rand() < 0.25) segment.vegetationGroup.add(makeDeciduous(x, h, z, 0.7 + rand() * 0.5, rand));
        break;
    }
  }

  // Houses and signals along track (1-2 per segment)
  const signalCount = 2;
  for (let i = 0; i < signalCount; i++) {
    const t = (i + 0.5) / signalCount;

    // Skip signals/houses that fall inside a tunnel — they'd be buried in the mountain.
    if (isInTunnel(t, segment.tunnelRegions)) continue;

    const p = segment.getPointAt(t);
    const tangent = segment.getTangentAt(t);
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    // House (occasionally)
    if (rand() < 0.3) {
      const side = rand() < 0.5 ? 1 : -1;
      const offset = normal.clone().multiplyScalar(side * (8 + rand() * 5));
      segment.vegetationGroup.add(makeHouse(p.x + offset.x, p.y, p.z + offset.z, rand));
    }

    // Signal
    const sigSide = ((i % 2) * 2 - 1);
    const sigOffset = normal.clone().multiplyScalar(sigSide * 3);
    segment.vegetationGroup.add(makeSignal(p.x + sigOffset.x, p.y, p.z + sigOffset.z));
  }
}

function isInTunnel(
  t: number,
  regions: Array<{ startT: number; endT: number }>,
): boolean {
  for (const r of regions) {
    if (t >= r.startT && t <= r.endT) return true;
  }
  return false;
}
