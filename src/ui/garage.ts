// Garage: vista 3D del auto girando (se dibuja con el renderer principal) y editor de apariencia.

import * as THREE from 'three';
import {
  allItems, BANNERS, DECALS, EXPLOSIONS, FINISHES, TITLES, TRAILS, WHEELS, unlockLabel, type Item, type Unlock,
} from '../garage/cosmetics.ts';
import { applyFlameColors, CosmeticFx } from '../garage/fxRender.ts';
import { getLoadout, lookFromLoadout, setLoadout, type Loadout } from '../garage/loadout.ts';
import { levelInfo, getProfile, unlocked } from '../progression/progression.ts';
import { TIER_NAMES } from '../progression/ranked.ts';
import { buildCar, disposeCar, type CarVisual } from '../render/carMesh.ts';
import { SECONDARY_COLORS, TEAM_COLORS, TEAM_PAINTS } from '../render/palette.ts';
import type { GameRenderer } from '../render/renderer.ts';
import { Particles } from '../render/effects.ts';
import { CAR_BODIES } from '../sim/constants.ts';
import { bannerBg } from './banner.ts';
import { overlay } from './screens.ts';

const TABS = ['Carrocería', 'Pintura', 'Acabado', 'Calcomanía', 'Llantas', 'Estela', 'Explosión', 'Título', 'Banner'] as const;
type Tab = (typeof TABS)[number];
const BODY_DESC = ['Equilibrado', 'Largo y bajo', 'Plano y ancho', 'Largo y fino', 'Híbrido', 'Alto, defensivo'];

