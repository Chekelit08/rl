// Editor de tiros: cámara libre, ubicar pelota y auto con el mouse, vector de velocidad y trayectoria visibles,
// probar el tiro, guardar el pack y compartirlo con un código.

import * as THREE from 'three';
import type { UiActions } from '../input/input.ts';
import { FreeCamControl, isTyping } from '../replay/freecam.ts';
import { Ball, stepBall } from '../sim/ball.ts';
import { BALL, DT } from '../sim/constants.ts';
import { encodePack, upsertCustomPack } from './codes.ts';
import { askText, button, confirmBox, copyText, el } from './dom.ts';
import { fillRange } from '../ui/range.ts';
import type { ExtScreen, Extras } from './extras.ts';
import { aimAt } from './packs.ts';
import { insideField, placeShot } from './session.ts';
import { CATEGORIES, CATEGORY_NAMES, DEFAULT_TIME, DIFFICULTIES, DIFFICULTY_LABELS, type Pack, type Shot } from './types.ts';

type Sel = 'pelota' | 'auto';
const DEG = Math.PI / 180;
const round = (v: number) => Math.round(v);

interface Field { input: HTMLInputElement; range?: HTMLInputElement; get: () => number }

export class ShotEditor implements ExtScreen {
  readonly kind = 'editor';
  private ext: Extras;
  readonly pack: Pack;
  index: number;
  sel: Sel = 'pelota';
  private free: FreeCamControl;
  private canvas: HTMLCanvasElement;
  private group = new THREE.Group();
  private velArrow: THREE.ArrowHelper;
  private carArrow: THREE.ArrowHelper;
  private ring: THREE.Mesh;
  private path: THREE.Line;
  private root: HTMLDivElement;
  private fields: Field[] = [];
  private shotsRow!: HTMLDivElement;
  private dirty = true;
  private unsaved = false;
  private dragging = false;
  private onKey = (e: KeyboardEvent) => this.key(e);
  private onDown = (e: MouseEvent) => this.mouseDown(e);
  private onMove = (e: MouseEvent) => { if (this.dragging) this.place(e); };
  private onUp = () => { this.dragging = false; };
  private onWheel = (e: WheelEvent) => this.wheel(e);

