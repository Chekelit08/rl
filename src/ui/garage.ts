// Garage: sala de exhibición con el auto girando (se dibuja con el renderer principal) y editor de apariencia.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
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
import { icon } from './icons.ts';
import { overlay } from './screens.ts';
import { bodyCards, refreshBodyThumbs } from './thumbs.ts';

const TABS = ['Carrocería', 'Pintura', 'Acabado', 'Calcomanía', 'Llantas', 'Estela', 'Explosión', 'Título', 'Banner'] as const;
type Tab = (typeof TABS)[number];

// Colores del estudio: pared y piso claros para que el auto resalte
const WALL_TOP = '#c3cad5', WALL_MID = '#e2e6eb', FLOOR = '#e9ecf0', INK = '#d3d9e1';

export class Garage {
  el: HTMLDivElement;
  private panel: HTMLDivElement;
  private view: HTMLDivElement;
  private tab: Tab = 'Carrocería';
  private team = 0;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 10, 9000);
  private car: CarVisual | null = null;
  private stage = new THREE.Group();
  private ring!: THREE.Mesh;
  private blob!: THREE.Mesh;
  private key!: THREE.DirectionalLight;
  private sign!: THREE.Mesh;
  private signCanvas = document.createElement('canvas');
  private signText = '';
  private env: THREE.Texture | null = null;
  private particles = new Particles();
  private smoke = new Particles({ additive: false, grow: 3.5 });
  private fx: CosmeticFx;
  private az = 0.72;
  private el_ = 0.19;
  private dist = 350;
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

  /** Estudio claro: fondo en degradé, piso continuo, plataforma con aro del equipo y el nombre de la carrocería detrás. */
  private buildScene() {
    const s = this.scene;
    const cv = document.createElement('canvas');
    cv.width = 4; cv.height = 256;
    const g = cv.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, WALL_TOP); grd.addColorStop(0.52, WALL_MID); grd.addColorStop(0.7, FLOOR); grd.addColorStop(1, FLOOR);
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
    const bg = new THREE.CanvasTexture(cv); bg.colorSpace = THREE.SRGBColorSpace;
    s.background = bg;
    s.fog = new THREE.Fog(WALL_MID, 900, 3200);

    s.add(new THREE.HemisphereLight('#ffffff', '#aeb6c2', 0.85));
    this.key = new THREE.DirectionalLight('#ffffff', 2.3);
    this.key.position.set(240, -330, 520);
    this.key.shadow.mapSize.set(2048, 2048);
    const sc = this.key.shadow.camera;
    sc.left = -260; sc.right = 260; sc.top = 260; sc.bottom = -260; sc.near = 100; sc.far = 1400;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.6;
    const rim = new THREE.DirectionalLight('#eaf1ff', 1.1);
    rim.position.set(-340, 300, 240);
    s.add(this.key, rim);

    // Piso sin luz (mismo tono que el fondo, así no se ve el horizonte) y, encima, un plano que sólo recibe sombras
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4200, 64), new THREE.MeshBasicMaterial({ color: FLOOR, toneMapped: false }));
    floor.position.z = -6;
    const shadowFloor = new THREE.Mesh(new THREE.CircleGeometry(900, 48), new THREE.ShadowMaterial({ opacity: 0.16 }));
    shadowFloor.position.z = -5.8;
    shadowFloor.receiveShadow = true;
    // Plataforma
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(214, 214, 6, 96), new THREE.MeshStandardMaterial({ color: '#f6f7f9', metalness: 0, roughness: 0.72 }));
    disc.rotation.x = Math.PI / 2;
    disc.position.z = -3;
    disc.receiveShadow = true;
    const flat = (inner: number, outer: number, color: string, z: number) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 96), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      m.position.z = z;
      return m;
    };
    this.ring = flat(188, 198, TEAM_COLORS[0], 0.25);
    const edge = flat(214, 219, '#141922', -5.6);
    // Marcas cada 15° en el borde de la plataforma
    const ticks = new THREE.Group();
    const tickGeo = new THREE.PlaneGeometry(9, 2.2);
    const tickMat = new THREE.MeshBasicMaterial({ color: '#141922', toneMapped: false });
    for (let i = 0; i < 24; i++) {
      const t = new THREE.Mesh(tickGeo, tickMat);
      const a = (i / 24) * Math.PI * 2;
      t.position.set(Math.cos(a) * 207, Math.sin(a) * 207, 0.25);
      t.rotation.z = a;
      ticks.add(t);
    }
    // Sombra de contacto bajo el auto
    const bc = document.createElement('canvas');
    bc.width = bc.height = 128;
    const bg2 = bc.getContext('2d')!;
    const rg = bg2.createRadialGradient(64, 64, 8, 64, 64, 64);
    rg.addColorStop(0, 'rgba(10,14,22,.55)'); rg.addColorStop(0.55, 'rgba(10,14,22,.25)'); rg.addColorStop(1, 'rgba(10,14,22,0)');
    bg2.fillStyle = rg; bg2.fillRect(0, 0, 128, 128);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), transparent: true, depthWrite: false, toneMapped: false }));
    this.blob.position.z = 0.4;
    this.stage.add(floor, shadowFloor, disc, edge, this.ring, ticks, this.blob);
    s.add(this.stage);

    // Cartel de fondo: el nombre de la carrocería en letras enormes, fijo detrás del auto
    this.signCanvas.width = 2048; this.signCanvas.height = 512;
    const tex = new THREE.CanvasTexture(this.signCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
    this.sign.renderOrder = -1;
    this.camera.add(this.sign);
    s.add(this.camera);
  }

  private drawSign(text: string) {
    if (text === this.signText) return;
    this.signText = text;
    const draw = () => {
      const c = this.signCanvas, g = c.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      g.font = `900 extra-expanded 400px 'Archivo Variable', 'Arial Black', sans-serif`;
      (g as CanvasRenderingContext2D & { fontStretch?: string }).fontStretch = 'extra-expanded';
      (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = '-14px';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.fillStyle = INK;
      const w = g.measureText(text).width;
      const k = Math.min(1, (c.width - 120) / w);
      g.setTransform(k, 0, -0.16 * k, k, c.width / 2 + 30, c.height / 2 + 150 * k);
      g.fillText(text, 0, 0);
      (this.sign.material as THREE.MeshBasicMaterial).map!.needsUpdate = true;
    };
    draw();
    // Si la tipografía todavía no cargó, se vuelve a dibujar cuando esté
    void document.fonts?.load("900 100px 'Archivo Variable'").then(() => { if (this.signText === text) draw(); });
  }

  private wire() {
    const v = this.view;
    let lx = 0, ly = 0;
    v.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.dragging = true; lx = e.clientX; ly = e.clientY; v.setPointerCapture(e.pointerId);
    });
    v.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.az -= (e.clientX - lx) * 0.008;
      this.el_ = Math.max(0.03, Math.min(1.1, this.el_ + (e.clientY - ly) * 0.005));
      lx = e.clientX; ly = e.clientY;
    });
    const up = () => { this.dragging = false; };
    v.addEventListener('pointerup', up);
    v.addEventListener('pointercancel', up);
    v.addEventListener('wheel', (e) => { this.dist = Math.max(230, Math.min(640, this.dist + e.deltaY * 0.3)); e.preventDefault(); }, { passive: false });
    v.addEventListener('click', (e) => this.click(e));
    this.panel.addEventListener('click', (e) => this.click(e));
    this.panel.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'gvNum') { setLoadout({ decalNumber: Math.max(0, Math.min(99, Number(t.value) | 0)) }); this.rebuild(); }
    });
  }

  private resize() {
    if (!this.active) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    // Corre la imagen para que el auto quede en el centro de la zona libre (al lado o arriba del panel)
    const pr = this.panel.getBoundingClientRect();
    const side = pr.height >= h * 0.9;
    const sx = side ? pr.width / 2 : 0, sy = side ? 0 : pr.height / 2;
    this.camera.setViewOffset(w, h, -sx, sy, w, h);
    this.camera.updateProjectionMatrix();
    // El cartel ocupa el ancho de la zona libre
    const D = 2600;
    const visH = 2 * D * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const freeW = ((w - (side ? pr.width : 0)) / h) * visH;
    const sw = freeW * 0.94;
    this.sign.scale.set(sw / 4, sw / 4, 1);
    this.sign.position.set(0, visH * 0.115, -D);
  }

  open() {
    this.active = true;
    this.team = 0;
    const r = this.renderer.renderer;
    // Reflejos de estudio propios: no dependen de si el estadio está de día o de noche
    if (!this.env) {
      const pm = new THREE.PMREMGenerator(r);
      this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
      pm.dispose();
    }
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 0.8;
    this.key.castShadow = r.shadowMap.enabled;
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
    // Caja del auto sin la llama, para apoyarlo en la plataforma y medir su sombra
    const flameParent = v.flame.parent;
    flameParent?.remove(v.flame);
    const rz = v.group.rotation.z;
    v.group.rotation.z = 0;
    v.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(v.group);
    v.group.rotation.z = rz;
    flameParent?.add(v.flame);
    v.group.position.z += -box.min.z;
    const size = box.getSize(new THREE.Vector3());
    this.blob.scale.set(size.x * 1.28, size.y * 1.5, 1);
    this.blob.userData.cx = (box.min.x + box.max.x) / 2;
    this.carMid = size.z * 0.5;
    this.scene.add(v.group);
    this.car = v;
    (this.ring.material as THREE.MeshBasicMaterial).color.set(TEAM_COLORS[this.team]);
    this.drawSign(CAR_BODIES[lo.body].name.toUpperCase());
  }

  private carMid = 30;

  private update(dt: number) {
    this.time += dt;
    const v = this.car;
    if (v) {
      if (!this.dragging) this.spin = 0.3;
      v.group.rotation.z += this.spin * dt;
      const a = v.group.rotation.z, cx = (this.blob.userData.cx as number) ?? 0;
      this.blob.rotation.z = a;
      this.blob.position.set(Math.cos(a) * cx, Math.sin(a) * cx, 0.4);
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
    const tz = this.carMid + 4;
    this.camera.position.set(Math.cos(this.az) * Math.cos(this.el_) * this.dist, Math.sin(this.az) * Math.cos(this.el_) * this.dist, tz + Math.sin(this.el_) * this.dist);
    this.camera.lookAt(0, 0, tz);
  }

  // ---------- Panel ----------
  private can(u: Unlock) { return unlocked(u); }

  private itemBtn<T extends string>(it: Item<T>, cur: string, act: string, extra = ''): string {
    const ok = this.can(it.unlock);
    const lock = ok ? '' : unlockLabel(it.unlock, TIER_NAMES);
    return `<button class="card gi${it.id === cur ? ' on' : ''}${ok ? '' : ' lock'}" data-set="${act}" data-v="${it.id}" data-lock="${lock}" title="${it.desc ?? ''}">${extra}<span>${it.name}</span>${ok ? '' : `<em>${icon('lock', '')}${lock}</em>`}</button>`;
  }

  /** Nombre de lo que está elegido en la pestaña abierta (se muestra sobre la sala). */
  private currentName(lo: Loadout): string {
    const name = (list: { id: string; name: string }[], id: string) => list.find((x) => x.id === id)?.name ?? '';
    switch (this.tab) {
      case 'Carrocería': return CAR_BODIES[lo.body].name;
      case 'Pintura': return TEAM_PAINTS[this.team][lo.paint[this.team]].name;
      case 'Acabado': return name(FINISHES, lo.finish);
      case 'Calcomanía': return name(DECALS, lo.decal);
      case 'Llantas': return name(WHEELS, lo.wheel);
      case 'Estela': return name(TRAILS, lo.trail);
      case 'Explosión': return name(EXPLOSIONS, lo.explosion);
      case 'Título': return name(TITLES, lo.title);
      case 'Banner': return name(BANNERS, lo.banner);
    }
  }

  render() {
    const lo = getLoadout();
    const p = getProfile();
    const lv = levelInfo(p.xp).level;
    let body = '';
    switch (this.tab) {
      case 'Carrocería':
        body = `<div class="bodies">${bodyCards(lo.body, this.team, 'data-set="body" data-v')}</div>
          <p class="tip">Cada carrocería tiene su forma y su caja de choque. Probalas y quedate con la que mejor te resulte.</p>`;
        break;
      case 'Pintura': {
        const tp = TEAM_PAINTS[this.team];
        body = `<h4>Color principal · equipo ${this.team === 0 ? 'azul' : 'rojo'}</h4>
          <div class="sw-grid">${tp.map((c, i) => `<button class="sw${lo.paint[this.team] === i ? ' on' : ''}" style="--c:${c.hex}" data-set="paint" data-v="${i}" title="${c.name}" aria-label="${c.name}"></button>`).join('')}</div>
          <h4>Color secundario</h4>
          <div class="sw-grid">${SECONDARY_COLORS.map((c, i) => `<button class="sw${lo.secondary === i ? ' on' : ''}" style="--c:${c.hex}" data-set="secondary" data-v="${i}" title="${c.name}" aria-label="${c.name}"></button>`).join('')}</div>
          <p class="tip">El color principal siempre es del tono de tu equipo, para que se te reconozca en la cancha. Cambiá de equipo arriba a la derecha.</p>`;
        break;
      }
      case 'Acabado':
        body = `<div class="gi-grid">${FINISHES.map((f) => this.itemBtn(f, lo.finish, 'finish')).join('')}</div>`;
        break;
      case 'Calcomanía':
        body = `<div class="gi-grid">${DECALS.map((d) => this.itemBtn(d, lo.decal, 'decal')).join('')}</div>
          ${lo.decal === 'numero' ? `<div class="row"><label for="gvNum">Número</label><input id="gvNum" class="txt" type="number" min="0" max="99" value="${lo.decalNumber}"></div>` : ''}`;
        break;
      case 'Llantas':
        body = `<div class="gi-grid">${WHEELS.map((w) => this.itemBtn(w, lo.wheel, 'wheel')).join('')}</div>`;
        break;
      case 'Estela':
        body = `<div class="gi-grid">${TRAILS.map((t) => this.itemBtn(t, lo.trail, 'trail', `<i class="dot" style="background:linear-gradient(90deg,${t.style.core},${t.style.flame ?? TEAM_COLORS[this.team]})"></i>`)).join('')}</div>
          <button class="btn sm" data-gv="turbo">${this.turbo ? 'Apagar turbo' : 'Probar turbo'}</button>`;
        break;
      case 'Explosión':
        body = `<div class="gi-grid">${EXPLOSIONS.map((x) => this.itemBtn(x, lo.explosion, 'explosion')).join('')}</div>
          <button class="btn sm" data-gv="boom">Probar explosión</button>`;
        break;
      case 'Título':
        body = `<div class="gi-grid">${TITLES.map((t) => this.itemBtn(t, lo.title, 'title')).join('')}</div>`;
        break;
      case 'Banner':
        body = `<div class="gi-grid one">${BANNERS.map((b) => this.itemBtn(b, lo.banner, 'banner', `<i class="bn" style="background:${bannerBg(b.style)}"></i>`)).join('')}</div>`;
        break;
    }
    const total = allItems().length;
    const have = allItems().filter((x) => this.can(x.item.unlock)).length;
    const title = TITLES.find((t) => t.id === lo.title)?.name ?? '';
    const scroll = this.panel.querySelector('.gv-body')?.scrollTop ?? 0;
    this.panel.innerHTML = `
      <header class="gv-head"><h2>Garage</h2><span class="gv-count"><b>${have}</b> de ${total} desbloqueados</span>
        <div class="gv-who"><b>${p.name}</b> · ${title} · Nivel ${lv}</div></header>
      <div class="gv-main">
        <nav class="gv-tabs">${TABS.map((t) => `<button class="${t === this.tab ? 'on' : ''}" data-tab="${t}">${t}</button>`).join('')}</nav>
        <div class="gv-body">${body}</div>
      </div>
      <div class="gv-foot"><div class="gv-msg" id="gvMsg"></div><button class="btn primary" data-ui="back">Listo</button></div>`;
    const bodyEl = this.panel.querySelector('.gv-body');
    if (bodyEl) bodyEl.scrollTop = scroll;
    this.view.innerHTML = `
      <div class="gv-team"><span>Ver con los colores del equipo</span><div class="seg"><button data-team="0" class="${this.team === 0 ? 'on' : ''}">Azul</button><button data-team="1" class="${this.team === 1 ? 'on' : ''}">Rojo</button></div></div>
      <div class="gv-label"><small>${this.tab}</small><b>${this.currentName(lo)}</b></div>
      <div class="gv-hint">Arrastrá para girar · Rueda para acercar</div>`;
    if (this.tab === 'Carrocería') refreshBodyThumbs(this.panel);
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
