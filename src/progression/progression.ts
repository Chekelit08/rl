// Perfil del jugador: XP, niveles, estadísticas de carrera y desbloqueos. Todo local (localStorage con try/catch).

import { allItems, isUnlocked, type Item } from '../garage/cosmetics.ts';

export interface CareerStats {
  matches: number; wins: number; losses: number; draws: number;
  goals: number; assists: number; saves: number; epicSaves: number; shots: number; demos: number;
  mvps: number; clears: number; centers: number; aerialHits: number; firstTouches: number;
  secondsPlayed: number; fastestGoalKmh: number;
}

export interface MatchSummary {
  date: string; playlist: string; won: boolean; score: [number, number]; myScore: number; goals: number; saves: number; mvp: boolean; xp: number;
}

export interface Profile {
  name: string;
  xp: number; // XP total acumulada
  stats: CareerStats;
  lastPlayDay: string;
  history: MatchSummary[];
  /** Mejor tier alcanzado en ranked (para desbloqueos), -1 = ninguno. */
  bestTier: number;
}

const EMPTY_STATS: CareerStats = {
  matches: 0, wins: 0, losses: 0, draws: 0, goals: 0, assists: 0, saves: 0, epicSaves: 0, shots: 0, demos: 0,
  mvps: 0, clears: 0, centers: 0, aerialHits: 0, firstTouches: 0, secondsPlayed: 0, fastestGoalKmh: 0,
};

const KEY = 'turbogol.profile';
let cached: Profile | null = null;

export function getProfile(): Profile {
  if (cached) return cached;
  let p: Profile = { name: 'Vos', xp: 0, stats: { ...EMPTY_STATS }, lastPlayDay: '', history: [], bestTier: -1 };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const j = JSON.parse(raw);
      p = { ...p, ...j, stats: { ...EMPTY_STATS, ...(j.stats ?? {}) }, history: Array.isArray(j.history) ? j.history : [] };
    }
  } catch { /* sin almacenamiento */ }
  cached = p;
  return p;
}

export function saveProfile(p: Profile) {
  cached = p;
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignorar */ }
}

export function setPlayerName(name: string) {
  const p = getProfile();
  p.name = (name.trim() || 'Vos').slice(0, 16);
  saveProfile(p);
}

// ---------- Niveles ----------
/** XP necesaria para pasar del nivel n al n+1. */
export const xpForLevel = (n: number) => 400 + 100 * (n - 1);

export function levelInfo(totalXp: number) {
  let level = 1, rest = totalXp;
  while (rest >= xpForLevel(level)) { rest -= xpForLevel(level); level++; }
  return { level, into: rest, need: xpForLevel(level), frac: rest / xpForLevel(level) };
}

export function currentLevel() { return levelInfo(getProfile().xp).level; }

// ---------- Resultado de partido ----------
export interface MatchResult {
  playlist: string; // 'Casual 2v2', 'Ranked 1v1', etc.
  won: boolean;
  draw: boolean;
  completed: boolean; // false si abandonó
  score: [number, number];
  myScore: number;
  mvp: boolean;
  seconds: number;
  stats: Partial<CareerStats>;
  fastestGoalKmh: number;
}

export interface XpLine { label: string; xp: number }
export interface XpReport {
  lines: XpLine[];
  total: number;
  before: ReturnType<typeof levelInfo>;
  after: ReturnType<typeof levelInfo>;
  unlocks: { cat: string; item: Item<string> }[];
}

const today = () => new Date().toISOString().slice(0, 10);

export function recordMatch(r: MatchResult): XpReport {
  const p = getProfile();
  const before = levelInfo(p.xp);
  const lines: XpLine[] = [];
  if (r.completed) {
    lines.push({ label: 'Partido completo', xp: 120 });
    if (r.won) lines.push({ label: 'Victoria', xp: 120 });
    const sx = Math.floor(r.myScore * 0.3);
    if (sx > 0) lines.push({ label: `Puntaje (${r.myScore})`, xp: sx });
    if (r.mvp) lines.push({ label: 'MVP', xp: 50 });
    if (p.lastPlayDay !== today()) lines.push({ label: 'Primer partido del día', xp: 200 });
  } else {
    lines.push({ label: 'Partido abandonado', xp: 0 });
  }
  const total = lines.reduce((a, l) => a + l.xp, 0);
  p.xp += total;
  if (r.completed) p.lastPlayDay = today();
  const s = p.stats;
  s.matches++;
  if (r.draw) s.draws++; else if (r.won) s.wins++; else s.losses++;
  for (const [k, v] of Object.entries(r.stats)) (s as unknown as Record<string, number>)[k] += v ?? 0;
  if (r.mvp) s.mvps++;
  s.secondsPlayed += r.seconds;
  s.fastestGoalKmh = Math.max(s.fastestGoalKmh, r.fastestGoalKmh);
  p.history.unshift({ date: new Date().toISOString(), playlist: r.playlist, won: r.won, score: r.score, myScore: r.myScore, goals: r.stats.goals ?? 0, saves: r.stats.saves ?? 0, mvp: r.mvp, xp: total });
  p.history = p.history.slice(0, 25);
  saveProfile(p);
  const after = levelInfo(p.xp);
  const unlocks = after.level > before.level
    ? allItems().filter(({ item }) => item.unlock.level !== undefined && item.unlock.level > before.level && item.unlock.level <= after.level)
    : [];
  return { lines, total, before, after, unlocks };
}

/** Registra un nuevo mejor tier y devuelve los cosméticos que se desbloquean por rango. */
export function recordTier(tier: number): { cat: string; item: Item<string> }[] {
  const p = getProfile();
  if (tier <= p.bestTier) return [];
  const prev = p.bestTier;
  p.bestTier = tier;
  saveProfile(p);
  return allItems().filter(({ item }) => item.unlock.tier !== undefined && item.unlock.tier > prev && item.unlock.tier <= tier);
}

export function unlocked(u: Item<string>['unlock']): boolean {
  const p = getProfile();
  return isUnlocked(u, levelInfo(p.xp).level, p.bestTier);
}
