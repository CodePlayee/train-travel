import * as THREE from 'three';
import './style.css';
import { createScene } from './core/scene';
import { InputManager } from './core/input';
import { CameraController } from './core/camera';
import { TrackManager } from './world/trackManager';
import { SkySystem } from './world/sky';
import { TrainController } from './train/train';
import { updateHUD } from './hud';

// --- Debug wireframe (G key) ---------------------------------------------
// Per-mesh-name color table. Anything not listed falls back to grey wireframe.
// Strip lights stay emissive (not overridden) so they remain visible markers.
const DEBUG_COLOR_TABLE: Record<string, number> = {
  'near-terrain': 0x2266ff,    // blue
  'far-terrain': 0x22ccff,     // cyan
  'tunnel-wall': 0xff2222,     // red
  'tunnel-floor': 0xffcc22,    // yellow
  'bridge-deck': 0x22cc22,     // green
};
const DEBUG_SKIP_NAMES = new Set(['tunnel-strip-light']);

let debugWireframe = false;
const originalMaterials = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();

function applyDebugMaterial(mesh: THREE.Mesh): void {
  if (mesh.userData.debugApplied) return;
  if (DEBUG_SKIP_NAMES.has(mesh.name)) return;
  // Only override meshes we explicitly named. Touching unnamed meshes (sky
  // dome, star field, train parts) breaks systems that hold direct
  // ShaderMaterial uniform references — e.g., SkySystem.update reads
  // skyDome.material.uniforms.uTime.value every frame and would throw
  // after we swap the material to MeshBasicMaterial, freezing the loop.
  const isKnown = mesh.name in DEBUG_COLOR_TABLE;
  if (!isKnown) return;
  const color = DEBUG_COLOR_TABLE[mesh.name];
  // Wireframe everything we tag — solid debug colors would otherwise hide
  // stray faces *behind* tunnel walls (which are normally hole-punched in the
  // shader, but our MeshBasicMaterial doesn't replicate that discard).
  const dbgMat = new THREE.MeshBasicMaterial({
    color,
    wireframe: true,
    side: THREE.DoubleSide,
  });
  originalMaterials.set(mesh, mesh.material);
  mesh.material = dbgMat;
  mesh.userData.debugApplied = true;
}

function restoreOriginalMaterial(mesh: THREE.Mesh): void {
  if (!mesh.userData.debugApplied) return;
  const orig = originalMaterials.get(mesh);
  if (orig) {
    // Dispose only the per-mesh debug material we created (not the original).
    const cur = mesh.material;
    if (cur && cur !== orig) {
      if (Array.isArray(cur)) cur.forEach((m) => m.dispose());
      else cur.dispose();
    }
    mesh.material = orig;
  }
  mesh.userData.debugApplied = false;
}

function syncDebugWireframe(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    if (debugWireframe) applyDebugMaterial(obj);
    else restoreOriginalMaterial(obj);
  });
}

