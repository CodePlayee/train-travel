import * as THREE from 'three';
import { TrackSegment, SegmentEndpoint } from './trackSegment';
import { getBiomeAtDistance } from './biome';
import { noise2D } from '../utils/noise';
import { createSegmentTerrain } from './terrain';
import { createSegmentVegetation } from './vegetation';

export interface TrackPosition {
  segmentIndex: number;
  localT: number;
}

export class TrackManager {
  readonly segments: TrackSegment[] = [];
  private scene: THREE.Scene;
  private nextSegmentIndex = 0;
  private cumulativeDistance = 0; // total distance generated so far
  private lastAngle = 0; // current heading angle (radians, 0 = +Z)
  private lastElevation = 2; // current Y

  // Generation parameters
  private static readonly SEGMENT_LENGTH = 100; // target arc length per segment
  private static readonly LOOK_AHEAD = 5; // segments ahead of train
  private static readonly KEEP_BEHIND = 3; // segments behind train before culling

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Generate initial segments
    for (let i = 0; i < TrackManager.LOOK_AHEAD + 2; i++) {
      this.generateNextSegment();
    }
  }

  private generateNextSegment(): TrackSegment {
    const L = TrackManager.SEGMENT_LENGTH;
    let start: SegmentEndpoint;

    if (this.segments.length === 0) {
      // First segment: start at origin heading +Z
      start = {
        position: new THREE.Vector3(0, 2.3, 0),
        tangent: new THREE.Vector3(0, 0, -L),
      };
      this.lastAngle = Math.PI; // heading -Z
    } else {
      const prev = this.segments[this.segments.length - 1];
      start = {
        position: prev.endEndpoint.position.clone(),
        tangent: prev.endEndpoint.tangent.clone(),
      };
    }

    // Procedurally determine end point
    // Gradual random turn
    const turnNoise = noise2D(this.cumulativeDistance * 0.005, 0.5) * 0.4;
    this.lastAngle += turnNoise;

    // Direction from angle
    const dx = Math.sin(this.lastAngle);
    const dz = Math.cos(this.lastAngle);

    // Elevation based on biome at this distance
    const biome = getBiomeAtDistance(this.cumulativeDistance + L);
    const elevNoise = noise2D(this.cumulativeDistance * 0.003, 1.5) * 0.3;
    let targetY: number;
    if (biome === 'mountains') targetY = 8 + elevNoise * 5;
    else if (biome === 'desert') targetY = 1 + elevNoise;
    else if (biome === 'lake') targetY = 2 + elevNoise;
    else targetY = 2 + elevNoise * 2;

    // Smoothly approach target elevation
    this.lastElevation = THREE.MathUtils.lerp(this.lastElevation, targetY, 0.3);

    const endPos = start.position.clone().add(
      new THREE.Vector3(dx * L, 0, dz * L),
    );
    endPos.y = this.lastElevation + 0.3;

    // End tangent: same direction, maintaining momentum for C1 continuity
    const endTangent = new THREE.Vector3(dx * L, 0, dz * L);
    // Add slight Y component for elevation changes
    endTangent.y = (endPos.y - start.position.y) * 0.5;

    const end: SegmentEndpoint = {
      position: endPos,
      tangent: endTangent,
    };

    const segmentStartDist = this.cumulativeDistance;
    const segment = new TrackSegment(this.scene, this.nextSegmentIndex, start, end);
    this.segments.push(segment);
    this.nextSegmentIndex++;
    this.cumulativeDistance += segment.arcLength;

    // Generate terrain and vegetation for this segment
    createSegmentTerrain(segment, segmentStartDist);
    createSegmentVegetation(segment, segmentStartDist);

    return segment;
  }

  /**
   * Get world position on track given a TrackPosition.
   */
  getPointAt(pos: TrackPosition): THREE.Vector3 {
    const seg = this.getSegment(pos.segmentIndex);
    if (!seg) return new THREE.Vector3();
    return seg.getPointAt(pos.localT);
  }

  /**
   * Get tangent direction at a TrackPosition.
   */
  getTangentAt(pos: TrackPosition): THREE.Vector3 {
    const seg = this.getSegment(pos.segmentIndex);
    if (!seg) return new THREE.Vector3(0, 0, 1);
    return seg.getTangentAt(pos.localT);
  }

  /**
   * Walk backwards along track from a position by a given arc-length distance.
   * Returns the resulting TrackPosition. Used for carriage offsets.
   */
  walkBack(from: TrackPosition, distance: number): TrackPosition {
    let segIdx = from.segmentIndex;
    let seg = this.getSegment(segIdx);
    if (!seg) return from;

    // Distance from start of current segment to our position
    let distFromSegStart = from.localT * seg.arcLength;
    let remaining = distance;

    // If we can stay on the current segment
    if (remaining <= distFromSegStart) {
      return {
        segmentIndex: segIdx,
        localT: (distFromSegStart - remaining) / seg.arcLength,
      };
    }

    // Walk back through previous segments
    remaining -= distFromSegStart;
    segIdx--;
    seg = this.getSegment(segIdx);

    while (seg) {
      if (remaining <= seg.arcLength) {
        return {
          segmentIndex: segIdx,
          localT: (seg.arcLength - remaining) / seg.arcLength,
        };
      }
      remaining -= seg.arcLength;
      segIdx--;
      seg = this.getSegment(segIdx);
    }

    // If we ran out of segments, return start of earliest segment
    const earliest = this.segments[0];
    return earliest
      ? { segmentIndex: earliest.index, localT: 0 }
      : from;
  }

  /**
   * Advance a TrackPosition by a normalized speed value.
   * Returns updated position, handling segment transitions.
   */
  advance(pos: TrackPosition, speed: number): TrackPosition {
    let seg = this.getSegment(pos.segmentIndex);
    if (!seg) return pos;

    // Convert speed to localT delta based on segment arc length
    // Speed is in world units per frame; localT is 0-1
    const tDelta = speed / seg.arcLength;
    let newT = pos.localT + tDelta;
    let newSegIdx = pos.segmentIndex;

    while (newT >= 1) {
      // Convert overflow t back to world distance, then to next segment's t
      const overflow = (newT - 1) * seg!.arcLength;
      newSegIdx++;
      const nextSeg = this.getSegment(newSegIdx);
      if (nextSeg) {
        newT = overflow / nextSeg.arcLength;
        seg = nextSeg;
      } else {
        newT = 0.999;
        newSegIdx--;
        break;
      }
    }

    return { segmentIndex: newSegIdx, localT: newT };
  }

  /**
   * Main update: generate ahead, cull behind.
   */
  update(trainPos: TrackPosition, camera: THREE.Camera): void {
    // Generate segments ahead
    const lastSegIdx = this.segments.length > 0
      ? this.segments[this.segments.length - 1].index
      : -1;
    const segsAhead = lastSegIdx - trainPos.segmentIndex;

    while (segsAhead < TrackManager.LOOK_AHEAD ||
           this.segments.length === 0) {
      this.generateNextSegment();
      if (this.segments[this.segments.length - 1].index - trainPos.segmentIndex >= TrackManager.LOOK_AHEAD) {
        break;
      }
    }

    // Cull segments behind train
    const frustum = new THREE.Frustum();
    const projScreenMatrix = new THREE.Matrix4();
    projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    frustum.setFromProjectionMatrix(projScreenMatrix);

    while (this.segments.length > 0) {
      const oldest = this.segments[0];
      const isFarBehind = oldest.index < trainPos.segmentIndex - TrackManager.KEEP_BEHIND;
      const isOutsideFrustum = !frustum.intersectsSphere(oldest.boundingSphere);

      if (isFarBehind && isOutsideFrustum) {
        oldest.dispose(this.scene);
        this.segments.shift();
      } else {
        break;
      }
    }
  }

  /**
   * Get the cumulative distance at a given segment index.
   */
  getCumulativeDistance(segmentIndex: number): number {
    let dist = 0;
    for (const seg of this.segments) {
      if (seg.index >= segmentIndex) break;
      dist += seg.arcLength;
    }
    return dist;
  }

  /**
   * Find segment by index.
   */
  private getSegment(index: number): TrackSegment | undefined {
    return this.segments.find((s) => s.index === index);
  }
}
