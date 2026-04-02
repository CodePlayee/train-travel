import * as THREE from 'three';

export interface SegmentEndpoint {
  position: THREE.Vector3;
  tangent: THREE.Vector3; // direction + magnitude controls curvature
}

export class TrackSegment {
  readonly curve: THREE.CubicBezierCurve3;
  readonly meshGroup: THREE.Group;
  readonly terrainGroup: THREE.Group;
  readonly vegetationGroup: THREE.Group;
  readonly boundingSphere: THREE.Sphere;
  readonly index: number;
  readonly startEndpoint: SegmentEndpoint;
  readonly endEndpoint: SegmentEndpoint;
  readonly arcLength: number;

  private static readonly RAIL_GAUGE = 1.2;
  private static readonly SEGMENTS = 80;
  private static readonly SLEEPER_SPACING = 2; // world units between sleepers

  constructor(
    scene: THREE.Scene,
    index: number,
    start: SegmentEndpoint,
    end: SegmentEndpoint,
  ) {
    this.index = index;
    this.startEndpoint = start;
    this.endEndpoint = end;

    // Hermite → Bezier control points
    const p0 = start.position.clone();
    const p1 = start.position.clone().add(start.tangent.clone().multiplyScalar(1 / 3));
    const p2 = end.position.clone().sub(end.tangent.clone().multiplyScalar(1 / 3));
    const p3 = end.position.clone();

    this.curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
    this.arcLength = this.curve.getLength();

    this.meshGroup = new THREE.Group();
    this.meshGroup.name = `track-segment-${index}`;
    this.terrainGroup = new THREE.Group();
    this.terrainGroup.name = `terrain-segment-${index}`;
    this.vegetationGroup = new THREE.Group();
    this.vegetationGroup.name = `vegetation-segment-${index}`;

    this.buildTrackGeometry();

    // Compute bounding sphere
    this.boundingSphere = new THREE.Sphere();
    const points = this.curve.getPoints(20);
    const box = new THREE.Box3();
    for (const p of points) box.expandByPoint(p);
    box.getBoundingSphere(this.boundingSphere);
    // Expand to include terrain width
    this.boundingSphere.radius += 100;

    scene.add(this.meshGroup);
    scene.add(this.terrainGroup);
    scene.add(this.vegetationGroup);
  }

