// Ranked offline: MMR con Glicko-2, rangos propios con divisiones y 10 partidas de clasificación por playlist.
// La dificultad de los bots se ajusta según el MMR del jugador.

export type Playlist = '1v1' | '2v2' | '3v3';
export const PLAYLISTS: { id: Playlist; name: string; teamSize: number }[] = [
  { id: '1v1', name: 'Duelo 1v1', teamSize: 1 },
  { id: '2v2', name: 'Dobles 2v2', teamSize: 2 },
  { id: '3v3', name: 'Estándar 3v3', teamSize: 3 },
];

export const TIER_NAMES = ['Bronce', 'Plata', 'Oro', 'Platino', 'Diamante', 'Élite', 'Maestro', 'Ícono'] as const;
export const TIER_COLORS = ['#b8743f', '#b9c4cf', '#e8b931', '#46c7c0', '#5b9cff', '#b05cff', '#ff4f7a', '#ffe9a8'] as const;
const SUB_SPAN = [60, 60, 70, 70, 80, 90, 100]; // MMR por subnivel (I, II, III) de cada tier
export const PLACEMENT_MATCHES = 10;
const ROMAN = ['I', 'II', 'III', 'IV'];

export interface Rating { r: number; rd: number; vol: number; played: number; wins: number; streak: number; peak: number }
export type RankedState = Record<Playlist, Rating>;

const START: Rating = { r: 600, rd: 200, vol: 0.06, played: 0, wins: 0, streak: 0, peak: 600 };
const MIN_RD = 50;
const KEY = 'turbogol.ranked';

// ---------- Tabla de rangos ----------
interface Band { tier: number; sub: number; lo: number; hi: number }
const BANDS: Band[] = (() => {
  const out: Band[] = [];
  let lo = -Infinity, acc = 0;
  for (let t = 0; t < SUB_SPAN.length; t++) {
    for (let s = 0; s < 3; s++) {
      const hi = acc + SUB_SPAN[t];
      out.push({ tier: t, sub: s, lo: out.length === 0 ? -Infinity : lo, hi });
      lo = hi;
      acc = hi;
    }
  }
  out.push({ tier: 7, sub: 0, lo, hi: Infinity });
  return out;
})();
export const ICON_MMR = BANDS[BANDS.length - 1].lo;

export interface Rank { tier: number; sub: number; division: number; name: string; short: string; frac: number; lo: number; hi: number; placed: boolean }

export function rankFor(r: number, placed = true): Rank {
  const b = BANDS.find((x) => r >= x.lo && r < x.hi) ?? BANDS[BANDS.length - 1];
  if (b.tier === 7) return { tier: 7, sub: 0, division: 0, name: 'Ícono', short: 'Ícono', frac: 1, lo: b.lo, hi: b.hi, placed };
  const lo = Number.isFinite(b.lo) ? b.lo : b.hi - SUB_SPAN[0];
  const span = b.hi - lo;
  const pos = Math.max(0, Math.min(0.9999, (r - lo) / span));
  const division = Math.floor(pos * 4);
  const name = `${TIER_NAMES[b.tier]} ${ROMAN[b.sub]}`;
  return { tier: b.tier, sub: b.sub, division, name, short: `${name} · Div. ${ROMAN[division]}`, frac: pos * 4 - division, lo, hi: b.hi, placed };
}

// ---------- Persistencia ----------
let cached: RankedState | null = null;
export function getRanked(): RankedState {
  if (cached) return cached;
  const s: RankedState = { '1v1': { ...START }, '2v2': { ...START }, '3v3': { ...START } };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw);
      for (const p of ['1v1', '2v2', '3v3'] as Playlist[]) if (j[p]) s[p] = { ...START, ...j[p] };
    }
  } catch { /* sin almacenamiento */ }
  cached = s;
  return s;
}
function save(s: RankedState) {
  cached = s;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignorar */ }
}

export function isPlaced(p: Playlist) { return getRanked()[p].played >= PLACEMENT_MATCHES; }

// ---------- Glicko-2 ----------
const SCALE = 173.7178;
const TAU = 0.5;
const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const expect = (mu: number, muj: number, phij: number) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));

