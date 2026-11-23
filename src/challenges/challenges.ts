// Desafíos: menú, aros 3D, cronómetro, medallas y récords. La lógica vive en courses.ts.

import * as THREE from 'three';
import './challenges.css';
import type { GameRenderer } from '../render/renderer.ts';
import type { MatchConfig, World } from '../sim/world.ts';
import { ChallengeRun, type Course, COURSES, fmtTime, loadBests, MEDAL_NAMES, medalFor, saveBest } from './courses.ts';

export interface ChallengeHost {
  renderer: GameRenderer;
  start(cfg: MatchConfig): void;
  showOnly(id: string | null): void;
  toast(text: string): void;
  setHint(text: string): void;
}

const COL_NEXT = 0xffc21a, COL_AHEAD = 0x38a8ff;
const MEDAL_ICON = ['—', '🥉', '🥈', '🥇'];

export class Challenges {
  run: ChallengeRun | null = null;
  private menu: HTMLDivElement;
  private result: HTMLDivElement;
  private hud: HTMLDivElement;
  private group = new THREE.Group();
  private rings: THREE.Mesh[] = [];
  private guide: THREE.Line;
  private pulse = 0;
  private starting = false;

  constructor(private host: ChallengeHost) {
    this.menu = this.overlay('chMenu');
    this.result = this.overlay('chResult');
    this.hud = document.createElement('div');
    this.hud.id = 'chHud';
    this.hud.className = 'ch-hud hidden';
    document.getElementById('hud')!.appendChild(this.hud);
    this.group.visible = false;
    host.renderer.scene.add(this.group);
    this.guide = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: COL_NEXT, transparent: true, opacity: 0.45, depthTest: false }),
    );
    this.guide.frustumCulled = false;
    this.group.add(this.guide);
    document.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-ch]') as HTMLElement | null;
      if (!t) return;
      const act = t.dataset.ch!;
      if (act === 'back') this.host.showOnly('menu');
      else if (act === 'retry') { this.result.classList.add('hidden'); this.restart(); }
      else if (act === 'list') { this.result.classList.add('hidden'); this.openMenu(); }
      else this.startCourse(act);
    });
  }

  private overlay(id: string) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'overlay hidden';
    (document.getElementById('menu')?.parentElement ?? document.body).appendChild(el);
    return el;
  }

  // ---------- Menú ----------
  openMenu() {
    this.host.showOnly(null);
    const bests = loadBests();
    this.menu.innerHTML = `<div class="panel wide"><h2>Desafíos</h2>
      <p class="ch-intro">Recorridos contrarreloj dentro del estadio. Pasá por todos los aros en orden; <b>R</b> te devuelve al último aro.</p>
      <div class="ch-list">${COURSES.map((c) => {
        const b = bests[c.id];
        const m = b !== undefined ? medalFor(c, b) : 0;
        return `<button class="ch-card" data-ch="${c.id}">
          <span class="ch-kind k-${c.kind.toLowerCase()}">${c.kind}</span>
          <b>${c.name}</b><small>${c.desc}</small>
          <span class="ch-meta">${c.gates.length} aros · ${c.unlimitedBoost ? 'turbo ilimitado' : 'turbo de pastillas'} · oro ${fmtTime(c.medals[0])}</span>
          <span class="ch-best">${b !== undefined ? `${MEDAL_ICON[m]} Mejor: ${fmtTime(b)}` : 'Sin tiempo todavía'}</span>
        </button>`;
      }).join('')}</div>
      <div class="actions"><button class="btn" data-ch="back">Volver</button></div></div>`;
    this.menu.classList.remove('hidden');
  }

  closeMenu() {
    this.menu.classList.add('hidden');
    this.result.classList.add('hidden');
  }

  // ---------- Corrida ----------
  startCourse(id: string) {
    const course = COURSES.find((c) => c.id === id);
    if (!course) return;
    this.starting = true;
    this.host.start({ mode: 'freeplay', teamSize: 1, duration: 300, unlimitedBoost: course.unlimitedBoost, seed: 1 });
    this.starting = false;
    this.run = new ChallengeRun(course);
    this.buildRings(course);
    this.host.renderer.camCtl.snapTo();
    this.host.setHint('R: volver al último aro · Esc: pausa');
    this.hud.classList.remove('hidden');
    document.getElementById('hud')!.classList.add('challenge');
    const cam = this.host.renderer.camCtl;
    if (this.savedBallCam === null) this.savedBallCam = cam.ballCam;
    cam.ballCam = false;
    this.pendingPlace = true;
  }

  private pendingPlace = false;
  private savedBallCam: boolean | null = null;

  /** Reinicia el desafío en curso. Devuelve false si no hay ninguno. */
  restart(): boolean {
    if (!this.run) return false;
    this.startCourse(this.run.course.id);
    return true;
  }

  /** Lo llama el juego cada vez que arranca un mundo nuevo: si no lo arrancamos nosotros, el desafío terminó. */
  stop() {
    if (this.starting) return;
    if (this.savedBallCam !== null) { this.host.renderer.camCtl.ballCam = this.savedBallCam; this.savedBallCam = null; }
    document.getElementById('hud')?.classList.remove('challenge');
    this.run = null;
    this.group.visible = false;
    this.hud.classList.add('hidden');
    this.result.classList.add('hidden');
  }

  /** Tecla de reinicio: vuelve al último aro. Devuelve true si la consumió. */
  onReset(): boolean {
    if (!this.run || this.run.finished) return false;
    this.pendingRespawn = true;
    return true;
  }
  private pendingRespawn = false;
  private carPos = new THREE.Vector3();

  afterStep(w: World) {
    const run = this.run;
    if (!run) return;
    const car = w.cars[0];
    if (!car) return;
    this.carPos.set(car.pos.x, car.pos.y, car.pos.z);
    // En los desafíos no hay pelota
    w.ball.hidden = true;
    w.ball.frozen = true;
    if (this.pendingPlace) {
      this.pendingPlace = false;
      const [x, y, yaw] = run.course.start;
      car.placeAt(x, y, yaw);
      car.boost = 100;
      return;
    }
    if (this.pendingRespawn) { this.pendingRespawn = false; run.respawn(car); return; }
    if (run.finished) return;
    if (run.step(car.pos, car.vel.len())) {
      this.flash(run.index - 1);
      if (run.finished) this.finish();
    }
  }

  private finish() {
    const run = this.run!;
    const c = run.course;
    const t = run.time;
    const prev = loadBests()[c.id];
    const record = saveBest(c.id, t);
    const m = medalFor(c, t);
    this.result.innerHTML = `<div class="panel"><h2>${c.name}</h2>
      <div class="ch-time">${fmtTime(t)}</div>
      <div class="ch-medal m${m}">${MEDAL_ICON[m]} ${MEDAL_NAMES[m]}${record ? ' · ¡Nuevo récord!' : ''}</div>
      <table class="ch-table">
        <tr><td>Oro</td><td>${fmtTime(c.medals[0])}</td></tr><tr><td>Plata</td><td>${fmtTime(c.medals[1])}</td></tr><tr><td>Bronce</td><td>${fmtTime(c.medals[2])}</td></tr>
        <tr><td>Tu mejor anterior</td><td>${prev !== undefined ? fmtTime(prev) : '—'}</td></tr>
      </table>
      <div class="actions"><button class="btn" data-act="quit">Menú</button><button class="btn" data-ch="list">Otro desafío</button><button class="btn primary" data-ch="retry">Reintentar</button></div></div>`;
    this.result.classList.remove('hidden');
    document.exitPointerLock?.();
  }

  // ---------- Dibujo ----------
  private buildRings(c: Course) {
    for (const r of this.rings) { this.group.remove(r); r.geometry.dispose(); (r.material as THREE.Material).dispose(); }
    this.rings = [];
    const run = this.run!;
    const tube = Math.max(9, c.radius * 0.045);
    const geo = new THREE.TorusGeometry(c.radius, tube, 10, 56);
    const z = new THREE.Vector3(0, 0, 1);
    for (const g of run.gates) {
      const mat = new THREE.MeshBasicMaterial({ color: COL_AHEAD, transparent: true, opacity: 0.5, toneMapped: false });
      const mesh = new THREE.Mesh(geo.clone(), mat);
      mesh.position.set(g.p.x, g.p.y, g.p.z);
      mesh.quaternion.setFromUnitVectors(z, new THREE.Vector3(g.n.x, g.n.y, g.n.z));
      this.group.add(mesh);
      this.rings.push(mesh);
    }
    geo.dispose();
    this.group.visible = true;
  }

  private flash(i: number) {
    const m = this.rings[i];
    if (m) m.userData.flash = 0.35;
  }

  frame(dt: number) {
    const run = this.run;
    if (!run) return;
    this.pulse += dt;
    this.rings.forEach((m, i) => {
      const mat = m.material as THREE.MeshBasicMaterial;
      const f = (m.userData.flash as number | undefined) ?? 0;
      if (i < run.index) {
        if (f > 0) {
          m.userData.flash = f - dt;
          m.visible = true;
          m.scale.setScalar(1 + (0.35 - f) * 1.6);
          mat.color.setHex(0xffffff);
          mat.opacity = Math.max(0, f / 0.35);
        } else m.visible = false;
      } else if (i === run.index) {
        m.visible = true;
        mat.color.setHex(COL_NEXT);
        mat.opacity = 0.85 + 0.15 * Math.sin(this.pulse * 6);
        m.scale.setScalar(1 + 0.03 * Math.sin(this.pulse * 6));
      } else {
        m.visible = i - run.index <= 3;
        mat.color.setHex(COL_AHEAD);
        mat.opacity = 0.5 - 0.12 * (i - run.index - 1);
        m.scale.setScalar(1);
      }
    });
    // Línea guía desde el auto hasta el próximo aro
    const cp = this.carPos;
    const next = run.next;
    this.guide.visible = !!next;
    if (next) {
      const pos = this.guide.geometry.getAttribute('position') as THREE.BufferAttribute;
      pos.setXYZ(0, cp.x, cp.y, cp.z + 30);
      pos.setXYZ(1, next.p.x, next.p.y, next.p.z);
      pos.needsUpdate = true;
    }
    const best = loadBestCached(run.course.id);
    this.hud.innerHTML = `<span class="ch-name">${run.course.name}</span><span class="ch-count">${Math.min(run.index + (run.finished ? 0 : 1), run.gates.length)}<small>/${run.gates.length}</small></span><span class="ch-clock">${fmtTime(run.time)}</span><span class="ch-pb">${best !== undefined ? `Mejor ${fmtTime(best)}` : 'Oro ' + fmtTime(run.course.medals[0])}</span>`;
  }
}

let bestCache: { at: number; data: Record<string, number> } | null = null;
function loadBestCached(id: string) {
  const now = performance.now();
  if (!bestCache || now - bestCache.at > 1000) bestCache = { at: now, data: loadBests() };
  return bestCache.data[id];
}
