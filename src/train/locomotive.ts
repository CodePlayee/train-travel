import * as THREE from 'three';

export interface LocomotiveResult {
  group: THREE.Group;
  wheels: THREE.Object3D[];
  chimneyWorldPos: THREE.Vector3;
}

/** Create a wheel with spokes (hub + rim + spoke bars). */
function createSpokedWheel(radius: number, width: number, wheelMat: THREE.Material, brassyMat: THREE.Material): THREE.Group {
  const wheelGroup = new THREE.Group();

  // Outer rim (torus)
  const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.04, 6, 16), wheelMat);
  rim.rotation.y = Math.PI / 2;
  wheelGroup.add(rim);

  // Hub
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, width + 0.02, 8), brassyMat);
  hub.rotation.z = Math.PI / 2;
  wheelGroup.add(hub);

  // Spokes
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

export function createLocomotive(): LocomotiveResult {
  const group = new THREE.Group();
  const wheels: THREE.Object3D[] = [];

  const metalMat = new THREE.MeshStandardMaterial({ color: 0xcc2222, metalness: 0.3, roughness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.4 });
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x882222, metalness: 0.2, roughness: 0.6 });
  const brassyMat = new THREE.MeshStandardMaterial({ color: 0xcc9933, metalness: 0.6, roughness: 0.3 });
  const coalMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.1, roughness: 0.9 });

  // Smokebox (darker front of boiler)
  const smokeboxMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.4, roughness: 0.5 });
  const smokebox = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.8, 12), smokeboxMat);
  smokebox.rotation.x = Math.PI / 2;
  smokebox.position.set(0, 1.2, 1.5);
  group.add(smokebox);

  // Smokebox door (flat disc on front)
  const smokeboxDoor = new THREE.Mesh(
    new THREE.CircleGeometry(0.65, 12),
    new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.4 }),
  );
  smokeboxDoor.position.set(0, 1.2, 1.91);
  group.add(smokeboxDoor);

  // Smokebox door handle (small brass ring)
  const doorHandle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 12), brassyMat);
  doorHandle.position.set(0, 1.2, 1.93);
  group.add(doorHandle);

  // Boiler (cylinder along Z axis = travel direction)
  const boiler = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 3, 12), metalMat);
  boiler.rotation.x = Math.PI / 2;
  boiler.position.set(0, 1.2, 0.3);
  group.add(boiler);

  // Boiler bands (brass rings around the boiler)
  for (const bz of [-0.4, 0.4, 1.0]) {
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.025, 6, 16), brassyMat);
    band.position.set(0, 1.2, bz);
    group.add(band);
  }

  // Cabin
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.4, 1.8), cabinMat);
  cabin.position.set(0, 1.4, -1.8);
  group.add(cabin);

  // Cabin roof (slightly curved using a wider box with chamfered look)
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.1, 2.0), darkMat);
  roof.position.set(0, 2.15, -1.8);
  group.add(roof);

  // Roof overhang (thin lip around edge)
  const roofLip = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 2.1), darkMat);
  roofLip.position.set(0, 2.12, -1.8);
  group.add(roofLip);

  // Cab windows (openings on each side)
  const cabWindowMat = new THREE.MeshStandardMaterial({
    color: 0xaaddff,
    emissive: 0x334455,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.3,
  });
  for (const side of [-1, 1]) {
    const cabWin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.6), cabWindowMat);
    cabWin.position.set(side * 0.81, 1.6, -1.6);
    group.add(cabWin);
  }

  // Rear cab window
  const rearCabWin = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.4, 0.04), cabWindowMat);
  rearCabWin.position.set(0, 1.6, -2.71);
  group.add(rearCabWin);

  // Chimney
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.7, 8), darkMat);
  chimney.position.set(0, 2.0, 1.2);
  group.add(chimney);

  // Chimney top (flared)
  const chimneyTop = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.15, 0.15, 8), darkMat);
  chimneyTop.position.set(0, 2.4, 1.2);
  group.add(chimneyTop);

  // Chimney cap rim (brass ring)
  const chimneyRim = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.02, 6, 12), brassyMat);
  chimneyRim.rotation.x = Math.PI / 2;
  chimneyRim.position.set(0, 2.48, 1.2);
  group.add(chimneyRim);

  // Steam dome (rounded dome on top of boiler, between chimney and cabin)
  const steamDome = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), brassyMat);
  steamDome.position.set(0, 1.9, 0.0);
  group.add(steamDome);
  // Dome base ring
  const domeBase = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.06, 8), brassyMat);
  domeBase.position.set(0, 1.9, 0.0);
  group.add(domeBase);

  // Safety valve (small dome behind steam dome)
  const safetyValve = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2), brassyMat);
  safetyValve.position.set(0, 1.9, -0.6);
  group.add(safetyValve);

  // Whistle (tiny cylinder on top of cab)
  const whistle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6), brassyMat);
  whistle.position.set(0.2, 2.25, -1.2);
  group.add(whistle);

  // Side tanks/pipes (thin cylinders along sides of the boiler)
  for (const side of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), brassyMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(side * 0.6, 1.75, 0.3);
    group.add(pipe);
  }

  // Running boards (walkway along each side of boiler)
  for (const side of [-1, 1]) {
    const runBoard = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.03, 3.2), darkMat);
    runBoard.position.set(side * 0.82, 0.72, 0.3);
    group.add(runBoard);

    // Running board supports
    for (const sz of [-0.8, 0.3, 1.4]) {
      const support = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.04), darkMat);
      support.position.set(side * 0.82, 0.66, sz);
      group.add(support);
    }
  }

  // Cowcatcher (V-shaped front with multiple bars)
  const cowcatcherMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.5, roughness: 0.4 });
  for (let bar = 0; bar < 4; bar++) {
    const barY = 0.3 + bar * 0.12;
    for (const side of [-1, 1]) {
      const cowBar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 4), cowcatcherMat);
      cowBar.position.set(side * 0.3, barY, 2.1);
      cowBar.rotation.z = side * 0.4;
      cowBar.rotation.x = -0.3;
      group.add(cowBar);
    }
  }

  // Buffer beam (front)
  const bufferBeam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.15, 0.1), darkMat);
  bufferBeam.position.set(0, 0.55, 1.95);
  group.add(bufferBeam);

  // Buffers (cylindrical buffer pads on front)
  for (const side of [-1, 1]) {
    const bufferPad = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8), darkMat);
    bufferPad.rotation.x = Math.PI / 2;
    bufferPad.position.set(side * 0.55, 0.55, 2.05);
    group.add(bufferPad);

    const bufferShank = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.15, 6), brassyMat);
    bufferShank.rotation.x = Math.PI / 2;
    bufferShank.position.set(side * 0.55, 0.55, 1.92);
    group.add(bufferShank);
  }

  // Headlight (brighter emissive, with housing)
  const headlightHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.12, 8), darkMat);
  headlightHousing.position.set(0, 1.6, 1.52);
  headlightHousing.rotation.x = Math.PI / 2;
  group.add(headlightHousing);

  const headlight = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffffaa, emissiveIntensity: 2.0 }),
  );
  headlight.position.set(0, 1.6, 1.58);
  group.add(headlight);

  // Wheels with spokes
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.3 });
  const wheelPositions: [number, number, number][] = [
    [-0.75, 0.35, 1.0], [0.75, 0.35, 1.0],
    [-0.75, 0.35, 0.0], [0.75, 0.35, 0.0],
    [-0.75, 0.35, -1.0], [0.75, 0.35, -1.0],
  ];
  for (const [x, y, z] of wheelPositions) {
    const spokeWheel = createSpokedWheel(0.35, 0.1, wheelMat, brassyMat);
    spokeWheel.position.set(x, y, z);
    spokeWheel.rotation.z = Math.PI / 2;
    group.add(spokeWheel);
    wheels.push(spokeWheel);
  }

  // Connecting rods between wheel pairs on each side
  const rodMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6, roughness: 0.3 });
  for (const side of [-0.75, 0.75]) {
    // Rod connecting front wheel (z=1.0) to middle wheel (z=0.0)
    const rod1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), rodMat);
    rod1.rotation.x = Math.PI / 2;
    rod1.position.set(side, 0.35, 0.5);
    group.add(rod1);

    // Rod connecting middle wheel (z=0.0) to rear wheel (z=-1.0)
    const rod2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6), rodMat);
    rod2.rotation.x = Math.PI / 2;
    rod2.position.set(side, 0.35, -0.5);
    group.add(rod2);

    // Piston cylinder (horizontal cylinder on each side near front)
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 8), darkMat);
    piston.rotation.x = Math.PI / 2;
    piston.position.set(side, 0.5, 1.4);
    group.add(piston);

    // Piston rod
    const pistonRod = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 4), rodMat);
    pistonRod.rotation.x = Math.PI / 2;
    pistonRod.position.set(side, 0.5, 0.9);
    group.add(pistonRod);
  }

  // Frame
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 4.5), darkMat);
  frame.position.set(0, 0.55, 0);
  group.add(frame);

  // Tender/coal car behind the cabin
  const tenderBody = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 1.2), darkMat);
  tenderBody.position.set(0, 0.95, -3.2);
  group.add(tenderBody);

  // Tender sides (open top box)
  const tenderSideMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.4, roughness: 0.5 });
  // Back wall
  const tenderBack = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 0.06), tenderSideMat);
  tenderBack.position.set(0, 1.5, -3.8);
  group.add(tenderBack);
  // Side walls
  for (const side of [-1, 1]) {
    const tenderSide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 1.2), tenderSideMat);
    tenderSide.position.set(side * 0.65, 1.5, -3.2);
    group.add(tenderSide);
  }
  // Front wall (lower, connects to cabin)
  const tenderFront = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.2, 0.06), tenderSideMat);
  tenderFront.position.set(0, 1.4, -2.6);
  group.add(tenderFront);

  // Coal (dark dodecahedron cluster — more pieces, seeded positions)
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const r = 0.2 + (i % 3) * 0.1;
    const coal = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12 + (i % 3) * 0.04, 0), coalMat);
    coal.position.set(
      Math.cos(angle) * r,
      1.4 + (i % 2) * 0.15,
      -3.2 + Math.sin(angle) * r,
    );
    coal.rotation.set(i * 0.7, i * 1.1, 0);
    group.add(coal);
  }

  // Tender frame
  const tenderFrame = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.15, 1.3), darkMat);
  tenderFrame.position.set(0, 0.55, -3.2);
  group.add(tenderFrame);

  // Tender wheels (also spoked)
  const tenderWheelPositions: [number, number, number][] = [
    [-0.6, 0.35, -2.8], [0.6, 0.35, -2.8],
    [-0.6, 0.35, -3.6], [0.6, 0.35, -3.6],
  ];
  for (const [x, y, z] of tenderWheelPositions) {
    const spokeWheel = createSpokedWheel(0.3, 0.1, wheelMat, brassyMat);
    spokeWheel.position.set(x, y, z);
    spokeWheel.rotation.z = Math.PI / 2;
    group.add(spokeWheel);
    wheels.push(spokeWheel);
  }

  // Coupling between loco and tender
  const couplingBar = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 6), rodMat);
  couplingBar.rotation.x = Math.PI / 2;
  couplingBar.position.set(0, 0.55, -2.55);
  group.add(couplingBar);

  // Cabin interior light
  const cabinLight = new THREE.PointLight(0xffdd88, 2, 15, 1);
  cabinLight.position.set(0, 1.6, -1.8);
  group.add(cabinLight);

  group.userData.offset = 0;

  // Store chimney position for smoke particles
  const chimneyWorldPos = new THREE.Vector3(0, 2.5, 1.2);

  return { group, wheels, chimneyWorldPos };
}
