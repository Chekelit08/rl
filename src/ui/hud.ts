// Piezas del HUD que comparten el partido local (main.ts) y el online (net/online.ts):
// avisos de jugadas, medidor de turbo y tabla de puntajes.

import { icon, type IconName } from './icons.ts';

const byId = (id: string) => document.getElementById(id);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Agrega un aviso arriba a la derecha (gol, atajada, demolición…). Los nombres van en negrita con `*nombre*`. */
export function feedLine(kind: IconName, text: string, team: number) {
  const f = byId('feed');
  if (!f) return;
  const d = document.createElement('div');
  d.className = 'item t' + team;
  d.innerHTML = icon(kind, '') + `<span>${esc(text).replace(/\*([^*]+)\*/g, '<b>$1</b>')}</span>`;
  f.prepend(d);
  while (f.children.length > 5) f.lastChild?.remove();
  setTimeout(() => d.remove(), 6000);
}

export interface TurboState { boost: number; unlimited: boolean; supersonic: boolean; kmh: number; ballCam: boolean }

let turboKey = '';
/** Actualiza el medidor de turbo, la velocidad y el indicador de cámara. */
export function setTurboHud(s: TurboState) {
  const n = Math.round(s.boost);
  const key = `${n}|${s.unlimited}|${s.supersonic}|${s.kmh}|${s.ballCam}`;
  if (key === turboKey) return;
  turboKey = key;
  const box = byId('turbo'), num = byId('boostNum'), bar = byId('boostBar'), speed = byId('speedChip'), cam = byId('camChip');
  if (num) num.textContent = s.unlimited ? '∞' : String(n);
  if (bar) bar.style.setProperty('--b', (s.unlimited ? 1 : Math.max(0, Math.min(1, s.boost / 100))).toFixed(3));
  if (box) {
    box.classList.toggle('low', s.boost < 15 && !s.unlimited);
    box.classList.toggle('super', s.supersonic);
  }
  if (speed) speed.textContent = `${s.kmh} km/h`;
  if (cam) cam.textContent = s.ballCam ? 'Cámara: pelota' : 'Cámara: auto';
}

export interface ScoreRow {
  id: number; name: string; team: number; isBot: boolean;
  stats: { score: number; goals: number; assists: number; saves: number; shots: number; demos: number; touches: number };
}

/** Tabla de estadísticas por jugador, ordenada por equipo y puntaje. `mvpId` marca al mejor del partido. */
export function statsTable(rows: ScoreRow[], myId: number, opts: { touches?: boolean; mvpId?: number; bots?: boolean } = {}): string {
  const touches = opts.touches ?? true;
  const body = [...rows].sort((a, b) => a.team - b.team || b.stats.score - a.stats.score).map((c) => {
    const tags = (c.id === opts.mvpId ? '<span class="tag accent">MVP</span>' : '') + (opts.bots && c.isBot ? '<span class="tag">Bot</span>' : '');
    const s = c.stats;
    return `<tr class="t${c.team}${c.id === myId ? ' me' : ''}"><td>${esc(c.name)}${tags}</td><td>${s.score}</td><td>${s.goals}</td><td>${s.assists}</td><td>${s.saves}</td><td>${s.shots}</td><td>${s.demos}</td>${touches ? `<td>${s.touches}</td>` : ''}</tr>`;
  }).join('');
  return `<table class="stats"><tr><th>Jugador</th><th>Puntos</th><th>Goles</th><th>Asist.</th><th>Atajadas</th><th>Tiros</th><th>Demol.</th>${touches ? '<th>Toques</th>' : ''}</tr>${body}</table>`;
}

/** Contenido del panel de puntajes que se ve al mantener Tab. */
export function scorePanel(rows: ScoreRow[], myId: number, score: readonly number[], clock: string, bots = false): string {
  return `<header class="panel-head"><h2>Puntajes</h2>
      <div class="sb-score"><span class="b">${score[0]}</span><span class="c">${clock}</span><span class="r">${score[1]}</span></div></header>
    ${statsTable(rows, myId, { bots })}`;
}
