// Códigos para compartir packs: JSON compacto → deflate → base64url, con prefijo "TG1-".

import { deflateRaw, fromBase64Url, inflateRaw, toBase64Url } from '../replay/format.ts';
import { CATEGORIES, DIFFICULTIES, type Pack, type Shot } from './types.ts';

const PREFIX = 'TG1-';

type Row = number[];

function shotToRow(s: Shot): Row {
  const r = (v: number) => Math.round(v);
  const row = [
    ...s.ball.p.map(r), ...s.ball.v.map(r),
    ...s.car.p.map(r), r(s.car.yaw), r(s.car.pitch ?? 0), r(s.car.roll ?? 0), r(s.car.boost ?? 100), Math.round((s.time ?? 0) * 10),
  ];
  if (s.ball.w) row.push(...s.ball.w.map((x) => Math.round(x * 100)));
  return row;
}

const clampN = (v: unknown, lo: number, hi: number, def = 0) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
  return Math.max(lo, Math.min(hi, n));
};

function rowToShot(row: Row): Shot {
  const g = (i: number, lo: number, hi: number, def = 0) => clampN(row[i], lo, hi, def);
  const shot: Shot = {
    ball: { p: [g(0, -4000, 4000), g(1, -5900, 5900), g(2, 93, 2000, 93)], v: [g(3, -6000, 6000), g(4, -6000, 6000), g(5, -6000, 6000)] },
    car: { p: [g(6, -4000, 4000), g(7, -5900, 5900), g(8, 17, 2000, 17)], yaw: g(9, -720, 720, 90), pitch: g(10, -180, 180), roll: g(11, -180, 180), boost: g(12, 0, 100, 100) },
  };
  const t = g(13, 0, 600);
  if (t > 0) shot.time = t / 10;
  if (row.length >= 17) shot.ball.w = [g(14, -600, 600) / 100, g(15, -600, 600) / 100, g(16, -600, 600) / 100];
  return shot;
}

export async function encodePack(p: Pack): Promise<string> {
  const compact = {
    n: p.name.slice(0, 60),
    a: p.author.slice(0, 30),
    c: CATEGORIES.indexOf(p.category),
    d: DIFFICULTIES.indexOf(p.difficulty),
    x: (p.description ?? '').slice(0, 200),
    s: p.shots.slice(0, 50).map(shotToRow),
    t: p.shots.slice(0, 50).map((s) => (s.note ?? '').slice(0, 60)),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  return PREFIX + toBase64Url(await deflateRaw(bytes));
}

export async function decodePack(code: string): Promise<Pack> {
  const clean = code.trim().replace(/\s+/g, '');
  if (!clean.startsWith(PREFIX)) throw new Error('El código tiene que empezar con TG1-');
  let obj: { n?: string; a?: string; c?: number; d?: number; x?: string; s?: Row[]; t?: string[] };
  try {
    const raw = await inflateRaw(fromBase64Url(clean.slice(PREFIX.length)));
    obj = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new Error('Código inválido o incompleto');
  }
  if (!Array.isArray(obj.s) || obj.s.length === 0) throw new Error('El pack no tiene tiros');
  return {
    id: 'imp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: String(obj.n ?? 'Pack importado').slice(0, 60),
    author: String(obj.a ?? 'Anónimo').slice(0, 30),
    category: CATEGORIES[clampN(obj.c, 0, 2)] ?? 'delantero',
    difficulty: DIFFICULTIES[clampN(obj.d, 0, 2)] ?? 'novato',
    description: String(obj.x ?? '').slice(0, 200),
    shots: obj.s.slice(0, 50).map((row, i) => ({ ...rowToShot(Array.isArray(row) ? row : []), note: String(obj.t?.[i] ?? '').slice(0, 60) || undefined })),
    created: Date.now(),
  };
}

// ---------- Packs propios (localStorage) ----------
const KEY = 'turbogol.packs';
const BEST_KEY = 'turbogol.packs.best';

export function loadCustomPacks(): Pack[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Pack[]) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

export function saveCustomPacks(list: Pack[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* sin almacenamiento */ }
}

export function upsertCustomPack(p: Pack) {
  const list = loadCustomPacks().filter((x) => x.id !== p.id);
  list.unshift(p);
  saveCustomPacks(list);
}

export function deleteCustomPack(id: string) {
  saveCustomPacks(loadCustomPacks().filter((x) => x.id !== id));
}

export function loadBest(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(BEST_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}

export function saveBest(packId: string, hits: number) {
  const b = loadBest();
  if ((b[packId] ?? -1) < hits) {
    b[packId] = hits;
    try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch { /* ignorar */ }
  }
}