  private buildTrackGeometry(): void {
    const { SEGMENTS, RAIL_GAUGE } = TrackSegment;

    // Shared materials
    const railMat = new THREE.MeshStandardMaterial({
      color: 0x555555, metalness: 0.6, roughness: 0.4,
    });
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x4a3728 });
    const ballastMat = new THREE.MeshStandardMaterial({
      color: 0x887766, roughness: 0.95, metalness: 0.0,
    });

    // Rails
    for (let side = -1; side <= 1; side += 2) {
      const railPoints: THREE.Vector3[] = [];
      for (let i = 0; i <= SEGMENTS; i++) {
        const t = i / SEGMENTS;
        const pos = this.curve.getPointAt(t);
        const tangent = this.curve.getTangentAt(t);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        railPoints.push(pos.clone().add(normal.multiplyScalar(side * RAIL_GAUGE / 2)));
      }
      const railCurve = new THREE.CatmullRomCurve3(railPoints, false);
      const railGeo = new THREE.TubeGeometry(railCurve, SEGMENTS, 0.06, 4, false);
      this.meshGroup.add(new THREE.Mesh(railGeo, railMat));
    }

    // Ballast bed — manually constructed to keep cross-section horizontal
    const ballastWidth = RAIL_GAUGE + 1.4;
    const bw = ballastWidth / 2;
    const bh = 0.25;
    const ballastYOffset = -0.3;

    // Cross-section vertices (in local space, left to right):
    // 0: bottom-left (-bw, 0)
    // 1: top-left (-bw*0.7, bh)
    // 2: top-right (bw*0.7, bh)
    // 3: bottom-right (bw, 0)
    const crossSection = [
      { lateral: -bw, vertical: 0 },
      { lateral: -bw * 0.7, vertical: bh },
      { lateral: bw * 0.7, vertical: bh },
      { lateral: bw, vertical: 0 },
    ];
    const csLen = crossSection.length; // 4

    const vertexCount = (SEGMENTS + 1) * csLen;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);

    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      for (let j = 0; j < csLen; j++) {
        const idx = (i * csLen + j) * 3;
        positions[idx]     = pos.x + normal.x * crossSection[j].lateral;
        positions[idx + 1] = pos.y + ballastYOffset + crossSection[j].vertical;
        positions[idx + 2] = pos.z + normal.z * crossSection[j].lateral;
      }

      // Normals per cross-section vertex
      // 0 (bottom-left): left-side face normal (outward-left + down)
      // 1 (top-left): top face normal (up)
      // 2 (top-right): top face normal (up)
      // 3 (bottom-right): right-side face normal (outward-right + down)
      const leftNorm = new THREE.Vector3(
        -normal.x * bh - up.x * (bw - bw * 0.7),
        -normal.y * bh - up.y * (bw - bw * 0.7),
        -normal.z * bh - up.z * (bw - bw * 0.7),
      ).normalize().negate();
      const rightNorm = new THREE.Vector3(
        normal.x * bh + up.x * (bw - bw * 0.7),
        normal.y * bh + up.y * (bw - bw * 0.7),
        normal.z * bh + up.z * (bw - bw * 0.7),
      ).normalize().negate();

      const base = i * csLen * 3;
      // vertex 0: left side normal
      normals[base]     = leftNorm.x;
      normals[base + 1] = leftNorm.y;
      normals[base + 2] = leftNorm.z;
      // vertex 1: up
      normals[base + 3] = 0;
      normals[base + 4] = 1;
      normals[base + 5] = 0;
      // vertex 2: up
      normals[base + 6] = 0;
      normals[base + 7] = 1;
      normals[base + 8] = 0;
      // vertex 3: right side normal
      normals[base + 9]  = rightNorm.x;
      normals[base + 10] = rightNorm.y;
      normals[base + 11] = rightNorm.z;
    }

    // Build index buffer: 3 quads per segment (left side, top, right side)
    // Each quad = 2 triangles = 6 indices
    const indices: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const curr = i * csLen;
      const next = (i + 1) * csLen;

      // Left side face: vertices 0-1
      indices.push(curr + 0, next + 0, next + 1);
      indices.push(curr + 0, next + 1, curr + 1);

      // Top face: vertices 1-2
      indices.push(curr + 1, next + 1, next + 2);
      indices.push(curr + 1, next + 2, curr + 2);

      // Right side face: vertices 2-3
      indices.push(curr + 2, next + 2, next + 3);
      indices.push(curr + 2, next + 3, curr + 3);
    }

    const ballastGeo = new THREE.BufferGeometry();
    ballastGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    ballastGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    ballastGeo.setIndex(indices);
    this.meshGroup.add(new THREE.Mesh(ballastGeo, ballastMat));

    // Roadbed (路基) — wider trapezoidal foundation beneath the ballast
    const roadbedMat = new THREE.MeshStandardMaterial({
      color: 0x6b5b4f, roughness: 0.95, metalness: 0.0,
    });

    const roadbedTopWidth = 2.5;         // half-width at top (5m total)
    const roadbedBottomWidth = 4.0;      // half-width at bottom (8m total)
    const roadbedHeight = 0.6;
    const roadbedYOffset = -0.8;         // top at pos.y - 0.2, bottom at pos.y - 0.8

    // Cross-section vertices (left to right):
    // 0: bottom-left (-roadbedBottomWidth, 0)
    // 1: top-left (-roadbedTopWidth, roadbedHeight)
    // 2: top-right (roadbedTopWidth, roadbedHeight)
    // 3: bottom-right (roadbedBottomWidth, 0)
    const rbCrossSection = [
      { lateral: -roadbedBottomWidth, vertical: 0 },
      { lateral: -roadbedTopWidth, vertical: roadbedHeight },
      { lateral: roadbedTopWidth, vertical: roadbedHeight },
      { lateral: roadbedBottomWidth, vertical: 0 },
    ];
    const rbCsLen = rbCrossSection.length;

    const rbVertexCount = (SEGMENTS + 1) * rbCsLen;
    const rbPositions = new Float32Array(rbVertexCount * 3);
    const rbNormals = new Float32Array(rbVertexCount * 3);

    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t);
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      for (let j = 0; j < rbCsLen; j++) {
        const idx = (i * rbCsLen + j) * 3;
        rbPositions[idx]     = pos.x + normal.x * rbCrossSection[j].lateral;
        rbPositions[idx + 1] = pos.y + roadbedYOffset + rbCrossSection[j].vertical;
        rbPositions[idx + 2] = pos.z + normal.z * rbCrossSection[j].lateral;
      }

      // Normals: left slope, top (up), top (up), right slope
      const lateralDiff = roadbedBottomWidth - roadbedTopWidth;
      const rbLeftNorm = new THREE.Vector3(
        -normal.x * roadbedHeight - up.x * lateralDiff,
        -normal.y * roadbedHeight - up.y * lateralDiff,
        -normal.z * roadbedHeight - up.z * lateralDiff,
      ).normalize().negate();
      const rbRightNorm = new THREE.Vector3(
        normal.x * roadbedHeight + up.x * lateralDiff,
        normal.y * roadbedHeight + up.y * lateralDiff,
        normal.z * roadbedHeight + up.z * lateralDiff,
      ).normalize().negate();

      const base = i * rbCsLen * 3;
      rbNormals[base]     = rbLeftNorm.x;
      rbNormals[base + 1] = rbLeftNorm.y;
      rbNormals[base + 2] = rbLeftNorm.z;
      rbNormals[base + 3] = 0;
      rbNormals[base + 4] = 1;
      rbNormals[base + 5] = 0;
      rbNormals[base + 6] = 0;
      rbNormals[base + 7] = 1;
      rbNormals[base + 8] = 0;
      rbNormals[base + 9]  = rbRightNorm.x;
      rbNormals[base + 10] = rbRightNorm.y;
      rbNormals[base + 11] = rbRightNorm.z;
    }

    const rbIndices: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const curr = i * rbCsLen;
      const next = (i + 1) * rbCsLen;

      // Left side face: vertices 0-1
      rbIndices.push(curr + 0, next + 0, next + 1);
      rbIndices.push(curr + 0, next + 1, curr + 1);

      // Top face: vertices 1-2
      rbIndices.push(curr + 1, next + 1, next + 2);
      rbIndices.push(curr + 1, next + 2, curr + 2);

      // Right side face: vertices 2-3
      rbIndices.push(curr + 2, next + 2, next + 3);
      rbIndices.push(curr + 2, next + 3, curr + 3);
    }

    const roadbedGeo = new THREE.BufferGeometry();
    roadbedGeo.setAttribute('position', new THREE.BufferAttribute(rbPositions, 3));
    roadbedGeo.setAttribute('normal', new THREE.BufferAttribute(rbNormals, 3));
    roadbedGeo.setIndex(rbIndices);
    this.meshGroup.add(new THREE.Mesh(roadbedGeo, roadbedMat));

    // Sleepers — use InstancedMesh for performance (single draw call)
    const sleeperGeo = new THREE.BoxGeometry(RAIL_GAUGE + 0.6, 0.08, 0.2);
    const sleeperCount = Math.max(1, Math.floor(this.arcLength / TrackSegment.SLEEPER_SPACING));
    const sleeperInstanced = new THREE.InstancedMesh(sleeperGeo, sleeperMat, sleeperCount);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < sleeperCount; i++) {
      const t = i / sleeperCount;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t);
      dummy.position.copy(pos);
      dummy.position.y -= 0.04;
      dummy.lookAt(pos.clone().add(tangent));
      dummy.updateMatrix();
      sleeperInstanced.setMatrixAt(i, dummy.matrix);
    }
    sleeperInstanced.instanceMatrix.needsUpdate = true;
    this.meshGroup.add(sleeperInstanced);
  }

  getPointAt(t: number): THREE.Vector3 {
    return this.curve.getPointAt(Math.max(0, Math.min(1, t)));
  }

  getTangentAt(t: number): THREE.Vector3 {
    return this.curve.getTangentAt(Math.max(0, Math.min(1, t)));
  }

  dispose(scene: THREE.Scene): void {
    this.disposeGroup(this.meshGroup, scene);
    this.disposeGroup(this.terrainGroup, scene);
    this.disposeGroup(this.vegetationGroup, scene);
  }

  private disposeGroup(group: THREE.Group, scene: THREE.Scene): void {
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    });
    scene.remove(group);
  }
}
