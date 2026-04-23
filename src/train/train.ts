import * as THREE from 'three';
import { createLocomotive } from './locomotive';
import { createCarriage } from './carriage';
import { InputManager } from '../core/input';
import { TrackManager, TrackPosition } from '../world/trackManager';

export interface TrainState {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  speed: number;
  trackPosition: TrackPosition;
}

interface SmokeParticle {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  velocity: THREE.Vector3;
}

export class TrainController {
  readonly group: THREE.Group;
  private locomotiveWheels: THREE.Object3D[];
  private carriageWheels: THREE.Object3D[];
  private speed = 0.15;
  private targetSpeed = 0.15;
  private trackPos: TrackPosition = { segmentIndex: 0, localT: 0 };

  // Carriage offsets in world units (arc-length distance behind locomotive)
  // Each carriage is 3.72m between coupling faces; first carriage 5.72m behind loco
  private readonly carriageOffsets: number[] = [5.72, 9.44, 13.16, 16.88, 20.60];

  // Smoke particle system
  private smokeParticles: SmokeParticle[] = [];
  private smokePool: THREE.Mesh[] = [];
  private readonly SMOKE_POOL_SIZE = 30;
  private smokeSpawnTimer = 0;
  private chimneyWorldPos: THREE.Vector3;
  private locomotiveGroup: THREE.Group;

  // Headlight (owned by locomotive group, controlled here based on dayTime)
  readonly headlightBeam: THREE.SpotLight;
  readonly headlightEmissive: THREE.MeshStandardMaterial;
  headlightBaseIntensity = 200;
  headlightBaseEmissive = 4.0;

  // Coupling drawbars
  private couplings: THREE.Mesh[] = [];
  private locoRearLocal: THREE.Vector3;
  private carriageGroups: THREE.Group[] = [];
  private carriageFrontLocals: THREE.Vector3[] = [];
  private carriageRearLocals: THREE.Vector3[] = [];

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.locomotiveWheels = [];
    this.carriageWheels = [];

    // Locomotive
    const loco = createLocomotive();
    this.group.add(loco.group);
    this.locomotiveWheels = loco.wheels;
    this.locomotiveGroup = loco.group;
    this.chimneyWorldPos = loco.chimneyWorldPos;
    this.locoRearLocal = loco.rearCouplingLocal;
    this.headlightBeam = loco.headlightBeam;
    this.headlightEmissive = loco.headlightEmissive;

    // Carriages
    const carriageConfigs: [number, number][] = [
      [0x2266aa, 0], // blue
      [0x22aa66, 0], // green
      [0xaa3333, 0], // red
      [0x886633, 0], // brown
      [0x6633aa, 0], // purple
    ];
    for (const [color] of carriageConfigs) {
      const carriage = createCarriage(color, 0);
      this.group.add(carriage.group);
      this.carriageWheels.push(...carriage.wheels);
      this.carriageGroups.push(carriage.group);
      this.carriageFrontLocals.push(carriage.frontCouplingLocal);
      this.carriageRearLocals.push(carriage.rearCouplingLocal);
    }

    scene.add(this.group);

