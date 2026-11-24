// Visor de repeticiones y clips: línea de tiempo con scrub, play/pausa, velocidad 0.25×–2×,
// cámaras (director de transmisión, libre, seguir a cada jugador con cámara de pelota o de auto) y exportación a WebM.

import * as THREE from 'three';
import type { UiActions } from '../input/input.ts';
import type { CameraController } from '../render/camera.ts';
import { V3 } from '../sim/math.ts';
import type { Snapshot } from '../sim/world.ts';
import { button, download, el, esc, fmtTime } from '../training/dom.ts';
import type { ExtScreen } from '../training/extras.ts';
import type { GameHost } from '../training/host.ts';
import { canExportVideo, WebmRecorder } from './exporter.ts';
import { lerpSnapshots, readFrame, readHud, type ReplayMeta } from './format.ts';
import { FreeCamControl, isTyping } from './freecam.ts';

export interface ViewerOptions {
  exportNow?: boolean;
  onClose: () => void;
  toast: (text: string) => void;
}

type CamMode = 'director' | 'libre' | 'jugador';
const SPEEDS = [0.25, 0.5, 1, 1.5, 2];
const MATCH_EXPORT_SECONDS = 30;
const ICON_PLAY = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 2l10 6-10 6z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 2h4v12H3zM9 2h4v12H9z" fill="currentColor"/></svg>';