  constructor(ext: Extras, pack: Pack, index: number) {
    this.ext = ext;
    this.pack = pack;
    if (!pack.shots.length) pack.shots.push({ ball: { p: [0, 2600, 93], v: [0, 0, 0] }, car: { p: [0, 600, 17], yaw: 90, boost: 100 } });
    this.index = Math.max(0, Math.min(pack.shots.length - 1, index));
    const r = ext.g.renderer;
    this.canvas = r.renderer.domElement;
    const cc = r.camCtl;
    cc.customFn = (_snap, dt, c) => c.applyFree(dt);
    this.free = new FreeCamControl(this.canvas, cc);
    this.free.enabled = true;
    this.free.leftClickReserved = true;

    // Ayudas visuales
    const yellow = 0xffd23d;
    this.velArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 100, yellow, 90, 55);
    this.carArrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 320, 0x2e8bff, 80, 50);
    for (const a of [this.velArrow, this.carArrow]) {
      for (const m of [a.line.material, a.cone.material] as THREE.Material[]) { m.depthTest = false; m.toneMapped = false; m.transparent = true; }
      a.renderOrder = 999;
    }
    this.ring = new THREE.Mesh(new THREE.RingGeometry(1, 1.18, 48), new THREE.MeshBasicMaterial({ color: yellow, toneMapped: false, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
    this.ring.renderOrder = 998;
    this.path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 60, gapSize: 40, transparent: true, opacity: 0.8, toneMapped: false, depthTest: false }));
    this.path.renderOrder = 997;
    this.path.frustumCulled = false;
    this.group.add(this.velArrow, this.carArrow, this.ring, this.path);
    r.scene.add(this.group);

    this.root = el('div', 'tg-editor');
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(this.root);
    this.buildPanel();
    this.frameCamera();

    window.addEventListener('keydown', this.onKey);
    this.canvas.addEventListener('mousedown', this.onDown);
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
  }

  get shot(): Shot { return this.pack.shots[this.index]; }

  private changed() { this.dirty = true; this.unsaved = true; }

  /** Ubica la cámara libre detrás del auto mirando a la pelota. */
  private frameCamera() {
    const s = this.shot;
    const car = new THREE.Vector3(s.car.p[0], s.car.p[1], 0);
    const ball = new THREE.Vector3(s.ball.p[0], s.ball.p[1], s.ball.p[2]);
    const dir = ball.clone().sub(car).setZ(0);
    if (dir.lengthSq() < 1) dir.set(0, 1, 0);
    dir.normalize();
    const from = car.clone().addScaledVector(dir, -1500).setZ(1100);
    this.ext.g.renderer.camCtl.freeLookAt(from, car.clone().lerp(ball, 0.5));
  }

  // ---------- Panel ----------

  private buildPanel() {
    const p = this.root;
    p.innerHTML = '';
    this.fields = [];
    const pk = this.pack;
    p.appendChild(el('h3', '', 'Editor de tiros'));

    const name = el('input', 'tg-input');
    name.value = pk.name;
    name.maxLength = 60;
    name.addEventListener('input', () => { pk.name = name.value; this.unsaved = true; });
    const desc = el('input', 'tg-input');
    desc.value = pk.description ?? '';
    desc.placeholder = 'Descripción (opcional)';
    desc.maxLength = 200;
    desc.addEventListener('input', () => { pk.description = desc.value; this.unsaved = true; });
    const select = <T extends string>(values: T[], labels: Record<T, string>, cur: T, set: (v: T) => void) => {
      const s = el('select', 'tg-input');
      for (const v of values) { const o = el('option'); o.value = v; o.textContent = labels[v]; s.appendChild(o); }
      s.value = cur;
      s.addEventListener('change', () => { set(s.value as T); this.unsaved = true; });
      return s;
    };
    const meta = el('div', 'tg-ed-grid2');
    meta.append(
      select(CATEGORIES, CATEGORY_NAMES, pk.category, (v) => { pk.category = v; this.buildPanel(); }),
      select(DIFFICULTIES, DIFFICULTY_LABELS, pk.difficulty, (v) => { pk.difficulty = v; }),
    );
    p.append(this.label('Pack'), name, meta, desc);

    // Tiros
    p.appendChild(this.label(`Tiros (${pk.shots.length})`));
    this.shotsRow = el('div', 'tg-ed-shots');
    p.appendChild(this.shotsRow);
    this.fillShots();
    const ops = el('div', 'tg-ed-ops');
    ops.append(
      button('+ Nuevo', 'tg-mini', () => this.addShot(false)),
      button('Duplicar', 'tg-mini', () => this.addShot(true)),
      button('◀', 'tg-mini', () => this.moveShot(-1)),
      button('▶', 'tg-mini', () => this.moveShot(1)),
      button('Borrar', 'tg-mini danger', () => this.deleteShot()),
    );
    p.appendChild(ops);

    // Selección
    const selRow = el('div', 'seg tg-ed-sel');
    for (const [k, label] of [['pelota', 'Pelota (1)'], ['auto', 'Auto (2)']] as const) {
      const b = button(label, this.sel === k ? 'on' : '', () => { this.sel = k; this.buildPanel(); });
      selRow.appendChild(b);
    }
    p.append(this.label('Mover con clic izquierdo'), selRow);

    const s = () => this.shot;
    if (this.sel === 'pelota') {
      p.appendChild(this.label('Pelota'));
      this.num('X', -3900, 3900, 10, () => s().ball.p[0], (v) => { s().ball.p[0] = v; });
      this.num('Y', -5000, 5000, 10, () => s().ball.p[1], (v) => { s().ball.p[1] = v; });
      this.num('Altura', 93, 1900, 5, () => s().ball.p[2], (v) => { s().ball.p[2] = v; });
      const vel = () => s().ball.v;
      const speed = () => Math.hypot(...vel());
      const dir = () => Math.atan2(vel()[1], vel()[0]) / DEG;
      const elev = () => Math.atan2(vel()[2], Math.hypot(vel()[0], vel()[1])) / DEG;
      const setV = (sp: number, d: number, e: number) => {
        s().ball.v = [round(sp * Math.cos(e * DEG) * Math.cos(d * DEG)), round(sp * Math.cos(e * DEG) * Math.sin(d * DEG)), round(sp * Math.sin(e * DEG))];
      };
      p.appendChild(this.label('Velocidad (flecha amarilla)'));
      this.num('Rapidez (uu/s)', 0, 4500, 10, speed, (v) => setV(v, dir(), elev()));
      this.num('Dirección (°)', -180, 180, 1, dir, (v) => setV(Math.max(1, speed()), v, elev()));
      this.num('Elevación (°)', -60, 85, 1, elev, (v) => setV(Math.max(1, speed()), dir(), v));
      this.num('Efecto (rad/s)', -6, 6, 0.1, () => s().ball.w?.[2] ?? 0, (v) => { s().ball.w = v ? [0, 0, v] : undefined; });
      const aim = el('div', 'tg-ed-ops');
      const aimTo = (y: number) => {
        const sh = s();
        const hs = Math.max(1200, Math.hypot(sh.ball.v[0], sh.ball.v[1]) || 1800);
        sh.ball.v = aimAt(sh.ball.p, [(Math.random() - 0.5) * 900, y, 120 + Math.random() * 380], hs);
        this.changed();
        this.refresh();
      };
      aim.append(
        button('A mi arco', 'tg-mini', () => aimTo(-5300)),
        button('Al arco rival', 'tg-mini', () => aimTo(5300)),
        button('Quieta', 'tg-mini', () => { s().ball.v = [0, 0, 0]; this.changed(); this.refresh(); }),
      );
      p.appendChild(aim);
      p.appendChild(el('p', 'tg-ed-tip', 'Ctrl + clic: apuntar la pelota hacia ese punto. Rueda: altura.'));
    } else {
      p.appendChild(this.label('Auto'));
      this.num('X', -3900, 3900, 10, () => s().car.p[0], (v) => { s().car.p[0] = v; });
      this.num('Y', -5000, 5000, 10, () => s().car.p[1], (v) => { s().car.p[1] = v; });
      this.num('Altura', 17, 1800, 5, () => s().car.p[2], (v) => { s().car.p[2] = v; });
      this.num('Rumbo (°)', -180, 180, 1, () => ((s().car.yaw + 540) % 360) - 180, (v) => { s().car.yaw = v; });
      this.num('Nariz (°)', -90, 90, 1, () => s().car.pitch ?? 0, (v) => { s().car.pitch = v; });
      this.num('Turbo inicial', 0, 100, 1, () => s().car.boost ?? 100, (v) => { s().car.boost = v; });
      p.appendChild(el('p', 'tg-ed-tip', '[ / ]: girar el auto. Ctrl + clic: apuntar el auto hacia ese punto. Rueda: altura.'));
    }

    p.appendChild(this.label('Tiro'));
    this.num('Tiempo (s)', 2, 20, 0.5, () => s().time ?? DEFAULT_TIME[pk.category], (v) => { s().time = v; });
    const note = el('input', 'tg-input');
    note.placeholder = 'Nota del tiro (opcional)';
    note.maxLength = 60;
    note.value = s().note ?? '';
    note.addEventListener('input', () => { s().note = note.value || undefined; this.unsaved = true; });
    p.appendChild(note);

    const actions = el('div', 'tg-ed-actions');
    actions.append(
      button('Probar tiro (P)', 'btn primary small', () => this.test()),
      button('Guardar pack', 'btn small', () => this.save()),
      button('Compartir', 'btn small', () => void this.share()),
      button('Salir', 'btn small', () => void this.exit()),
    );
    p.appendChild(el('p', 'tg-ed-tip', 'Cámara: WASD para moverte, Q y E para bajar y subir, Shift para ir rápido y clic derecho para mirar.'));
    p.appendChild(actions);
  }

  private label(t: string) { return el('div', 'tg-ed-label', t); }

  private num(label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void) {
    const row = el('div', 'tg-ed-row');
    const range = el('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    const input = el('input', 'tg-input tg-num');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const apply = (v: number) => {
      if (!Number.isFinite(v)) return;
      set(Math.max(min, Math.min(max, v)));
      this.changed();
      this.refresh();
    };
    range.addEventListener('input', () => apply(Number(range.value)));
    input.addEventListener('change', () => apply(Number(input.value)));
    row.append(el('label', '', label), range, input);
    this.root.appendChild(row);
    this.fields.push({ input, range, get });
    const f = this.fields[this.fields.length - 1];
    this.setField(f);
  }

  private setField(f: Field) {
    const v = f.get();
    const shown = Math.abs(v) < 10 && v % 1 ? v.toFixed(1) : String(Math.round(v));
    if (document.activeElement !== f.input) f.input.value = shown;
    if (f.range && document.activeElement !== f.range) f.range.value = String(v);
    if (f.range) fillRange(f.range);
  }

  private refresh() { for (const f of this.fields) this.setField(f); }

  private fillShots() {
    this.shotsRow.innerHTML = '';
    this.pack.shots.forEach((_, i) => {
      this.shotsRow.appendChild(button(String(i + 1), i === this.index ? 'tg-mini on' : 'tg-mini', () => this.select(i)));
    });
  }

  private select(i: number) {
    this.index = Math.max(0, Math.min(this.pack.shots.length - 1, i));
    this.dirty = true;
    this.buildPanel();
    this.frameCamera();
  }

  private addShot(copy: boolean) {
    if (this.pack.shots.length >= 50) { this.ext.toast('Máximo 50 tiros por pack'); return; }
    const base: Shot = copy ? structuredClone(this.shot) : { ball: { p: [0, 2600, 93], v: [0, 0, 0] }, car: { p: [0, 600, 17], yaw: 90, boost: 100 } };
    if (copy) { base.ball.p[0] = Math.max(-3800, Math.min(3800, base.ball.p[0] + 300)); }
    this.pack.shots.splice(this.index + 1, 0, base);
    this.unsaved = true;
    this.select(this.index + 1);
  }

  private moveShot(d: number) {
    const j = this.index + d;
    if (j < 0 || j >= this.pack.shots.length) return;
    const s = this.pack.shots;
    [s[this.index], s[j]] = [s[j], s[this.index]];
    this.unsaved = true;
    this.select(j);
  }

  private deleteShot() {
    if (this.pack.shots.length <= 1) { this.ext.toast('El pack necesita al menos un tiro'); return; }
    this.pack.shots.splice(this.index, 1);
    this.unsaved = true;
    this.select(Math.min(this.index, this.pack.shots.length - 1));
  }

  // ---------- Acciones ----------

  test() {
    this.ext.g.audio.click();
    this.ext.startTraining(this.pack, this.index, true);
  }

  save() {
    this.ext.g.audio.click();
    if (!this.pack.name.trim()) this.pack.name = 'Mi pack';
    this.pack.official = false;
    upsertCustomPack(structuredClone(this.pack));
    this.unsaved = false;
    this.ext.toast(`Pack "${this.pack.name}" guardado (${this.pack.shots.length} tiros)`);
  }

  async share() {
    this.ext.g.audio.click();
    const code = await encodePack(this.pack);
    const ok = await copyText(code);
    await askText(ok ? 'Código copiado al portapapeles' : 'Copiá este código', code, '', true);
  }

  async exit() {
    if (this.unsaved && !(await confirmBox('Salir del editor', 'Hay cambios sin guardar. ¿Salir igual?', 'Salir'))) return;
    this.ext.closeEditor();
  }

  // ---------- Mouse y teclado ----------

  private groundPoint(e: MouseEvent): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.ext.g.renderer.camera);
    const out = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), out);
  }

  private mouseDown(e: MouseEvent) {
    if (e.button !== 0 || e.altKey) return;
    if (e.ctrlKey || e.metaKey) { this.aimAtPoint(e); return; }
    this.dragging = true;
    this.place(e);
  }

  /** Ubica el objeto seleccionado donde apunta el mouse (manteniendo su altura). */
  private place(e: MouseEvent) {
    const p = this.groundPoint(e);
    if (!p) return;
    let x = Math.max(-3900, Math.min(3900, p.x)), y = Math.max(-5000, Math.min(5000, p.y));
    for (let k = 0; k < 20 && !insideField(x, y); k++) { x *= 0.97; y *= 0.97; }
    const t = this.sel === 'pelota' ? this.shot.ball.p : this.shot.car.p;
    t[0] = round(x);
    t[1] = round(y);
    this.changed();
    this.refresh();
  }

  private aimAtPoint(e: MouseEvent) {
    const p = this.groundPoint(e);
    if (!p) return;
    const s = this.shot;
    if (this.sel === 'pelota') {
      const sp = Math.hypot(...s.ball.v) || 1500;
      const ev = Math.atan2(s.ball.v[2], Math.hypot(s.ball.v[0], s.ball.v[1]));
      const d = Math.atan2(p.y - s.ball.p[1], p.x - s.ball.p[0]);
      s.ball.v = [round(sp * Math.cos(ev) * Math.cos(d)), round(sp * Math.cos(ev) * Math.sin(d)), round(sp * Math.sin(ev))];
    } else {
      s.car.yaw = round(Math.atan2(p.y - s.car.p[1], p.x - s.car.p[0]) / DEG);
    }
    this.changed();
    this.refresh();
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const d = e.deltaY < 0 ? 40 : -40;
    if (this.sel === 'pelota') this.shot.ball.p[2] = Math.max(93, Math.min(1900, this.shot.ball.p[2] + d));
    else this.shot.car.p[2] = Math.max(17, Math.min(1800, this.shot.car.p[2] + d));
    this.changed();
    this.refresh();
  }

  private key(e: KeyboardEvent) {
    if (isTyping(e) || e.repeat) return;
    if (e.code === 'Digit1') { this.sel = 'pelota'; this.buildPanel(); }
    else if (e.code === 'Digit2') { this.sel = 'auto'; this.buildPanel(); }
    else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      this.shot.car.yaw += e.code === 'BracketLeft' ? 15 : -15;
      this.changed();
      this.refresh();
    } else if (e.code === 'KeyP') this.test();
  }

  handleUi(ui: UiActions) {
    if (ui.pause && !document.getElementById('tg-confirm') && !document.getElementById('tg-ask')) void this.exit();
  }

  // ---------- Cuadro ----------

  private updateHelpers() {
    const s = this.shot;
    const bp = new THREE.Vector3(s.ball.p[0], s.ball.p[1], Math.max(BALL.RADIUS + 1, s.ball.p[2]));
    const v = new THREE.Vector3(...s.ball.v);
    const sp = v.length();
    this.velArrow.visible = sp > 1;
    if (sp > 1) {
      this.velArrow.position.copy(bp);
      this.velArrow.setDirection(v.clone().normalize());
      const len = Math.max(160, Math.min(1600, sp * 0.4));
      this.velArrow.setLength(len, Math.min(120, len * 0.3), Math.min(70, len * 0.18));
    }
    const yaw = s.car.yaw * DEG;
    this.carArrow.position.set(s.car.p[0], s.car.p[1], Math.max(17, s.car.p[2]) + 60);
    this.carArrow.setDirection(new THREE.Vector3(Math.cos(yaw), Math.sin(yaw), 0));
    const sel = this.sel === 'pelota' ? s.ball.p : s.car.p;
    this.ring.position.set(sel[0], sel[1], 3);
    this.ring.scale.setScalar(this.sel === 'pelota' ? 130 : 170);
    // Trayectoria de la pelota (3 s, sin autos)
    const b = new Ball();
    b.reset(bp.x, bp.y);
    b.pos.z = bp.z;
    b.vel.set(s.ball.v[0], s.ball.v[1], s.ball.v[2]);
    if (s.ball.w) b.ang.set(s.ball.w[0], s.ball.w[1], s.ball.w[2]);
    const pts: THREE.Vector3[] = [bp.clone()];
    if (sp > 1) {
      for (let i = 1; i <= 360; i++) {
        stepBall(b, DT);
        if (i % 3 === 0) pts.push(new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z));
      }
    }
    this.path.geometry.dispose();
    this.path.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.path.computeLineDistances();
    this.path.visible = sp > 1;
  }

  frame(dt: number) {
    this.free.update(dt);
    const g = this.ext.g;
    placeShot(g.world, this.shot);
    if (this.dirty) { this.dirty = false; this.updateHelpers(); }
    g.renderer.render(g.world.snapshot(), dt, 'custom');
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    this.canvas.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('mouseup', this.onUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.free.enabled = false;
    this.free.dispose();
    const cc = this.ext.g.renderer.camCtl;
    cc.customFn = null;
    cc.snapTo();
    this.ext.g.renderer.scene.remove(this.group);
    this.path.geometry.dispose();
    this.root.remove();
  }
}
