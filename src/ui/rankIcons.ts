// Íconos SVG propios de los rangos (escudos con emblema por tier y pips de subnivel).

import { TIER_COLORS, TIER_NAMES } from '../progression/ranked.ts';

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

const SHIELD = 'M50 6 L88 18 L88 52 C88 74 70 90 50 98 C30 90 12 74 12 52 L12 18 Z';
const SHIELD_WIDE = 'M50 4 L94 16 L90 54 C86 76 68 90 50 98 C32 90 14 76 10 54 L6 16 Z';

function emblem(tier: number, c: string, dark: string): string {
  const chev = (y: number) => `<path d="M30 ${y} L50 ${y - 14} L70 ${y} L70 ${y + 8} L50 ${y - 6} L30 ${y + 8} Z" fill="${c}"/>`;
  switch (tier) {
    case 0: return chev(58);
    case 1: return chev(50) + chev(66);
    case 2: return chev(44) + chev(58) + chev(72);
    case 3: return `<path d="M50 24 L58 46 L80 50 L58 56 L50 80 L42 56 L20 50 L42 46 Z" fill="${c}"/><circle cx="50" cy="50" r="5" fill="${dark}"/>`;
    case 4: return `<path d="M30 40 L40 26 L60 26 L70 40 L50 78 Z" fill="${c}"/><path d="M30 40 L70 40 M40 26 L50 40 L60 26 M50 40 L50 78" stroke="${dark}" stroke-width="2" fill="none" opacity=".55"/>`;
    case 5: return `<path d="M50 24 L74 38 L74 62 L50 76 L26 62 L26 38 Z" fill="${c}"/><path d="M50 34 L66 43 L66 58 L50 67 L34 58 L34 43 Z" fill="${dark}" opacity=".6"/><path d="M14 40 L26 46 L26 56 L16 60 Z M86 40 L74 46 L74 56 L84 60 Z" fill="${c}"/>`;
    case 6: return `<path d="M24 66 L28 34 L40 48 L50 28 L60 48 L72 34 L76 66 Z" fill="${c}"/><rect x="24" y="68" width="52" height="7" rx="2" fill="${c}"/><circle cx="50" cy="56" r="4" fill="${dark}"/>`;
    default: return `<g fill="${c}"><path d="M50 14 L58 40 L86 40 L63 56 L72 84 L50 67 L28 84 L37 56 L14 40 L42 40 Z"/></g><circle cx="50" cy="50" r="46" fill="none" stroke="${c}" stroke-width="2" stroke-dasharray="3 5" opacity=".8"/>`;
  }
}

/** SVG de un rango. sub: 0..2 (I–III) para los pips; -1 oculta los pips. */
export function rankIcon(tier: number, sub = -1, size = 64, id = ''): string {
  const t = Math.max(0, Math.min(7, tier));
  const c = TIER_COLORS[t];
  const dark = shade(c, 0.25);
  const gid = `rg${t}${id}`;
  const shape = t >= 5 ? SHIELD_WIDE : SHIELD;
  const pips = sub >= 0 && t < 7
    ? [0, 1, 2].map((i) => `<circle cx="${38 + i * 12}" cy="90" r="3.4" fill="${i <= sub ? '#fff' : 'rgba(255,255,255,.18)'}"/>`).join('')
    : '';
  const glow = t >= 5 ? `<filter id="${gid}f"><feGaussianBlur stdDeviation="2.4"/></filter><path d="${shape}" fill="${c}" opacity=".55" filter="url(#${gid}f)"/>` : '';
  return `<svg class="rank-icon" viewBox="0 0 100 104" width="${size}" height="${size * 1.04}" role="img" aria-label="${TIER_NAMES[t]}">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${shade(c, 1.25)}"/><stop offset=".55" stop-color="${c}"/><stop offset="1" stop-color="${shade(c, 0.55)}"/></linearGradient></defs>
    ${glow}
    <path d="${shape}" fill="${shade(c, 0.3)}"/>
    <path d="${shape}" fill="url(#${gid})" transform="translate(50 52) scale(.9) translate(-50 -52)" opacity=".9"/>
    <path d="${shape}" fill="${shade(c, 0.22)}" transform="translate(50 52) scale(.74) translate(-50 -52)"/>
    ${emblem(t, shade(c, 1.35), dark)}${pips}
  </svg>`;
}
