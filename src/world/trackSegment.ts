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
  // Populated by terrain module after construction (see createSegmentTerrain).
  // Each entry is a [startT, endT] range in [0,1] curve parameter space where
  // the track is considered "inside a tunnel" (terrain above track + portal extension).
  tunnelRegions: Array<{ startT: number; endT: number }> = [];

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
    this.boundingSphere.radius += 300;

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
    // Ballast & roadbed use vertexColors so the base verts can fade toward the
    // surrounding terrain tone, hiding the otherwise-hard seam with the ground.
    const ballastMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, metalness: 0.0,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    const ballastTopColor = new THREE.Color(0x887766);
    const ballastBottomColor = new THREE.Color(0x554a3f);

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

    // Ballast bed (gravel) sitting on top of the roadbed.
    // Cross-section (lateral, vertical): trapezoidal mound.
    const ballastWidth = RAIL_GAUGE + 1.4;
    const bw = ballastWidth / 2;
    const bh = 0.25;
    const ballastYOffset = -0.3;
    const ballastCrossSection = [
      { lateral: -bw, vertical: 0 },
      { lateral: -bw * 0.7, vertical: bh },
      { lateral: bw * 0.7, vertical: bh },
      { lateral: bw, vertical: 0 },
    ];
    this.meshGroup.add(new THREE.Mesh(
      this.buildTrapezoidalStrip(ballastCrossSection, ballastYOffset, ballastTopColor, ballastBottomColor),
      ballastMat,
    ));

    // Roadbed (路基) — wider trapezoidal foundation beneath the ballast.
    const roadbedMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.95, metalness: 0.0,
      side: THREE.DoubleSide,
      vertexColors: true,
    });
    const roadbedTopColor = new THREE.Color(0x6b5b4f);
    const roadbedBottomColor = new THREE.Color(0x3d342b);
    const roadbedTopWidth = 1.4;       // half-width at top (2.8m total)
    const roadbedBottomWidth = 2.0;    // half-width at bottom (4.0m total)
    const roadbedHeight = 0.6;         // visible vertical mound
    const roadbedYOffset = -0.8;       // top at pos.y - 0.2, bottom at pos.y - 0.8
    const roadbedCrossSection = [
      { lateral: -roadbedBottomWidth, vertical: 0 },
      { lateral: -roadbedTopWidth, vertical: roadbedHeight },
      { lateral: roadbedTopWidth, vertical: roadbedHeight },
      { lateral: roadbedBottomWidth, vertical: 0 },
    ];
    this.meshGroup.add(new THREE.Mesh(
      this.buildTrapezoidalStrip(roadbedCrossSection, roadbedYOffset, roadbedTopColor, roadbedBottomColor),
      roadbedMat,
    ));

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

  /**
   * Build a trapezoidal strip following the segment curve.
   * Cross-section vertices must be ordered LEFT-to-RIGHT (negative lateral first).
   * Faces emitted: left slope, top, right slope. The bottom face is omitted —
   * it is buried in terrain and never visible, and including it would average
   * a downward-facing normal into the bottom corner verts (since they are
   * shared with the side slopes), which makes the base appear nearly black
   * under noon-overhead sun.
   * Optional vertex colors fade from `colorTop` at the top verts to
   * `colorBottom` at the bottom verts so the seam with surrounding terrain
   * blends instead of forming a hard line.
   */
  private buildTrapezoidalStrip(
    crossSection: { lateral: number; vertical: number }[],
    baseYOffset: number,
    colorTop?: THREE.Color,
    colorBottom?: THREE.Color,
  ): THREE.BufferGeometry {
    const { SEGMENTS } = TrackSegment;
    const csLen = crossSection.length; // expect 4

    const vertexCount = (SEGMENTS + 1) * csLen;
    const positions = new Float32Array(vertexCount * 3);
    const useColors = !!(colorTop && colorBottom);
    const colors = useColors ? new Float32Array(vertexCount * 3) : null;

    // Determine which cross-section indices are "top" vs "bottom" by their
    // vertical coordinate so we can assign vertex colors correctly.
    let maxV = -Infinity;
    let minV = Infinity;
    for (const cs of crossSection) {
      if (cs.vertical > maxV) maxV = cs.vertical;
      if (cs.vertical < minV) minV = cs.vertical;
    }
    const vRange = Math.max(1e-6, maxV - minV);

    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const pos = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t);
      const lateral = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

      for (let j = 0; j < csLen; j++) {
        const idx = (i * csLen + j) * 3;
        positions[idx]     = pos.x + lateral.x * crossSection[j].lateral;
        positions[idx + 1] = pos.y + baseYOffset + crossSection[j].vertical;
        positions[idx + 2] = pos.z + lateral.z * crossSection[j].lateral;

        if (colors && colorTop && colorBottom) {
          const f = (crossSection[j].vertical - minV) / vRange; // 0=bottom, 1=top
          const r = colorBottom.r + (colorTop.r - colorBottom.r) * f;
          const g = colorBottom.g + (colorTop.g - colorBottom.g) * f;
          const b = colorBottom.b + (colorTop.b - colorBottom.b) * f;
          colors[idx]     = r;
          colors[idx + 1] = g;
          colors[idx + 2] = b;
        }
      }
    }

    // Build index buffer with CCW outward winding for the visible faces only.
    // Cross-section index layout (left-to-right): 0=BL, 1=TL, 2=TR, 3=BR.
    // The curve advances along its tangent direction (curr -> next).
    // Outward normal directions: left face -> -lateral+up, top -> +up,
    // right face -> +lateral+up. Bottom face is intentionally omitted.
    const indices: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const curr = i * csLen;
      const next = (i + 1) * csLen;

      // Left slope (BL <-> TL): outward = -lateral + up
      indices.push(curr + 0, next + 1, next + 0);
      indices.push(curr + 0, curr + 1, next + 1);

      // Top (TL <-> TR): outward = +up
      indices.push(curr + 1, next + 2, next + 1);
      indices.push(curr + 1, curr + 2, next + 2);

      // Right slope (TR <-> BR): outward = +lateral + up
      indices.push(curr + 2, next + 3, next + 2);
      indices.push(curr + 2, curr + 3, next + 3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (colors) {
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
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
