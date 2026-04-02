# Train Travel

Three.js procedural infinite train simulation. The train runs on a dynamically generated track that extends infinitely ahead and culls behind.

## Commands

```bash
npm run dev        # start dev server (Vite)
npm run build      # typecheck + production build
npm run typecheck  # tsc --noEmit
```

## Architecture

```
src/
├── main.ts                 # entry point, animation loop
├── hud.ts                  # speed/time HUD overlay
├── style.css
├── core/
│   ├── camera.ts           # 3 camera modes (follow, cab, cinematic)
│   ├── input.ts            # keyboard input (W/S speed, C camera toggle)
│   └── scene.ts            # scene, renderer, lighting setup
├── train/
│   ├── train.ts            # TrainController — position, speed, carriages
│   ├── locomotive.ts       # locomotive mesh + interior light
│   └── carriage.ts         # passenger car mesh + transparent windows + interior light
├── utils/
│   └── noise.ts            # simplex noise, fbm
└── world/
    ├── trackManager.ts     # manages segment pool, generation, culling
    ├── trackSegment.ts     # single track segment (Hermite→Bezier curve, rails, ballast, roadbed, sleepers)
    ├── terrain.ts          # per-segment terrain strip, bridges, tunnels
    ├── biome.ts            # biome sequence, blending, height/color configs
    ├── vegetation.ts       # per-segment trees/rocks
    ├── track.ts            # (legacy, unused)
    └── sky.ts              # sky dome / day-night cycle
```

## Key Concepts

- **Infinite track**: `TrackManager` generates `TrackSegment` objects ahead of the train and culls behind. Each segment is a cubic Bezier curve (~100m arc length) with C1 continuity at junctions.
- **Train position**: `(segmentIndex, localT)` — not a single `t` on a closed curve.
- **Terrain adaptation**: terrain deforms near track (height diff < 5m), bridges spawn when track is above terrain (> 5m), tunnels (TubeGeometry) when track is below terrain for 10m+ continuously.
- **Biomes**: cycle in sequence (grassland → forest → mountains → desert → lake → grassland), with blending at boundaries.
- **Track geometry**: rails (TubeGeometry), ballast + roadbed (manual BufferGeometry with horizontal normals), sleepers (BoxGeometry). Horizontal normal = `(-tangent.z, 0, tangent.x)` to avoid Frenet frame rotation issues.

## Tech Stack

- Three.js 0.170.0
- TypeScript 5.7
- Vite 6

## Workflow Rules

- Focused/specialized code modifications should go through subAgent (Agent tool), not direct edits.
- No need to ask for user confirmation unless the action involves: deleting files, uploading files, or downloading unsafe content. All other actions can proceed autonomously.
