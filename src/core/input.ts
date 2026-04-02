const CAMERA_MODES = 3;

export class InputManager {
  readonly keys: Record<string, boolean> = {};
  cameraMode = 0;

  mouseX = 0;
  mouseY = 0;
  private isMouseDown = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      if (e.code === 'KeyC') {
        this.cameraMode = (this.cameraMode + 1) % CAMERA_MODES;
      }
    });

    document.addEventListener('mousedown', () => {
      this.isMouseDown = true;
    });

    document.addEventListener('mouseup', () => {
      this.isMouseDown = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isMouseDown) {
        this.mouseX += e.movementX * 0.003;
        this.mouseY = Math.max(-0.5, Math.min(0.8, this.mouseY + e.movementY * 0.003));
      }
    });
  }
}