/** Actualiza un rating contra un rival (r, rd) con resultado s ∈ {0, 0.5, 1}. Implementación estándar de Glicko-2. */
export function glicko2(me: { r: number; rd: number; vol: number }, opp: { r: number; rd: number }, s: number) {
  const mu = (me.r - 1500) / SCALE, phi = me.rd / SCALE;
  const muj = (opp.r - 1500) / SCALE, phij = opp.rd / SCALE;
  const gj = g(phij), E = expect(mu, muj, phij);
  const v = 1 / (gj * gj * E * (1 - E));
  const delta = v * gj * (s - E);
  // Volatilidad (método iterativo de Illinois)
  const a = Math.log(me.vol * me.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU);
  };
  let A = a, B: number;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else { let k = 1; while (f(a - k * TAU) < 0) k++; B = a - k * TAU; }
  let fA = f(A), fB = f(B);
  for (let i = 0; i < 60 && Math.abs(B - A) > 1e-6; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const vol = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * gj * (s - E);
  return { r: muNew * SCALE + 1500, rd: phiNew * SCALE, vol };
}

// ---------- Bots según MMR ----------
/** MMR estimado de cada dificultad de bot (escala propia). */
export const BOT_MMR = [300, 750, 1200];

/** Dificultad de un bot para un jugador con MMR r (mezcla aleatoria alrededor del nivel). */
export function botDifficultyFor(r: number, rand: () => number): 0 | 1 | 2 {
  if (r <= BOT_MMR[0]) return 0;
  if (r < BOT_MMR[1]) return rand() < (r - BOT_MMR[0]) / (BOT_MMR[1] - BOT_MMR[0]) ? 1 : 0;
  if (r < BOT_MMR[2]) return rand() < (r - BOT_MMR[1]) / (BOT_MMR[2] - BOT_MMR[1]) ? 2 : 1;
  return 2;
}

export interface RankedOutcome {
  playlist: Playlist;
  before: Rank; after: Rank;
  rBefore: number; rAfter: number;
  placementDone: boolean; // se completaron las clasificatorias en este partido
  placementsLeft: number;
  tierUp: boolean; tierDown: boolean; divUp: boolean; divDown: boolean;
}

/** Registra un partido ranked. oppDifficulties: dificultades de los bots rivales. */
export function recordRanked(p: Playlist, result: 0 | 0.5 | 1, oppDifficulties: number[]): RankedOutcome {
  const st = getRanked();
  const me = st[p];
  const wasPlaced = me.played >= PLACEMENT_MATCHES;
  const before = rankFor(me.r, wasPlaced);
  const rBefore = me.r;
  const oppR = oppDifficulties.length ? oppDifficulties.reduce((a, d) => a + BOT_MMR[d], 0) / oppDifficulties.length : me.r;
  const upd = glicko2(me, { r: oppR, rd: 80 }, result);
  me.r = upd.r;
  me.rd = Math.max(MIN_RD, upd.rd);
  me.vol = Math.min(0.09, upd.vol);
  me.played++;
  if (result === 1) { me.wins++; me.streak = me.streak >= 0 ? me.streak + 1 : 1; } else if (result === 0) me.streak = me.streak <= 0 ? me.streak - 1 : -1;
  me.peak = Math.max(me.peak, me.r);
  save(st);
  const placed = me.played >= PLACEMENT_MATCHES;
  const after = rankFor(me.r, placed);
  const ordBefore = before.tier * 12 + before.sub * 4 + before.division;
  const ordAfter = after.tier * 12 + after.sub * 4 + after.division;
  return {
    playlist: p, before, after, rBefore, rAfter: me.r,
    placementDone: !wasPlaced && placed,
    placementsLeft: Math.max(0, PLACEMENT_MATCHES - me.played),
    tierUp: placed && wasPlaced && (after.tier > before.tier || (after.tier === before.tier && after.sub > before.sub)),
    tierDown: placed && wasPlaced && (after.tier < before.tier || (after.tier === before.tier && after.sub < before.sub)),
    divUp: placed && wasPlaced && ordAfter > ordBefore,
    divDown: placed && wasPlaced && ordAfter < ordBefore,
  };
}

export function bestTier(): number {
  const st = getRanked();
  let best = -1;
  for (const p of ['1v1', '2v2', '3v3'] as Playlist[]) if (st[p].played >= PLACEMENT_MATCHES) best = Math.max(best, rankFor(st[p].r).tier);
  return best;
}
