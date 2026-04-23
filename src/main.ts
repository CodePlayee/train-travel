import * as THREE from 'three';
import './style.css';
import { createScene } from './core/scene';
import { InputManager } from './core/input';
import { CameraController } from './core/camera';
import { TrackManager } from './world/trackManager';
import { SkySystem } from './world/sky';
import { TrainController } from './train/train';
import { updateHUD } from './hud';

function init(): void {
  const { scene, camera, renderer, sunLight, ambientLight } = createScene();
  const clock = new THREE.Clock();
  const input = new InputManager();
  const cameraController = new CameraController(camera, input);

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

  // Animation loop
  function animate(): void {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    const skyState = sky.update(dt);
    const trainState = train.update(dt, input, trackManager, skyState.dayTime);

    // Update track: generate ahead, cull behind
    trackManager.update(trainState.trackPosition, camera);

    const tunnelProximity = trackManager.getTunnelProximity(trainState.trackPosition, trainState.speed);
    cameraController.update(trainState.position, trainState.direction, tunnelProximity);
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
