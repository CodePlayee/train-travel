import * as THREE from 'three';
import { InputManager } from './input';

export class CameraController {
  constructor(
    private camera: THREE.PerspectiveCamera,
    private input: InputManager,
  ) {}

  update(trainPos: THREE.Vector3, trainDir: THREE.Vector3, tunnelProximity = 0): void {
    let targetPos: THREE.Vector3;
    let lookAt: THREE.Vector3;

    switch (this.input.cameraMode) {
      case 0: { // Chase
        const back = trainDir.clone().negate();
        const up = new THREE.Vector3(0, 1, 0);

        const rotatedBack = back.clone()
          .applyAxisAngle(up, this.input.mouseX)
          .multiplyScalar(12);

        targetPos = trainPos.clone()
          .add(rotatedBack)
          .add(new THREE.Vector3(0, 6 + this.input.mouseY * 5, 0));
        lookAt = trainPos.clone().add(new THREE.Vector3(0, 2, 0));
        break;
      }
      case 1: { // Side
        const side = new THREE.Vector3(-trainDir.z, 0, trainDir.x).normalize();
        targetPos = trainPos.clone().add(side.multiplyScalar(10)).add(new THREE.Vector3(0, 4, 0));
        lookAt = trainPos.clone().add(new THREE.Vector3(0, 1.5, 0));
        break;
      }
      case 2: { // Cab
        targetPos = trainPos.clone()
          .add(trainDir.clone().multiplyScalar(1.5))
          .add(new THREE.Vector3(0, 2.3, 0));
        lookAt = trainPos.clone()
          .add(trainDir.clone().multiplyScalar(20))
          .add(new THREE.Vector3(0, 2, 0));
        break;
      }
      default: {
        targetPos = this.camera.position.clone();
        lookAt = trainPos.clone();
      }
    }

    // Tunnel override: blend toward cab view so the camera doesn't punch through
    // mountain meshes when train enters/exits tunnels.
    const blend = this.input.cameraMode === 2 ? 0 : tunnelProximity;
    if (blend > 0) {
      const cabPos = trainPos.clone()
        .add(trainDir.clone().multiplyScalar(1.5))
        .add(new THREE.Vector3(0, 2.3, 0));
      const cabLook = trainPos.clone()
        .add(trainDir.clone().multiplyScalar(20))
        .add(new THREE.Vector3(0, 2, 0));
      targetPos.lerp(cabPos, blend);
      lookAt.lerp(cabLook, blend);
    }

    this.camera.position.lerp(targetPos, 0.05);
    this.camera.lookAt(lookAt);
  }
}