    // Coupling drawbars (one between each adjacent pair)
    const couplingMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.6, roughness: 0.3 });
    for (let i = 0; i < this.carriageOffsets.length; i++) {
      const couplingGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 6);
      const coupling = new THREE.Mesh(couplingGeo, couplingMat);
      this.couplings.push(coupling);
      this.group.add(coupling);
    }

    // Initialize smoke particle pool
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    for (let i = 0; i < this.SMOKE_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), smokeMat.clone());
      mesh.visible = false;
      scene.add(mesh);
      this.smokePool.push(mesh);
    }

    // Headlight intensity is controlled per-frame in updateHeadlight based on dayTime.
    // Start dark — daytime default.
    this.headlightBeam.intensity = 0;
    this.headlightEmissive.emissiveIntensity = 0;
  }

  update(
    dt: number,
    input: InputManager,
    trackManager: TrackManager,
    dayTime?: number,
  ): TrainState {
    // Speed controls (in world units per frame)
    if (input.keys['KeyW'] || input.keys['ArrowUp']) {
      this.targetSpeed = Math.min(this.targetSpeed + 0.005, 0.8);
    }
    if (input.keys['KeyS'] || input.keys['ArrowDown']) {
      this.targetSpeed = Math.max(this.targetSpeed - 0.005, 0);
    }

    this.speed = THREE.MathUtils.lerp(this.speed, this.targetSpeed, 0.02);

    // Advance position along track
    this.trackPos = trackManager.advance(this.trackPos, this.speed);

    // Position locomotive
    const locoPos = trackManager.getPointAt(this.trackPos);
    const locoTangent = trackManager.getTangentAt(this.trackPos);
    const locoGroup = this.group.children[0];
    locoGroup.position.copy(locoPos);
    locoGroup.lookAt(locoPos.clone().add(locoTangent));

    // Position carriages by walking back along track
    for (let i = 0; i < this.carriageOffsets.length; i++) {
      const carriageGroup = this.group.children[i + 1];
      const carriagePos = trackManager.walkBack(this.trackPos, this.carriageOffsets[i]);
      const pos = trackManager.getPointAt(carriagePos);
      const tangent = trackManager.getTangentAt(carriagePos);
      carriageGroup.position.copy(pos);
      carriageGroup.lookAt(pos.clone().add(tangent));
    }

    // Update coupling drawbars
    this.group.updateMatrixWorld(true);
    for (let i = 0; i < this.couplings.length; i++) {
      const previousObject = i === 0 ? locoGroup : this.carriageGroups[i - 1];
      const previousLocal = i === 0 ? this.locoRearLocal : this.carriageRearLocals[i - 1];
      const nextObject = this.carriageGroups[i];
      const nextLocal = this.carriageFrontLocals[i];

      const a = previousLocal.clone().applyMatrix4(previousObject.matrixWorld);
      const b = nextLocal.clone().applyMatrix4(nextObject.matrixWorld);

      const mid = a.clone().add(b).multiplyScalar(0.5);
      const dir = b.clone().sub(a);
      const len = dir.length();
      const coupling = this.couplings[i];
      coupling.position.copy(mid);
      coupling.scale.set(1, Math.max(len, 0.01), 1);
      if (len > 1e-4) {
        const up = dir.clone().normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
        coupling.quaternion.copy(quat);
      }
    }

    // Wheel rotation — use rotateY (quaternion) to avoid Euler gimbal lock
    const wheelRot = this.speed * 2;
    for (const w of this.locomotiveWheels) w.rotateX(-wheelRot);
    for (const w of this.carriageWheels) w.rotateX(-wheelRot);

    const position = locoPos;
    const direction = locoTangent;

    // Update smoke particles
    this.updateSmoke(dt, direction);

    // Headlight: combine night-time and tunnel proximity (long lookahead so the
    // beam is on before the train enters the tunnel mouth).
    const tunnelProximity = trackManager.getTunnelProximity(this.trackPos, this.speed, {
      rampSeconds: 4.0,
      minRamp: 30,
      maxRamp: 150,
    });
    this.updateHeadlight(position, direction, dayTime, tunnelProximity);

    return { position, direction, speed: this.speed, trackPosition: this.trackPos };
  }

  private updateSmoke(dt: number, direction: THREE.Vector3): void {
    const chimneyLocal = this.chimneyWorldPos.clone();
    const chimneyWorld = chimneyLocal.applyMatrix4(this.locomotiveGroup.matrixWorld);

    const spawnRate = this.speed > 0.01 ? 0.03 + (1 - this.speed / 0.8) * 0.1 : 999;
    this.smokeSpawnTimer += dt;

    if (this.smokeSpawnTimer >= spawnRate && this.speed > 0.005) {
      this.smokeSpawnTimer = 0;
      this.spawnSmokeParticle(chimneyWorld, direction);
    }

    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];
      p.life += dt;
      const t = p.life / p.maxLife;

      if (t >= 1) {
        p.mesh.visible = false;
        this.smokeParticles.splice(i, 1);
        continue;
      }

      p.mesh.position.add(p.velocity.clone().multiplyScalar(dt));

      let scale: number;
      if (t < 0.3) {
        scale = THREE.MathUtils.lerp(0.5, 1.5, t / 0.3);
      } else {
        scale = THREE.MathUtils.lerp(1.5, 0.2, (t - 0.3) / 0.7);
      }
      p.mesh.scale.setScalar(scale);

      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = THREE.MathUtils.lerp(0.5, 0, t);

      const grey = THREE.MathUtils.lerp(0.8, 0.5, t);
      mat.color.setRGB(grey, grey, grey);
    }
  }

  private spawnSmokeParticle(chimneyWorld: THREE.Vector3, direction: THREE.Vector3): void {
    const available = this.smokePool.find(
      (m) => !this.smokeParticles.some((p) => p.mesh === m),
    );
    if (!available) return;

    available.visible = true;
    available.position.copy(chimneyWorld);
    available.scale.setScalar(0.5);

    const mat = available.material as THREE.MeshStandardMaterial;
    mat.opacity = 0.5;
    mat.color.setRGB(0.85, 0.85, 0.85);

    const speedFactor = this.speed / 0.8;
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 0.3,
      1.5 + Math.random() * 0.5,
      (Math.random() - 0.5) * 0.3,
    );
    velocity.add(direction.clone().multiplyScalar(-2 * speedFactor));

    this.smokeParticles.push({
      mesh: available,
      life: 0,
      maxLife: 1.5 + Math.random() * 1.0,
      velocity,
    });
  }

  private updateHeadlight(
    position: THREE.Vector3,
    direction: THREE.Vector3,
    dayTime?: number,
    tunnelProximity = 0,
  ): void {
    void position;
    void direction;

    // dayTime: 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset.
    // nightFactor: 1 at deep night, 0 during day, with smooth ramps at dawn/dusk.
    let nightFactor: number;
    if (dayTime === undefined) {
      nightFactor = 0;
    } else if (dayTime < 0.2) {
      nightFactor = 1.0;
    } else if (dayTime < 0.3) {
      nightFactor = 1.0 - (dayTime - 0.2) / 0.1;
    } else if (dayTime < 0.7) {
      nightFactor = 0;
    } else if (dayTime < 0.8) {
      nightFactor = (dayTime - 0.7) / 0.1;
    } else {
      nightFactor = 1.0;
    }

    // On if night OR near/inside a tunnel — whichever is brighter.
    const factor = Math.max(nightFactor, tunnelProximity);

    this.headlightBeam.intensity = factor * this.headlightBaseIntensity;
    this.headlightEmissive.emissiveIntensity = factor * this.headlightBaseEmissive;
  }
}