export class ReplayViewer implements ExtScreen {
  readonly kind = 'visor';
  readonly meta: ReplayMeta;
  private frames: Int16Array;
  private host: GameHost;
  private opts: ViewerOptions;
  t = 0;
  playing = true;
  speed = 1;
  cam: CamMode = 'director';
  carId = 0;
  ballCam = true;
  private readonly duration: number;
  private readonly isMatch: boolean;
  private prevBallCam: boolean;
  private free: FreeCamControl;
  private cc: CameraController;
  private root: HTMLDivElement;
  private range: HTMLInputElement;
  private timeLabel: HTMLElement;
  private playBtn: HTMLButtonElement;
  private scoreEl: HTMLElement;
  private camRow: HTMLDivElement;
  private speedRow: HTMLDivElement;
  private progress: HTMLDivElement;
  private exportBtn: HTMLButtonElement | null = null;
  private scrubbing = false;
  private lastIdx = -1;
  private screenKey = '';
  private uiKey = '';
  private padPrev: boolean[] = [];
  private exporting: { rec: WebmRecorder; start: number; end: number } | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(host: GameHost, data: { meta: ReplayMeta; frames: Int16Array }, opts: ViewerOptions) {
    this.host = host;
    this.meta = data.meta;
    this.frames = data.frames;
    this.opts = opts;
    this.duration = Math.max(0, (this.meta.frames - 1) / this.meta.fps);
    this.isMatch = /^\d+v\d+/.test(this.meta.mode);
    const r = host.renderer;
    r.setupCars(this.meta.cars.map((c) => ({ id: c.id, team: c.team, bodyIndex: c.bodyIndex, name: c.name })), -1);
    this.cc = r.camCtl;
    this.prevBallCam = this.cc.ballCam;
    this.cc.resetDirector();
    this.cc.customFn = (snap, dt, cc) => this.camera(snap, dt, cc);
    this.free = new FreeCamControl(r.renderer.domElement, this.cc);
    this.free.leftClickReserved = false;
    host.audio.start();

    // ---------- Interfaz ----------
    this.root = el('div', 'tg-viewer');
    const top = el('div', 'tg-vtop');
    this.scoreEl = el('div', 'tg-vscore');
    top.append(this.scoreEl, el('div', 'tg-vtitle', `${this.meta.kind === 'clip' ? 'CLIP' : 'REPETICIÓN'} · ${esc(this.meta.title)}`));
    const bar = el('div', 'tg-vbar');
    const tl = el('div', 'tg-vtimeline');
    this.range = el('input');
    this.range.type = 'range';
    this.range.min = '0';
    this.range.max = String(this.duration);
    this.range.step = '0.01';
    this.range.value = '0';
    this.range.setAttribute('aria-label', 'Línea de tiempo');
    this.range.addEventListener('input', () => { this.scrubbing = true; this.seek(Number(this.range.value)); });
    this.range.addEventListener('change', () => { this.scrubbing = false; });
    this.range.addEventListener('pointerup', () => { this.scrubbing = false; });
    const marks = el('div', 'tg-vmarks');
    for (const g of this.meta.goals) {
      const m = el('i', 'team' + g.team);
      m.style.left = `${(g.t / Math.max(0.01, this.duration)) * 100}%`;
      m.title = `Gol${g.scorer ? ' de ' + g.scorer : ''} (${fmtTime(g.t)})`;
      m.addEventListener('click', () => this.seek(Math.max(0, g.t - 4)));
      marks.appendChild(m);
    }
    tl.append(this.range, marks);

    const row = el('div', 'tg-vrow');
    this.playBtn = button(ICON_PAUSE, 'tg-vbtn tg-vplay', () => this.togglePlay());
    this.playBtn.title = 'Play / pausa (Espacio)';
    this.timeLabel = el('span', 'tg-vtime');
    const transport = el('div', 'tg-vgroup');
    transport.append(button('−5 s', 'tg-vbtn', () => this.seek(this.t - 5)), this.playBtn, button('+5 s', 'tg-vbtn', () => this.seek(this.t + 5)), this.timeLabel);
    this.speedRow = el('div', 'tg-vgroup seg');
    for (const s of SPEEDS) this.speedRow.appendChild(button(`${s}×`, '', () => { this.speed = s; this.uiKey = ''; }));
    this.camRow = el('div', 'tg-vgroup seg');
    this.buildCams();
    const right = el('div', 'tg-vgroup');
    if (canExportVideo()) {
      this.exportBtn = button(this.meta.kind === 'clip' || !this.isMatch ? 'Exportar WebM' : `Exportar ${MATCH_EXPORT_SECONDS} s (WebM)`, 'tg-vbtn accent', () => this.exportCurrent());
      right.appendChild(this.exportBtn);
    }
    right.appendChild(button('Cerrar', 'tg-vbtn', () => this.close()));
    row.append(transport, this.speedRow, this.camRow, right);
    bar.append(tl, row);
    const help = el('div', 'tg-vhelp', 'Espacio: pausa · ←/→: 5 s · −/+: velocidad · 0: director · 1–9: jugadores · C: pelota/auto · F: cámara libre (WASD, Q/E, clic derecho para mirar) · Esc: salir');
    this.progress = el('div', 'tg-vexport hidden');
    this.root.append(top, bar, help, this.progress);
    document.body.appendChild(this.root);
    window.addEventListener('keydown', this.onKey);

    this.render(0);
    if (opts.exportNow) setTimeout(() => this.exportCurrent(), 60);
  }

  // ---------- Reproducción ----------

  private snapAt(t: number): Snapshot {
    const f = Math.max(0, Math.min(this.meta.frames - 1, t * this.meta.fps));
    const i = Math.floor(f);
    const j = Math.min(this.meta.frames - 1, i + 1);
    const a = readFrame(this.frames, i, this.meta);
    if (j === i) return a;
    return lerpSnapshots(a, readFrame(this.frames, j, this.meta), f - i);
  }

  seek(t: number) {
    this.t = Math.max(0, Math.min(this.duration, t));
    this.lastIdx = -1;
    this.cc.snapTo();
  }

  togglePlay() {
    if (this.exporting) return;
    if (!this.playing && this.t >= this.duration - 0.01) this.seek(0);
    this.playing = !this.playing;
  }

