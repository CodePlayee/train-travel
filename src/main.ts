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

    renderer.render(scene, camera);
  }

  animate();
}

init();
