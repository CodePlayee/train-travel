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
  private elevationHistory: number[] = [];

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

    // 9-point weighted average elevation smoothing
    this.elevationHistory.push(this.lastElevation);
    if (this.elevationHistory.length > 9) {
      this.elevationHistory.shift();
    }
    const weights = [1, 2, 3, 4, 5, 4, 3, 2, 1];
    const n = this.elevationHistory.length;
    const usedWeights = weights.slice(9 - n); // use weights from end so most recent gets weight 5
    let weightedSum = 0;
    let weightTotal = 0;
    for (let i = 0; i < n; i++) {
      weightedSum += this.elevationHistory[i] * usedWeights[i];
      weightTotal += usedWeights[i];
    }
    this.lastElevation = weightedSum / weightTotal;

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
    const prevSegment = this.segments.length > 0
      ? this.segments[this.segments.length - 1]
      : undefined;
    const segment = new TrackSegment(this.scene, this.nextSegmentIndex, start, end);
    this.segments.push(segment);
    this.nextSegmentIndex++;
    this.cumulativeDistance += segment.arcLength;

    // Generate terrain and vegetation for this segment.
    // Pass prev so terrain.ts can stitch tunnel-discard distances across the
    // shared boundary — avoids leftover terrain "panels" inside tunnels when a
    // mountain straddles the boundary.
    createSegmentTerrain(segment, segmentStartDist, prevSegment);
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
   * Returns 0..1 proximity to nearest tunnel — 1 inside tunnel, 0 farther than
   * the ramp distance away. Smoothstep ramp. Used by camera to blend toward
   * cab view so the camera doesn't poke through mountain meshes near tunnels.
   *
   * Ramp distance scales with `speed` (m/frame) so the camera transition
   * spans a roughly constant *time* (~RAMP_TIME_SECONDS) regardless of how
   * fast the train is moving. Clamped so a stopped train still has a small
   * buffer and a fast train doesn't get a huge zone.
   */
  getTunnelProximity(
    pos: TrackPosition,
    speed: number,
    options: { rampSeconds?: number; minRamp?: number; maxRamp?: number } = {},
  ): number {
    const RAMP_TIME_SECONDS = options.rampSeconds ?? 1.2;
    const FRAMES_PER_SECOND = 60; // assumed render fps; speed is m/frame
    const MIN_RAMP = options.minRamp ?? 8;
    const MAX_RAMP = options.maxRamp ?? 60;
    const RAMP_DISTANCE = THREE.MathUtils.clamp(
      Math.abs(speed) * RAMP_TIME_SECONDS * FRAMES_PER_SECOND,
      MIN_RAMP, MAX_RAMP,
    );
    const current = this.getSegment(pos.segmentIndex);
    if (!current) return 0;

    const trainArcInCurrent = pos.localT * current.arcLength;
    let minDist = Infinity;

    for (const offset of [-1, 0, 1, 2]) {
      const seg = this.getSegment(pos.segmentIndex + offset);
      if (!seg) continue;

      // Compute arc-length offset from start of `current` to start of `seg`.
      let segArcOffset = 0;
      if (offset > 0) {
        for (let k = 0; k < offset; k++) {
          const s = this.getSegment(pos.segmentIndex + k);
          if (!s) { segArcOffset = NaN; break; }
          segArcOffset += s.arcLength;
        }
      } else if (offset < 0) {
        for (let k = -1; k >= offset; k--) {
          const s = this.getSegment(pos.segmentIndex + k);
          if (!s) { segArcOffset = NaN; break; }
          segArcOffset -= s.arcLength;
        }
      }
      if (Number.isNaN(segArcOffset)) continue;

      const trainArcInThisSeg = trainArcInCurrent - segArcOffset;

      for (const region of seg.tunnelRegions) {
        const regStart = region.startT * seg.arcLength;
        const regEnd = region.endT * seg.arcLength;
        let d: number;
        if (trainArcInThisSeg < regStart) d = regStart - trainArcInThisSeg;
        else if (trainArcInThisSeg > regEnd) d = trainArcInThisSeg - regEnd;
        else d = 0;
        if (d < minDist) minDist = d;
      }
    }

    if (minDist === Infinity) return 0;
    const t = THREE.MathUtils.clamp(1 - minDist / RAMP_DISTANCE, 0, 1);
    return t * t * (3 - 2 * t);
  }

  /**
   * Toggle tunnel portal point lights based on night-time and proximity to
   * the train. Cheap per-frame: when nightFactor<=0 we just zero all
   * intensities. Otherwise binary on/off per light by squared distance —
   * inside RANGE the light shines at full BASE_INTENSITY * nightFactor,
   * outside it's 0. We deliberately never toggle `light.visible` because
   * that changes three.js's lightsStateVersion and forces every affected
   * material to recompile its shader (the cause of the per-tunnel-mouth
   * stutter we observed); modulating intensity is free.
   */
  updateTunnelPortalLights(trainWorldPos: THREE.Vector3, nightFactor: number): void {
    if (nightFactor <= 0) {
      for (const seg of this.segments) {
        for (const light of seg.tunnelPortalLights) {
          if (light.intensity !== 0) light.intensity = 0;
        }
      }
      return;
    }

    const RANGE = 300;
    const RANGE_SQ = RANGE * RANGE;
    const BASE_INTENSITY = 50;
    const onIntensity = BASE_INTENSITY * nightFactor;

    for (const seg of this.segments) {
      for (const light of seg.tunnelPortalLights) {
        const dx = light.position.x - trainWorldPos.x;
        const dy = light.position.y - trainWorldPos.y;
        const dz = light.position.z - trainWorldPos.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        light.intensity = distSq <= RANGE_SQ ? onIntensity : 0;
      }
    }
  }

  /**
   * Find segment by index.
   */
  private getSegment(index: number): TrackSegment | undefined {
    return this.segments.find((s) => s.index === index);
  }
}
