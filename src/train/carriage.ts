import * as THREE from 'three';

export interface CarriageResult {
  group: THREE.Group;
  wheels: THREE.Object3D[];
}

export function createCarriage(color: number, offset: number): CarriageResult {
  const group = new THREE.Group();
  const wheels: THREE.Object3D[] = [];

  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.4 });
  const trimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.7).getHex(),
    metalness: 0.3,
    roughness: 0.5,
  });

  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 3.5), bodyMat);
  body.position.set(0, 1.2, 0);
  group.add(body);

  // Color stripe along the bottom of the body
  const stripeMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.6).getHex(),
    metalness: 0.3,
    roughness: 0.5,
  });
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 3.5), stripeMat);
    stripe.position.set(side * 0.76, 0.66, 0);
    group.add(stripe);

    // Upper trim line
    const upperTrim = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 3.5), trimMat);
    upperTrim.position.set(side * 0.76, 1.58, 0);
    group.add(upperTrim);
  }

  // Roof (rounded using half-cylinder for more realistic shape)
  const roofShape = new THREE.CylinderGeometry(0.85, 0.85, 3.6, 12, 1, false, 0, Math.PI);
  const roof = new THREE.Mesh(roofShape, darkMat);
  roof.rotation.z = Math.PI; // dome faces up
  roof.rotation.y = Math.PI / 2;
  roof.position.set(0, 1.8, 0);
  roof.scale.set(1, 0.12, 1);
  group.add(roof);

  // Roof flat top
  const roofTop = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.04, 3.6), darkMat);
  roofTop.position.set(0, 1.87, 0);
  group.add(roofTop);

  // Roof ventilator (small raised box)
  const ventilator = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.5), darkMat);
  ventilator.position.set(0, 1.92, 0);
  group.add(ventilator);

  // End walls (visible bulkheads at each end)
  const endWallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.85).getHex(),
    metalness: 0.2,
    roughness: 0.6,
  });
  for (const ez of [1.76, -1.76]) {
    const endWall = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 0.04), endWallMat);
    endWall.position.set(0, 1.2, ez);
    group.add(endWall);

    // End door
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.9, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x5c3a1e }),
    );
    door.position.set(0, 1.1, ez + Math.sign(ez) * 0.01);
    group.add(door);

    // Door handle
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.08, 4),
      new THREE.MeshStandardMaterial({ color: 0xcc9933, metalness: 0.6, roughness: 0.3 }),
    );
    handle.position.set(0.15, 1.15, ez + Math.sign(ez) * 0.03);
    handle.rotation.x = Math.PI / 2;
    group.add(handle);
  }

  // Frame
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.2, 3.6), darkMat);
  frame.position.set(0, 0.55, 0);
  group.add(frame);

  // Windows (4 per side, with frames)
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0xaaddff,
    emissive: 0x223344,
    emissiveIntensity: 0.2,
    transparent: true,
    opacity: 0.35,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color).multiplyScalar(0.5).getHex(),
    metalness: 0.3,
    roughness: 0.5,
  });
  const windowPositions = [-1.2, -0.4, 0.4, 1.2];
  for (const wz of windowPositions) {
    for (const side of [-1, 1]) {
      // Window glass
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.4, 0.45), windowMat);
      win.position.set(side * 0.76, 1.3, wz);
      group.add(win);

      // Window frame (thin border around window)
      const frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.48), frameMat);
      frameTop.position.set(side * 0.76, 1.52, wz);
      group.add(frameTop);

      const frameBot = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.03, 0.48), frameMat);
      frameBot.position.set(side * 0.76, 1.08, wz);
      group.add(frameBot);
    }
  }

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.1, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.3 });
  const positions: [number, number, number][] = [
    [-0.7, 0.35, 1.2], [0.7, 0.35, 1.2],
    [-0.7, 0.35, -1.2], [0.7, 0.35, -1.2],
  ];
  for (const [x, y, z] of positions) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.position.set(x, y, z);
    wheel.rotation.z = Math.PI / 2;
    group.add(wheel);
    wheels.push(wheel);
  }

  // Wheel bogies (more detailed with side frames)
  const bogieMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.5, roughness: 0.4 });
  for (const bz of [1.2, -1.2]) {
    // Bogie cross beam
    const bogie = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.12, 0.4), bogieMat);
    bogie.position.set(0, 0.38, bz);
    group.add(bogie);

    // Leaf springs (thin boxes above each bogie)
    for (const side of [-1, 1]) {
      const spring = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.06, 0.35), bogieMat);
      spring.position.set(side * 0.5, 0.48, bz);
      group.add(spring);
    }
  }

  // Buffers at each end
  const bufferMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6, roughness: 0.3 });
  for (const cz of [1.8, -1.8]) {
    // Buffer beam
    const bufferBeam = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.06), bufferMat);
    bufferBeam.position.set(0, 0.55, cz);
    group.add(bufferBeam);

    // Buffer pads
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 6), bufferMat);
      pad.rotation.x = Math.PI / 2;
      pad.position.set(side * 0.5, 0.55, cz + Math.sign(cz) * 0.06);
      group.add(pad);
    }

    // Coupling hook
    const coupling = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.25, 6), bufferMat);
    coupling.rotation.x = Math.PI / 2;
    coupling.position.set(0, 0.55, cz);
    group.add(coupling);
  }

  // Steps at each end (small platforms)
  for (const ez of [1.78, -1.78]) {
    for (const side of [-1, 1]) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.03, 0.15), darkMat);
      step.position.set(side * 0.6, 0.4, ez);
      group.add(step);
    }
  }

  // Interior light
  const interiorLight = new THREE.PointLight(0xffdd88, 2, 15, 1);
  interiorLight.position.set(0, 1.4, 0);
  group.add(interiorLight);

  group.userData.offset = offset;

  return { group, wheels };
}
