// Vibración del mando (Gamepad API): vibrationActuator (dual-rumble) con respaldo a hapticActuators.

interface DualRumble {
  playEffect: (type: string, params: { duration: number; strongMagnitude: number; weakMagnitude: number; startDelay?: number }) => Promise<unknown>;
}
interface HapticActuator { pulse: (value: number, duration: number) => Promise<unknown> }

export class Haptics {
  enabled = true;
  private busyUntil = 0;
  private busyStrength = 0;

  /** strong/weak 0..1, ms duración. Un efecto más fuerte interrumpe a uno más débil. */
  rumble(strong: number, weak: number, ms: number) {
    if (!this.enabled || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const now = performance.now();
    const power = Math.max(strong, weak);
    if (now < this.busyUntil && power < this.busyStrength) return;
    this.busyUntil = now + ms;
    this.busyStrength = power;
    for (const gp of navigator.getGamepads()) {
      if (!gp || !gp.connected) continue;
      const va = (gp as unknown as { vibrationActuator?: DualRumble }).vibrationActuator;
      if (va?.playEffect) {
        va.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
        continue;
      }
      const ha = (gp as unknown as { hapticActuators?: HapticActuator[] }).hapticActuators;
      ha?.[0]?.pulse(Math.min(1, power), ms).catch(() => {});
    }
  }

  ballHit(strength: number) {
    const k = Math.min(1, strength / 3500);
    this.rumble(0.15 + 0.6 * k, 0.3 + 0.5 * k, 60 + 90 * k);
  }
  landing(intensity: number) { if (intensity > 0.25) this.rumble(0.3 * intensity, 0.5 * intensity, 70); }
  bump() { this.rumble(0.6, 0.5, 140); }
  demo(victim: boolean) { this.rumble(victim ? 1 : 0.7, victim ? 1 : 0.6, victim ? 450 : 220); }
  goal(ours: boolean) { this.rumble(ours ? 0.6 : 0.3, ours ? 0.9 : 0.4, ours ? 700 : 300); }
  boostPad(big: boolean) { if (big) this.rumble(0.05, 0.25, 60); }
}
