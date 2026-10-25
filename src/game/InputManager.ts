export class InputManager {
  keys = new Set<string>();
  pressed = new Set<string>();
  primary = false;
  secondary = false;
  mouseX = 0;
  mouseY = 0;
  wheelDelta = 0;
  active = false;
  private dragging = false;
  private chargeHeld = false;
  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (
        [
          "Space",
          "CapsLock",
          "KeyW",
          "KeyA",
          "KeyS",
          "KeyD",
          "ArrowUp",
          "ArrowDown",
          "ArrowLeft",
          "ArrowRight",
          "F5",
          "F11",
        ].includes(e.code)
      )
        e.preventDefault();
      if (e.code === "KeyT" && this.active && !e.repeat) this.chargeHeld = true;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => {
      this.keys.delete(e.code);
      if (e.code === "KeyT") {
        if (this.chargeHeld && this.active) this.pressed.add("ChargeRelease");
        this.chargeHeld = false;
      }
    });
    window.addEventListener("blur", () => this.reset());
    canvas.addEventListener("mousedown", (e) => {
      if (!this.active) return;
      if (e.button === 0) {
        this.primary = true;
        this.pressed.add("Attack");
      }
      if (e.button === 2) {
        if (!this.secondary) this.pressed.add("Block");
        this.secondary = true;
        this.dragging = true;
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.primary = false;
      if (e.button === 2) {
        this.secondary = false;
        this.dragging = false;
      }
    });
    canvas.addEventListener(
      "wheel",
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        this.wheelDelta += Math.max(-120, Math.min(120, e.deltaY));
      },
      { passive: false },
    );
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("mousemove", (e) => {
      if (
        this.active &&
        (this.dragging || document.pointerLockElement === canvas)
      ) {
        this.mouseX += e.movementX;
        this.mouseY += e.movementY;
      }
    });
    canvas.addEventListener("dblclick", () => {
      if (this.active) canvas.requestPointerLock?.()?.catch(() => {});
    });
  }
  down(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }
  take(code: string) {
    const value = this.pressed.has(code);
    this.pressed.delete(code);
    return value;
  }
  endFrame() {
    this.pressed.clear();
    this.mouseX = 0;
    this.mouseY = 0;
    this.wheelDelta = 0;
  }
  reset() {
    this.keys.clear();
    this.pressed.clear();
    this.primary = false;
    this.secondary = false;
    this.dragging = false;
    this.chargeHeld = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.wheelDelta = 0;
  }
}
