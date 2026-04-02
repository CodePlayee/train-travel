import * as THREE from 'three';
import { getBiome } from './biome';

export function createTrack(scene: THREE.Scene): THREE.CatmullRomCurve3 {
  const R = 300;
  const points = [
    new THREE.Vector3(0, 0, -R),
    new THREE.Vector3(R * 0.7, 0, -R * 0.7),
    new THREE.Vector3(R, 0, 0),
    new THREE.Vector3(R * 0.8, 0, R * 0.5),
    new THREE.Vector3(R * 0.3, 0, R),
    new THREE.Vector3(-R * 0.3, 0, R * 0.8),
    new THREE.Vector3(-R * 0.7, 0, R * 0.4),
    new THREE.Vector3(-R, 0, 0),
    new THREE.Vector3(-R * 0.8, 0, -R * 0.5),
    new THREE.Vector3(-R * 0.4, 0, -R * 0.9),
  ];

  points.forEach((p, i) => {
    const t = i / points.length;
    const biome = getBiome(t);
    if (biome === 'mountains') p.y = 8;
    else if (biome === 'desert') p.y = 1;
    else p.y = 2;
  });

  const curve = new THREE.CatmullRomCurve3(points, true, 'catmullrom', 0.5);
  const trackGroup = new THREE.Group();

  const SEGMENTS = 1000;
  const RAIL_GAUGE = 1.2;

  // Rails
  for (let side = -1; side <= 1; side += 2) {
    const railPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const pos = curve.getPointAt(t);
      const tangent = curve.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      railPoints.push(pos.clone().add(normal.multiplyScalar(side * RAIL_GAUGE / 2)));
    }
    const railCurve = new THREE.CatmullRomCurve3(railPoints, false);
    const railGeo = new THREE.TubeGeometry(railCurve, SEGMENTS, 0.06, 4, false);
    const railMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6, roughness: 0.4 });
    trackGroup.add(new THREE.Mesh(railGeo, railMat));
  }

  // Ballast bed beneath the track
  const ballastWidth = RAIL_GAUGE + 1.4;
  const ballastShape = new THREE.Shape();
  const bw = ballastWidth / 2;
  const bh = 0.25;
  // Trapezoidal cross-section: wider at base, narrower at top
  ballastShape.moveTo(-bw, 0);
  ballastShape.lineTo(-bw * 0.7, bh);
  ballastShape.lineTo(bw * 0.7, bh);
  ballastShape.lineTo(bw, 0);
  ballastShape.closePath();

  const ballastPath: THREE.Vector3[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const t = i / SEGMENTS;
    const pos = curve.getPointAt(t);
    ballastPath.push(pos.clone());
  }
  const ballastCurve = new THREE.CatmullRomCurve3(ballastPath, false);
  const ballastGeo = new THREE.ExtrudeGeometry(ballastShape, {
    steps: SEGMENTS,
    extrudePath: ballastCurve,
  });
  const ballastMat = new THREE.MeshStandardMaterial({
    color: 0x887766,
    roughness: 0.95,
    metalness: 0.0,
  });
  const ballast = new THREE.Mesh(ballastGeo, ballastMat);
  ballast.position.y = -0.3;
  trackGroup.add(ballast);

  // Sleepers
  const sleeperGeo = new THREE.BoxGeometry(RAIL_GAUGE + 0.6, 0.08, 0.2);
  const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x4a3728 });
  const SLEEPER_COUNT = 500;
  for (let i = 0; i < SLEEPER_COUNT; i++) {
    const t = i / SLEEPER_COUNT;
    const pos = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t);
    const sleeper = new THREE.Mesh(sleeperGeo, sleeperMat);
    sleeper.position.copy(pos);
    sleeper.position.y -= 0.04;
    sleeper.lookAt(pos.clone().add(tangent));
    trackGroup.add(sleeper);
  }

  scene.add(trackGroup);
  return curve;
}