  setCam(mode: CamMode, carId = this.carId) {
    if (mode === 'libre' && this.cam !== 'libre') {
      const cam = this.cc.cam;
      const dir = cam.getWorldDirection(new THREE.Vector3());
      this.cc.freeLookAt(cam.position.clone(), cam.position.clone().add(dir));
    }
    if (mode === 'director') this.cc.resetDirector();
    this.cam = mode;
    this.carId = carId;
    this.free.enabled = mode === 'libre';
    this.cc.snapTo();
    this.uiKey = '';
  }

  private camera(snap: Snapshot, dt: number, cc: CameraController) {
    if (this.cam === 'libre') { cc.applyFree(dt); return; }
    if (this.cam === 'jugador') {
      const car = snap.cars.find((c) => c.id === this.carId);
      if (car && !car.demoed) {
        cc.ballCam = this.ballCam;
        cc.follow(car, snap.ball, dt);
        return;
      }
    }
    cc.director(snap, dt, -1);
  }

  frame(dt: number) {
    this.pollPad();
    this.free.update(dt);
    let adv = 0;
    if (this.playing && !this.scrubbing) {
      adv = dt * this.speed;
      this.t += adv;
      if (this.t >= this.duration) {
        this.t = this.duration;
        if (this.exporting) void this.finishExport(false);
        else this.playing = false;
      }
    }
    if (this.exporting && this.t >= this.exporting.end) void this.finishExport(false);
    this.render(adv);
  }

  private render(adv: number) {
    const snap = this.snapAt(this.t);
    const idx = Math.floor(this.t * this.meta.fps);
    this.events(idx, snap);
    this.host.renderer.render(snap, adv, 'custom');
    this.updateUi(idx, snap);
  }

  /** Sonidos y partículas a partir de los cuadros (goles, toques y piques). */
  private events(idx: number, snap: Snapshot) {
    const r = this.host.renderer, audio = this.host.audio;
    const focus = this.cam === 'jugador' ? snap.cars.find((c) => c.id === this.carId) : null;
    const car = focus ?? snap.cars.reduce<Snapshot['cars'][number] | null>((best, c) => {
      const d = Math.hypot(c.x - snap.ball.x, c.y - snap.ball.y);
      return !best || d < Math.hypot(best.x - snap.ball.x, best.y - snap.ball.y) ? c : best;
    }, null);
    if (car && this.playing) audio.updateCar(Math.hypot(car.vx, car.vy, car.vz), car.boosting, car.supersonic, car.onGround, true);
    else audio.updateCar(0, false, false, true, false);
    if (!this.playing || this.lastIdx < 0 || idx <= this.lastIdx || idx - this.lastIdx > 8) { this.lastIdx = idx; return; }
    const g = 650 / this.meta.fps;
    for (let k = this.lastIdx + 1; k <= idx; k++) {
      const a = readFrame(this.frames, k - 1, this.meta), b = readFrame(this.frames, k, this.meta);
      const ha = readHud(this.frames, k - 1, this.meta), hb = readHud(this.frames, k, this.meta);
      if (hb.score[0] !== ha.score[0] || hb.score[1] !== ha.score[1]) {
        const team = hb.score[0] !== ha.score[0] ? 0 : 1;
        r.onEvent({ type: 'goal', team, scorerId: -1, assistId: -1, speed: 0, pos: new V3(a.ball.x, a.ball.y, a.ball.z) }, b);
        audio.goal();
      }
      if (a.ball.hidden || b.ball.hidden) continue;
      const dv = Math.hypot(b.ball.vx - a.ball.vx, b.ball.vy - a.ball.vy, b.ball.vz - (a.ball.vz - g));
      if (dv < 220) continue;
      let near = -1, nd = Infinity;
      for (const c of b.cars) {
        const d = Math.hypot(c.x - b.ball.x, c.y - b.ball.y, c.z - b.ball.z);
        if (d < nd) { nd = d; near = c.id; }
      }
      const pos = new V3(b.ball.x, b.ball.y, b.ball.z);
      if (nd < 280) {
        r.onEvent({ type: 'hit', carId: near, strength: dv, pos }, b);
        audio.hit(dv, true);
      } else if (dv > 300) audio.bounce(dv);
    }
    this.lastIdx = idx;
  }

