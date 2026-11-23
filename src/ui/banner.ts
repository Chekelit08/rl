import type { BannerStyle } from '../garage/cosmetics.ts';

/** Fondo CSS de un banner de jugador. */
export function bannerBg(s: BannerStyle): string {
  const base = `linear-gradient(100deg, ${s.a}, ${s.b})`;
  switch (s.pattern) {
    case 'diagonal': return `repeating-linear-gradient(115deg, rgba(255,255,255,.07) 0 14px, transparent 14px 30px), ${base}`;
    case 'rayas': return `repeating-linear-gradient(90deg, rgba(255,255,255,.08) 0 28px, transparent 28px 56px), ${base}`;
    case 'puntos': return `radial-gradient(rgba(255,255,255,.16) 2px, transparent 3px) 0 0/18px 18px, ${base}`;
    case 'hex': return `repeating-linear-gradient(60deg, rgba(0,0,0,.14) 0 2px, transparent 2px 22px), repeating-linear-gradient(-60deg, rgba(0,0,0,.14) 0 2px, transparent 2px 22px), ${base}`;
    case 'rayo': return `linear-gradient(160deg, transparent 46%, rgba(255,255,255,.18) 47% 49%, transparent 50%), linear-gradient(20deg, transparent 60%, rgba(255,255,255,.12) 61% 62%, transparent 63%), ${base}`;
    default: return base;
  }
}