function init(): void {
  const { scene, camera, renderer, sunLight, ambientLight } = createScene();
  const clock = new THREE.Clock();
  const input = new InputManager();
  const cameraController = new CameraController(camera, input);

  // G key — toggle debug wireframe coloring by mesh.name
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyG') {
      debugWireframe = !debugWireframe;
      syncDebugWireframe(scene);
    }
  });

  // Build world
  const trackManager = new TrackManager(scene);
  const train = new TrainController(scene);
  const sky = new SkySystem(scene, sunLight, ambientLight, renderer);

  // Hide loading
  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.style.display = 'none';

  // Debug panel — time scrubber
  const timeSlider = document.getElementById('timeSlider') as HTMLInputElement | null;
  const timeLabel = document.getElementById('debugTimeLabel');
  const pauseCheckbox = document.getElementById('pauseTime') as HTMLInputElement | null;
  let isScrubbing = false;

  const fmtTime = (t: number): string => {
    const hours = Math.floor(t * 24);
    const mins = Math.floor((t * 24 - hours) * 60);
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };

  if (timeSlider) {
    timeSlider.addEventListener('pointerdown', () => { isScrubbing = true; });
    window.addEventListener('pointerup', () => { isScrubbing = false; });
    timeSlider.addEventListener('input', () => {
      const t = parseFloat(timeSlider.value);
      sky.setDayTime(t);
      if (timeLabel) timeLabel.textContent = fmtTime(t);
    });
  }
  if (pauseCheckbox) {
    pauseCheckbox.addEventListener('change', () => {
      sky.setPaused(pauseCheckbox.checked);
    });
  }
  document.querySelectorAll<HTMLButtonElement>('#debugPanel .presets button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = parseFloat(btn.dataset.time ?? '0');
      sky.setDayTime(t);
      if (timeSlider) timeSlider.value = String(t);
      if (timeLabel) timeLabel.textContent = fmtTime(t);
    });
  });

  // Headlight controls
  const bindRange = (
    inputId: string,
    labelId: string,
    fmt: (v: number) => string,
    apply: (v: number) => void,
  ): void => {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const label = document.getElementById(labelId);
    if (!input) return;
    if (label) label.textContent = fmt(parseFloat(input.value));
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      apply(v);
      if (label) label.textContent = fmt(v);
    });
  };
  bindRange('headlightIntensity', 'headlightIntensityLabel', (v) => String(Math.round(v)), (v) => {
    train.headlightBaseIntensity = v;
  });
  bindRange('headlightEmissive', 'headlightEmissiveLabel', (v) => v.toFixed(1), (v) => {
    train.headlightBaseEmissive = v;
  });
  bindRange('headlightAngle', 'headlightAngleLabel', (v) => String(Math.round(v)), (v) => {
    train.headlightBeam.angle = (v * Math.PI) / 180;
  });
  bindRange('headlightPenumbra', 'headlightPenumbraLabel', (v) => v.toFixed(2), (v) => {
    train.headlightBeam.penumbra = v;
  });
  bindRange('headlightDistance', 'headlightDistanceLabel', (v) => String(Math.round(v)), (v) => {
    train.headlightBeam.distance = v;
  });

  // Debug hooks for headless probing — let an external script pause time,
  // poll tunnel state, list mesh names, and selectively hide meshes by name
  // pattern to bisect what's leaving stray faces inside tunnels.
  const hiddenPatterns: string[] = [];
  function isHiddenByName(name: string): boolean {
    return hiddenPatterns.some((p) => name === p || name.startsWith(p));
  }
  function applyHidden(): void {
    scene.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh && !(obj as THREE.Group).isGroup) return;
      const m = obj as THREE.Object3D;
      if (!m.name) return;
      if (isHiddenByName(m.name)) m.visible = false;
      else if ((m as { userData?: { __forcedHidden?: boolean } }).userData?.__forcedHidden !== true) {
        m.visible = true;
      }
    });
  }
  (window as unknown as Record<string, unknown>).__debug = {
    inTunnel: () => 0,
    listMeshNames: (): Record<string, number> => {
      const counts: Record<string, number> = {};
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh || (obj as THREE.Group).isGroup) {
          const n = obj.name || '<unnamed>';
          counts[n] = (counts[n] ?? 0) + 1;
        }
      });
      return counts;
    },
    hide: (pattern: string) => {
      if (!hiddenPatterns.includes(pattern)) hiddenPatterns.push(pattern);
      applyHidden();
    },
    unhide: (pattern: string) => {
      const i = hiddenPatterns.indexOf(pattern);
      if (i >= 0) hiddenPatterns.splice(i, 1);
      applyHidden();
    },
    showAll: () => {
      hiddenPatterns.length = 0;
      applyHidden();
    },
    listHidden: () => [...hiddenPatterns],
    setDebugWireframe: (on: boolean) => {
      debugWireframe = on;
      syncDebugWireframe(scene);
    },
  };

  // Animation loop
  function animate(): void {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    const skyState = sky.update(dt);
    const trainState = train.update(dt, input, trackManager, skyState.dayTime);

    // Update track: generate ahead, cull behind
    trackManager.update(trainState.trackPosition, camera);

    // Re-apply debug coloring so newly-generated segments get tinted too.
    if (debugWireframe) syncDebugWireframe(scene);
    // Re-apply hidden so newly-generated segments respect hide patterns.
    if (hiddenPatterns.length > 0) applyHidden();

    const tunnelProximity = trackManager.getTunnelProximity(trainState.trackPosition, trainState.speed);
    (window as unknown as { __debug: { inTunnel: () => number } }).__debug.inTunnel = () => tunnelProximity;
    cameraController.update(trainState.position, trainState.direction, tunnelProximity);

    // Drive tunnel-portal point lights. Recompute the dawn/dusk night ramp
    // here (mirrors updateHeadlight in train.ts:283-295) — extracting it
    // for two callers isn't worth a refactor.
    const dt2 = skyState.dayTime;
    let nightFactor: number;
    if (dt2 < 0.2) nightFactor = 1.0;
    else if (dt2 < 0.3) nightFactor = 1.0 - (dt2 - 0.2) / 0.1;
    else if (dt2 < 0.7) nightFactor = 0;
    else if (dt2 < 0.8) nightFactor = (dt2 - 0.7) / 0.1;
    else nightFactor = 1.0;
    trackManager.updateTunnelPortalLights(trainState.position, nightFactor);

    updateHUD(trainState.speed, skyState.dayTime);

    // Sync debug slider with auto-advancing time (skip while user drags)
    if (timeSlider && !isScrubbing) {
      timeSlider.value = String(skyState.dayTime);
      if (timeLabel) timeLabel.textContent = fmtTime(skyState.dayTime);
    }

    renderer.render(scene, camera);
  }

  animate();
}

init();
