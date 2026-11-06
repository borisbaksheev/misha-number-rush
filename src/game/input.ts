// One-finger controls: hold anywhere to run, slide left/right to steer. Keyboard for desktop testing.
import { ROAD_WIDTH } from './course';
import type { ControlInput } from './raceLogic';

export class InputController {
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private dragPixels = 0;
  private dragPixelsY = 0;
  private keys = new Set<string>();
  /** Fraction of the screen width that sweeps across the whole road. */
  sensitivity = 0.55;
  enabled = true;
  /** Called on first touch/press (used to unlock audio and hide hints). */
  onFirstInput?: () => void;
  private touched = false;
  readonly state: ControlInput = { throttle: false, steerDelta: 0, steerAxis: 0 };

  constructor(private el: HTMLElement) {
    el.addEventListener('pointerdown', this.down, { passive: false });
    window.addEventListener('pointermove', this.move, { passive: false });
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.up);
    window.addEventListener('blur', this.release);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
  }

  get pressing(): boolean {
    return this.pointerId !== null || this.keyThrottle();
  }

  private keyThrottle(): boolean {
    return this.keys.has('ArrowUp') || this.keys.has('KeyW') || this.keys.has('Space');
  }

  private down = (e: PointerEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* not supported everywhere */
    }
    this.first();
  };

  private move = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.dragPixels += e.clientX - this.lastX;
    this.dragPixelsY += e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
  };

  private up = (e: PointerEvent) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
  };

  private release = () => {
    this.pointerId = null;
    this.keys.clear();
  };

  private keyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
      e.preventDefault();
      this.keys.add(e.code);
      this.first();
    }
  };

  private keyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private first() {
    if (!this.touched) {
      this.touched = true;
      this.onFirstInput?.();
    }
  }

  /** Read the input for this frame (consumes accumulated drag). */
  poll(): ControlInput {
    const width = Math.max(320, this.el.clientWidth);
    const s = this.state;
    s.throttle = this.enabled && this.pressing;
    s.steerDelta = this.enabled ? (this.dragPixels / (width * this.sensitivity)) * ROAD_WIDTH : 0;
    this.dragPixels = 0;
    this.dragPixelsY = 0;
    let axis = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) axis -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) axis += 1;
    s.steerAxis = this.enabled ? axis : 0;
    return s;
  }

  /**
   * Flying controls: the finger's movement as a fraction of the screen size
   * (x right, y up) plus keyboard axes. Consumes accumulated drag.
   */
  pollFlight(): { fx: number; fy: number; axisX: number; axisY: number } {
    const width = Math.max(320, this.el.clientWidth);
    const height = Math.max(320, this.el.clientHeight);
    const out = { fx: 0, fy: 0, axisX: 0, axisY: 0 };
    if (this.enabled) {
      out.fx = this.dragPixels / width;
      out.fy = -this.dragPixelsY / height;
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) out.axisX -= 1;
      if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) out.axisX += 1;
      if (this.keys.has('ArrowUp') || this.keys.has('KeyW') || this.keys.has('Space')) out.axisY += 1;
      if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) out.axisY -= 1;
    }
    this.dragPixels = 0;
    this.dragPixelsY = 0;
    return out;
  }

  reset(): void {
    this.pointerId = null;
    this.dragPixels = 0;
    this.dragPixelsY = 0;
    this.keys.clear();
  }
}