  private updateUi(idx: number, snap: Snapshot) {
    const hud = readHud(this.frames, Math.min(this.meta.frames - 1, Math.max(0, idx)), this.meta);
    const clock = this.isMatch ? `${hud.overtime ? '+' : ''}${fmtTime(hud.overtime ? Math.floor(hud.clock) : Math.ceil(hud.clock))}` : '∞';
    const sk = `${hud.score[0]}|${hud.score[1]}|${clock}`;
    if (sk !== this.screenKey) {
      this.screenKey = sk;
      this.host.renderer.stadium.updateScreens(hud.score, clock);
      this.scoreEl.innerHTML = `<span class="b">${hud.score[0]}</span><span class="c">${clock}</span><span class="r">${hud.score[1]}</span>`;
    }
    if (!this.scrubbing) this.range.value = String(this.t);
    this.range.style.setProperty('--p', `${(this.t / Math.max(0.01, this.duration)) * 100}%`);
    this.timeLabel.textContent = `${fmtTime(this.t)} / ${fmtTime(this.duration)}`;
    const key = `${this.playing}|${this.speed}|${this.cam}|${this.carId}|${this.ballCam}`;
    if (key !== this.uiKey) {
      this.uiKey = key;
      this.playBtn.innerHTML = this.playing ? ICON_PAUSE : ICON_PLAY;
      this.playBtn.dataset.state = this.playing ? 'reproduciendo' : 'pausa';
      this.playBtn.setAttribute('aria-label', this.playing ? 'Pausa' : 'Reproducir');
      this.speedRow.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', SPEEDS[i] === this.speed));
      this.camRow.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
        const m = b.dataset.cam, id = Number(b.dataset.car ?? -1);
        b.classList.toggle('on', m === this.cam && (m !== 'jugador' || id === this.carId));
        if (b.dataset.cam === 'toggle') b.textContent = this.ballCam ? 'Cám. pelota' : 'Cám. auto';
      });
    }
    void snap;
  }

  private buildCams() {
    const add = (label: string, cam: string, car = -1, cls = '') => {
      const b = button(label, cls, () => {
        if (cam === 'toggle') { this.ballCam = !this.ballCam; this.uiKey = ''; this.cc.snapTo(); return; }
        this.setCam(cam as CamMode, car);
      });
      b.dataset.cam = cam;
      if (car >= 0) b.dataset.car = String(car);
      this.camRow.appendChild(b);
    };
    add('Director', 'director');
    add('Libre', 'libre');
    for (const c of this.meta.cars) add(c.name, 'jugador', c.id, 'team' + c.team);
    add('Cám. pelota', 'toggle', -1, 'tg-vtoggle');
  }

  // ---------- Entrada ----------

  handleUi(ui: UiActions) {
    if (ui.pause) {
      if (this.exporting) void this.finishExport(true);
      else this.close();
    }
    if (ui.ballCamToggle && this.cam === 'jugador') { this.ballCam = !this.ballCam; this.uiKey = ''; }
  }

  private key(e: KeyboardEvent) {
    if (isTyping(e) || e.repeat) return;
    const c = e.code;
    if (c === 'Space') { e.preventDefault(); this.togglePlay(); }
    else if (c === 'ArrowLeft') this.seek(this.t - 5);
    else if (c === 'ArrowRight') this.seek(this.t + 5);
    else if (c === 'Minus' || c === 'NumpadSubtract') this.stepSpeed(-1);
    else if (c === 'Equal' || c === 'NumpadAdd') this.stepSpeed(1);
    else if (c === 'Digit0' || c === 'Numpad0') this.setCam('director');
    else if (c === 'KeyF') this.setCam(this.cam === 'libre' ? 'director' : 'libre');
    else {
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(c);
      if (m) {
        const car = this.meta.cars[Number(m[1]) - 1];
        if (car) this.setCam('jugador', car.id);
      }
    }
  }

  private stepSpeed(d: number) {
    const i = SPEEDS.indexOf(this.speed);
    this.speed = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 2 : i) + d))];
  }

  /** Mando: A play/pausa, LB/RB ±5 s, D-pad ←/→ cambia de cámara, gatillos velocidad. */
  private pollPad() {
    const gp = navigator.getGamepads?.().find((g) => g && g.connected);
    if (!gp) return;
    const just = (i: number) => !!gp.buttons[i]?.pressed && !this.padPrev[i];
    if (just(0)) this.togglePlay();
    if (just(4)) this.seek(this.t - 5);
    if (just(5)) this.seek(this.t + 5);
    if (just(14) || just(15)) {
      const order: [CamMode, number][] = [['director', -1], ...this.meta.cars.map((c) => ['jugador', c.id] as [CamMode, number]), ['libre', -1]];
      const cur = order.findIndex(([m, id]) => m === this.cam && (m !== 'jugador' || id === this.carId));
      const n = order[(cur + (just(15) ? 1 : -1) + order.length) % order.length];
      this.setCam(n[0], n[1] < 0 ? this.carId : n[1]);
    }
    if (just(12)) this.stepSpeed(1);
    if (just(13)) this.stepSpeed(-1);
    this.padPrev = gp.buttons.map((x) => x.pressed);
  }

  // ---------- Exportación ----------

  private exportCurrent() {
    if (this.exporting) return;
    const whole = this.meta.kind === 'clip' || !this.isMatch;
    const start = whole ? 0 : Math.min(this.t, Math.max(0, this.duration - 1));
    const end = whole ? this.duration : Math.min(this.duration, start + MATCH_EXPORT_SECONDS);
    if (end - start < 0.5) { this.opts.toast('No hay nada para exportar'); return; }
    let rec: WebmRecorder;
    try {
      rec = new WebmRecorder(this.host.renderer.renderer.domElement, this.host.audio, 60);
    } catch {
      this.opts.toast('Tu navegador no permite exportar video');
      return;
    }
    this.seek(start);
    if (this.cam === 'director') this.cc.resetDirector();
    this.speed = 1;
    this.playing = true;
    this.exporting = { rec, start, end };
    this.root.classList.add('exporting');
    this.progress.classList.remove('hidden');
    this.progress.innerHTML = 'Exportando video…';
    rec.start();
    const tick = () => {
      if (!this.exporting) return;
      const p = (this.t - start) / Math.max(0.01, end - start);
      this.progress.innerHTML = `● GRABANDO VIDEO ${Math.round(p * 100)}%<small>${rec.hasAudio ? 'con audio · ' : ''}Esc para cancelar</small>`;
      setTimeout(tick, 200);
    };
    tick();
  }

  private async finishExport(cancel: boolean) {
    const ex = this.exporting;
    if (!ex) return;
    this.exporting = null;
    this.playing = false;
    const blob = await ex.rec.stop();
    this.root.classList.remove('exporting');
    this.progress.classList.add('hidden');
    if (cancel) { this.opts.toast('Exportación cancelada'); return; }
    const d = new Date(this.meta.date);
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    download(blob, `turbogol-${this.meta.kind}-${stamp}.webm`);
    this.opts.toast(`Video exportado (${(blob.size / 1e6).toFixed(1)} MB${ex.rec.hasAudio ? ', con audio' : ''})`);
  }

  close() {
    if (this.exporting) void this.finishExport(true);
    this.opts.onClose();
  }

  dispose() {
    if (this.exporting) void this.finishExport(true);
    window.removeEventListener('keydown', this.onKey);
    this.free.enabled = false;
    this.free.dispose();
    this.cc.customFn = null;
    this.cc.ballCam = this.prevBallCam;
    this.cc.snapTo();
    this.host.audio.updateCar(0, false, false, true, false);
    this.root.remove();
  }
}
