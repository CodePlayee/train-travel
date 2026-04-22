import * as THREE from 'three';

/** Create a wheel with spokes (hub + rim + spoke bars).
 *  Built with axle along X, disc in YZ plane (vertical). */
export function createSpokedWheel(radius: number, width: number, wheelMat: THREE.Material, brassyMat: THREE.Material): THREE.Group {
  const wheelGroup = new THREE.Group();

  // Outer rim (torus) — default disc in XY plane (axle Z), rotate to YZ plane (axle X)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.04, 6, 16), wheelMat);
  rim.rotation.y = Math.PI / 2;
  wheelGroup.add(rim);

  // Hub (cylinder along X = axle)
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, width + 0.02, 8), brassyMat);
  hub.rotation.z = Math.PI / 2;
  wheelGroup.add(hub);

  // Spokes (radiate in YZ plane)
  const spokeCount = 8;
  for (let s = 0; s < spokeCount; s++) {
    const angle = (s / spokeCount) * Math.PI * 2;
    const spoke = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, radius - 0.06, 4),
      wheelMat,
    );
    spoke.position.set(0, Math.cos(angle) * (radius / 2), Math.sin(angle) * (radius / 2));
    spoke.rotation.x = angle;
    wheelGroup.add(spoke);
  }

  return wheelGroup;
}