export class Garage {
  el: HTMLDivElement;
  private panel: HTMLDivElement;
  private view: HTMLDivElement;
  private tab: Tab = 'Carrocería';
  private team = 0;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 10, 5000);
  private car: CarVisual | null = null;
  private platform = new THREE.Group();
  private ring!: THREE.Mesh;
  private particles = new Particles();
  private smoke = new Particles({ additive: false, grow: 3.5 });
  private fx: CosmeticFx;
  private az = 0.75;
  private el_ = 0.22;
  private dist = 300;
  private spin = 0;
  private dragging = false;
  private turbo = false;
  private time = 0;
  private active = false;

  constructor(private renderer: GameRenderer) {
    ({ el: this.el, panel: this.panel } = overlay('ui-garage', 'garage-panel'));
    this.el.classList.add('garage');
    this.el.classList.remove('w5');
    this.view = document.createElement('div');
    this.view.className = 'gv-view';
    this.el.append(this.view);
    this.camera.up.set(0, 0, 1);
    this.buildScene();
    this.fx = new CosmeticFx(this.scene, this.particles, this.smoke);
    this.scene.add(this.particles.points, this.smoke.points);
    this.wire();
    window.addEventListener('resize', () => this.resize());
  }

  private buildScene() {
    const s = this.scene;
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 256;
    const g = cv.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#0a1428'); grd.addColorStop(0.6, '#101c36'); grd.addColorStop(1, '#05080f');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
    const bg = new THREE.CanvasTexture(cv); bg.colorSpace = THREE.SRGBColorSpace;
    s.background = bg;
    s.add(new THREE.AmbientLight('#8aa4d6', 0.55));
    const key = new THREE.DirectionalLight('#ffffff', 0.9); key.position.set(300, -260, 380); s.add(key);
    const rim = new THREE.DirectionalLight('#5b9cff', 1.2); rim.position.set(-320, 280, 160); s.add(rim);
    const warm = new THREE.PointLight('#ffb067', 0, 1200, 2); warm.position.set(-200, -240, 120); s.add(warm);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(210, 220, 8, 64), new THREE.MeshStandardMaterial({ color: '#1a2436', metalness: 0.4, roughness: 0.55 }));
    disc.rotation.x = Math.PI / 2;
    this.platform.add(disc);
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(214, 2.6, 8, 96), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[0] }));
    this.ring.position.z = 4;
    this.platform.add(this.ring);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2400, 48), new THREE.MeshStandardMaterial({ color: '#0b1222', metalness: 0.2, roughness: 0.85 }));
    floor.position.z = -6;
    this.platform.add(floor);
    s.add(this.platform);
    s.environment = this.renderer.scene.environment;
    s.environmentIntensity = 0.6;
    s.fog = new THREE.Fog('#070d1a', 900, 2600);
  }

  private wire() {
    const v = this.view;
    let lx = 0, ly = 0;
    v.addEventListener('pointerdown', (e) => { this.dragging = true; lx = e.clientX; ly = e.clientY; v.setPointerCapture(e.pointerId); });
    v.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.az -= (e.clientX - lx) * 0.008;
      this.el_ = Math.max(0.02, Math.min(1.1, this.el_ + (e.clientY - ly) * 0.005));
      lx = e.clientX; ly = e.clientY;
    });
    const up = () => { this.dragging = false; };
    v.addEventListener('pointerup', up);
    v.addEventListener('pointercancel', up);
    v.addEventListener('wheel', (e) => { this.dist = Math.max(200, Math.min(620, this.dist + e.deltaY * 0.3)); e.preventDefault(); }, { passive: false });
    this.panel.addEventListener('click', (e) => this.click(e));
    this.panel.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'gvNum') { setLoadout({ decalNumber: Math.max(0, Math.min(99, Number(t.value) | 0)) }); this.rebuild(); }
    });
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    // Corre la imagen a la derecha para que el auto quede en la zona libre del panel
    const shift = w > 720 ? Math.min(440, w) / 2 : 0;
    this.camera.setViewOffset(w, h, -shift, 0, w, h);
    this.camera.updateProjectionMatrix();
  }

  open() {
    this.active = true;
    this.team = 0;
    this.scene.environment = this.renderer.scene.environment;
    this.renderer.preview = { scene: this.scene, camera: this.camera, update: (dt) => this.update(dt) };
    this.el.classList.remove('hidden');
    this.rebuild();
    this.render();
    this.resize();
  }

  close() {
    this.active = false;
    this.renderer.preview = null;
    this.turbo = false;
    this.el.classList.add('hidden');
  }

  private rebuild() {
    const lo = getLoadout();
    const old = this.car;
    const look = lookFromLoadout(lo, this.team);
    const v = buildCar(CAR_BODIES[lo.body], this.team, look);
    applyFlameColors(v, this.team);
    v.group.rotation.z = old ? old.group.rotation.z : 0.6;
    if (old) { this.scene.remove(old.group); disposeCar(old); }
    this.scene.add(v.group);
    this.car = v;
    const box = new THREE.Box3().setFromObject(v.group);
    v.group.position.z += 4 - box.min.z;
    (this.ring.material as THREE.MeshBasicMaterial).color.set(TEAM_COLORS[this.team]);
  }

  private update(dt: number) {
    this.time += dt;
    const v = this.car;
    if (v) {
      if (!this.dragging) this.spin = 0.35;
      v.group.rotation.z += this.spin * dt;
      v.flame.visible = this.turbo;
      if (this.turbo) {
        v.flame.scale.set(0.9 + 0.25 * Math.sin(this.time * 40), 1, 1);
        const q = v.group.quaternion;
        const back = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
        const rear = v.rearOffset.clone().applyQuaternion(q).add(v.group.position);
        this.fx.boost(v, this.team, rear, back, new THREE.Vector3());
      }
      for (const w of v.wheels) w.rotation.y += dt * (this.turbo ? 14 : 1.2);
    }
    this.fx.update(dt);
    this.particles.update(dt);
    this.smoke.update(dt);
    const tz = (this.car?.group.position.z ?? 0) + 34;
    this.camera.position.set(Math.cos(this.az) * Math.cos(this.el_) * this.dist, Math.sin(this.az) * Math.cos(this.el_) * this.dist, tz + Math.sin(this.el_) * this.dist);
    // Desplaza la mira para que el auto quede en la zona libre (a la derecha del panel)
    this.camera.lookAt(0, 0, tz);
  }

  // ---------- Panel ----------
  private can(u: Unlock) { return unlocked(u); }

  private itemBtn<T extends string>(it: Item<T>, cur: string, act: string, extra = '', cls = ''): string {
    const ok = this.can(it.unlock);
    return `<button class="gi${it.id === cur ? ' on' : ''}${ok ? '' : ' lock'} ${cls}" data-set="${act}" data-v="${it.id}" data-lock="${ok ? '' : unlockLabel(it.unlock, TIER_NAMES)}" title="${it.desc ?? ''}">${extra}<span>${it.name}</span>${ok ? '' : `<em>${unlockLabel(it.unlock, TIER_NAMES)}</em>`}</button>`;
  }

  render() {
    const lo = getLoadout();
    const p = getProfile();
    const lv = levelInfo(p.xp).level;
    let body = '';
    switch (this.tab) {
      case 'Carrocería':
        body = `<div class="gi-grid cols2">${CAR_BODIES.map((b, i) => `<button class="gi${i === lo.body ? ' on' : ''}" data-set="body" data-v="${i}"><span>${b.name}</span><small>${BODY_DESC[i]}</small></button>`).join('')}</div>
          <p class="tip">Cambia la forma y el hitbox, igual que en el juego: elegí la que mejor te quede.</p>`;
        break;
      case 'Pintura': {
        const tp = TEAM_PAINTS[this.team];
        body = `<h4>Primaria · tonos del equipo</h4>
          <div class="seg"><button data-team="0" class="${this.team === 0 ? 'on' : ''}">Equipo Azul</button><button data-team="1" class="${this.team === 1 ? 'on' : ''}">Equipo Rojo</button></div>
          <div class="sw-grid">${tp.map((c, i) => `<button class="sw${lo.paint[this.team] === i ? ' on' : ''}" style="--c:${c.hex}" data-set="paint" data-v="${i}" title="${c.name}"></button>`).join('')}</div>
          <h4>Secundaria · libre</h4>
          <div class="sw-grid">${SECONDARY_COLORS.map((c, i) => `<button class="sw${lo.secondary === i ? ' on' : ''}" style="--c:${c.hex}" data-set="secondary" data-v="${i}" title="${c.name}"></button>`).join('')}</div>`;
        break;
      }
      case 'Acabado':
        body = `<div class="gi-grid cols2">${FINISHES.map((f) => this.itemBtn(f, lo.finish, 'finish')).join('')}</div>`;
        break;
      case 'Calcomanía':
        body = `<div class="gi-grid cols2">${DECALS.map((d) => this.itemBtn(d, lo.decal, 'decal')).join('')}</div>
          ${lo.decal === 'numero' ? `<div class="row"><label for="gvNum">Número</label><input id="gvNum" class="txt" type="number" min="0" max="99" value="${lo.decalNumber}"></div>` : ''}`;
        break;
      case 'Llantas':
        body = `<div class="gi-grid cols2">${WHEELS.map((w) => this.itemBtn(w, lo.wheel, 'wheel')).join('')}</div>`;
        break;
      case 'Estela':
        body = `<div class="gi-grid cols2">${TRAILS.map((t) => this.itemBtn(t, lo.trail, 'trail', `<i class="dot" style="background:linear-gradient(90deg,${t.style.core},${t.style.flame ?? TEAM_COLORS[this.team]})"></i>`)).join('')}</div>
          <button class="btn sm" data-gv="turbo">${this.turbo ? 'Apagar turbo' : 'Probar turbo'}</button>`;
        break;
      case 'Explosión':
        body = `<div class="gi-grid cols2">${EXPLOSIONS.map((x) => this.itemBtn(x, lo.explosion, 'explosion')).join('')}</div>
          <button class="btn sm" data-gv="boom">Probar explosión</button>`;
        break;
      case 'Título':
        body = `<div class="gi-grid cols2">${TITLES.map((t) => this.itemBtn(t, lo.title, 'title')).join('')}</div>`;
        break;
      case 'Banner':
        body = `<div class="gi-grid">${BANNERS.map((b) => this.itemBtn(b, lo.banner, 'banner', `<i class="bn" style="background:${bannerBg(b.style)}"></i>`, 'wide')).join('')}</div>`;
        break;
    }
    const total = allItems().length;
    const have = allItems().filter((x) => this.can(x.item.unlock)).length;
    const title = TITLES.find((t) => t.id === lo.title)?.name ?? '';
    this.panel.innerHTML = `
      <h2>Garage</h2>
      <div class="gv-who"><b>${p.name}</b> · ${title} · Nivel ${lv} · ${have}/${total} desbloqueados</div>
      <div class="gv-tabs">${TABS.map((t) => `<button class="${t === this.tab ? 'on' : ''}" data-tab="${t}">${t}</button>`).join('')}</div>
      <div class="gv-body">${body}</div>
      <div class="gv-msg" id="gvMsg"></div>
      <div class="actions"><button class="btn primary" data-ui="back">Listo</button></div>`;
  }

  private msg(t: string) { const m = this.panel.querySelector('#gvMsg'); if (m) m.textContent = t; }

  private click(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const tab = t.closest('[data-tab]') as HTMLElement | null;
    if (tab) { this.tab = tab.dataset.tab as Tab; this.turbo = false; this.render(); return; }
    const team = t.closest('[data-team]') as HTMLElement | null;
    if (team) { this.team = Number(team.dataset.team); this.rebuild(); this.render(); return; }
    const g = (t.closest('[data-gv]') as HTMLElement | null)?.dataset.gv;
    if (g === 'turbo') { this.turbo = !this.turbo; this.render(); return; }
    if (g === 'boom') {
      const lo = getLoadout();
      this.fx.goal(new THREE.Vector3(0, 0, 160), this.team, lookFromLoadout(lo, this.team));
      return;
    }
    const b = t.closest('[data-set]') as HTMLElement | null;
    if (!b) return;
    if (b.classList.contains('lock')) { this.msg(`Se desbloquea con: ${b.dataset.lock}`); return; }
    const k = b.dataset.set!, v = b.dataset.v!;
    const n = Number(v);
    const patch: Partial<Loadout> = {};
    switch (k) {
      case 'body': patch.body = n; break;
      case 'paint': { const p = getLoadout().paint.slice() as [number, number]; p[this.team] = n; patch.paint = p; break; }
      case 'secondary': patch.secondary = n; break;
      case 'finish': patch.finish = v as Loadout['finish']; break;
      case 'decal': patch.decal = v as Loadout['decal']; break;
      case 'wheel': patch.wheel = v as Loadout['wheel']; break;
      case 'trail': patch.trail = v as Loadout['trail']; break;
      case 'explosion': patch.explosion = v as Loadout['explosion']; break;
      case 'title': patch.title = v; break;
      case 'banner': patch.banner = v; break;
    }
    setLoadout(patch);
    if (k === 'trail') this.turbo = true;
    this.rebuild();
    this.render();
    if (k === 'explosion') this.fx.goal(new THREE.Vector3(0, 0, 160), this.team, lookFromLoadout(getLoadout(), this.team));
  }

  get isOpen() { return this.active; }
}
