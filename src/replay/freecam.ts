// Control de cámara libre (editor y visor): WASD para moverse, Q/E para bajar y subir, Shift más rápido,
// mantener clic derecho (o izquierdo con Alt) y mover el mouse para mirar; stick derecho/izquierdo del mando.

import type { CameraController } from '../render/camera.ts';

export class FreeCamControl {
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private canvas: HTMLElement;
  private cc: CameraController;
  enabled = false;
  /** Si true, el clic izquierdo sin Alt queda libre para otras acciones (editor). */
  leftClickReserved = true;
  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled || isTyping(e)) return;
    this.keys.add(e.code);
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (e.button === 2 || e.button === 1 || (e.button === 0 && (e.altKey || !this.leftClickReserved))) {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      e.preventDefault();
    }
  };
  private onUp = () => { this.dragging = false; };
  private onMove = (e: MouseEvent) => {
    if (!this.enabled || !this.dragging) return;
    const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    this.cc.freeRotate(-dx * 0.0042, -dy * 0.0042);
  };
  private onBlur = () => { this.keys.clear(); this.dragging = false; };

  constructor(canvas: HTMLElement, cc: CameraController) {
    this.canvas = canvas;
    this.cc = cc;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    canvas.addEventListener('mousedown', this.onDown);
    window.addEventListener('mouseup', this.onUp);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('blur', this.onBlur);
  }

  get isDragging() { return this.dragging; }

  update(dt: number) {
    if (!this.enabled) return;
    const k = (c: string) => this.keys.has(c);
    const speed = (k('ShiftLeft') || k('ShiftRight') ? 3600 : 1400) * dt;
    let f = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0);
    let r = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0);
    let u = (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0);
    // Mando: stick izquierdo mueve, derecho mira, gatillos suben/bajan
    const gp = navigator.getGamepads?.().find((g) => g && g.connected);
    if (gp) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      f -= dz(gp.axes[1] ?? 0);
      r += dz(gp.axes[0] ?? 0);
      u += (gp.buttons[7]?.value ?? 0) - (gp.buttons[6]?.value ?? 0);
      this.cc.freeRotate(-dz(gp.axes[2] ?? 0) * dt * 2.4, -dz(gp.axes[3] ?? 0) * dt * 1.8);
    }
    if (f || r || u) this.cc.freeMove(f * speed, r * speed, u * speed);
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.canvas.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mouseup', this.onUp);
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('blur', this.onBlur);
  }
}

export function isTyping(e: Event) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
