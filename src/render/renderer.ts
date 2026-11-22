// Compone la escena y dibuja "snapshots" de la simulación (el mismo formato sirve para repeticiones y online).

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { arenaRaycast } from '../sim/arena.ts';
import { BALL, CAR_BODIES } from '../sim/constants.ts';
import { V3 } from '../sim/math.ts';
import type { GameEvent, Snapshot } from '../sim/world.ts';
import { buildArenaSurface, buildFloor, buildGoals, wallMaterial } from './arenaMesh.ts';
import { CameraController, type CameraSettings } from './camera.ts';
import { buildCar, type CarVisual } from './carMesh.ts';
import { BallVisual, buildPads, Particles, type PadVisual } from './effects.ts';
import { BOOST_COLOR, TEAM_COLORS, TEAM_COLORS_LIGHT } from './palette.ts';
import { buildSky, Stadium } from './stadium.ts';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

export interface CarInfo { id: number; team: number; bodyIndex: number; name: string }

export class GameRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  camCtl: CameraController;
  particles = new Particles();
  stadium = new Stadium();
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private wallMat: THREE.ShaderMaterial;
  private sky: THREE.Mesh;
  private ball = new BallVisual();
  private cars = new Map<number, CarVisual & { team: number; name: string }>();
  private pads: PadVisual[] = [];
  private nameLayer: HTMLDivElement;
  private time = 0;
  private flash: THREE.PointLight;
  localId = -1;
  quality: 'alta' | 'baja' = 'alta';

  constructor(container: HTMLElement, camSettings: CameraSettings) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.nameLayer = document.createElement('div');
    this.nameLayer.className = 'namelayer';
    container.appendChild(this.nameLayer);

    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 10, 130000);
    this.camCtl = new CameraController(this.camera, camSettings);

    this.scene.background = new THREE.Color('#02060d');
    // Reflejos: entorno procedural para que la pintura metálica de los autos brille
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.fog = new THREE.Fog('#061220', 14000, 60000);

    // Luces
    this.scene.add(new THREE.HemisphereLight('#9cc8ff', '#1c3a2a', 0.9));
    const sun = new THREE.DirectionalLight('#ffffff', 2.0);
    sun.position.set(300, 500, 8000);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const sc = sun.shadow.camera;
    sc.left = -4400; sc.right = 4400; sc.top = 6300; sc.bottom = -6300; sc.near = 4000; sc.far = 12000;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 2;
    this.scene.add(sun, sun.target);
    for (const [x, y, c] of [[6000, 7000, '#bfe0ff'], [-6000, -7000, '#bfe0ff'], [-6000, 7000, '#ffd9e0'], [6000, -7000, '#d9ecff']] as const) {
      const l = new THREE.DirectionalLight(c, 0.35);
      l.position.set(x, y, 5000);
      this.scene.add(l);
    }
    this.flash = new THREE.PointLight('#ffffff', 0, 6000, 1.5);
    this.scene.add(this.flash);

    // Escena estática
    this.sky = buildSky();
    this.scene.add(this.sky);
    this.scene.add(this.stadium.group);
    this.scene.add(buildFloor());
    this.wallMat = wallMaterial();
    const walls = new THREE.Mesh(buildArenaSurface(40), this.wallMat);
    walls.renderOrder = 2;
    this.scene.add(walls);
    this.scene.add(buildGoals());
    const padGroup = new THREE.Group();
    this.pads = buildPads(padGroup);
    this.scene.add(padGroup);
    this.scene.add(this.ball.group, this.ball.shadow);
    this.scene.add(this.particles.points);

    this.setupComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  private setupComposer() {
    if (this.quality !== 'alta') { this.composer = null; return; }
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setQuality(q: 'alta' | 'baja') {
    this.quality = q;
    this.renderer.shadowMap.enabled = q === 'alta';
    this.renderer.setPixelRatio(q === 'alta' ? Math.min(window.devicePixelRatio, 2) : 1);
    this.setupComposer();
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camCtl.updateFov(w / h);
    this.particles.setViewportHeight(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  setupCars(cars: CarInfo[], localId: number) {
    for (const v of this.cars.values()) { this.scene.remove(v.group); v.nameplate?.remove(); }
    this.cars.clear();
    this.localId = localId;
    for (const c of cars) {
      const v = buildCar(CAR_BODIES[c.bodyIndex % CAR_BODIES.length], c.team);
      this.scene.add(v.group);
      const np = document.createElement('div');
      np.className = 'nameplate team' + c.team;
      np.textContent = c.name;
      if (c.id !== localId) this.nameLayer.appendChild(np);
      this.cars.set(c.id, { ...v, team: c.team, name: c.name, nameplate: np });
    }
  }

  onEvent(ev: GameEvent, snap: Snapshot) {
    switch (ev.type) {
      case 'goal': {
        const p = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z);
        const tc = new THREE.Color(TEAM_COLORS[ev.team]);
        const tl = new THREE.Color(TEAM_COLORS_LIGHT[ev.team]);
        const white = new THREE.Color('#ffffff');
        this.particles.burst(p, 900, 2600, [tc, tl, white], 70, 1.8, -500);
        this.particles.burst(p, 300, 900, [white, new THREE.Color(BOOST_COLOR)], 120, 1.2, 0);
        this.flash.position.copy(p);
        this.flash.color.copy(tc);
        this.flash.intensity = 40;
        this.camCtl.shake(60);
        break;
      }
      case 'demo': {
        const p = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z);
        this.particles.burst(p, 260, 1200, [new THREE.Color('#ff9a3d'), new THREE.Color('#ffd166'), new THREE.Color('#444444')], 60, 1.1, -300);
        this.camCtl.shake(ev.victim === this.localId ? 40 : 10);
        break;
      }
      case 'hit': {
        const p = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z);
        const n = Math.min(60, Math.floor(ev.strength / 40));
        this.particles.burst(p, n, 500 + ev.strength * 0.2, [new THREE.Color('#ffffff'), new THREE.Color('#9fe8ff')], 22, 0.35, 0);
        if (ev.carId === this.localId && ev.strength > 1800) this.camCtl.shake(8);
        break;
      }
      case 'pad': {
        const c = snap.cars.find((x) => x.id === ev.carId);
        if (c) this.particles.burst(new THREE.Vector3(c.x, c.y, c.z + 30), ev.big ? 40 : 12, 300, [new THREE.Color(BOOST_COLOR)], 26, 0.4, 200);
        break;
      }
      case 'bump': {
        const p = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z);
        this.particles.burst(p, 20, 400, [new THREE.Color('#ffffff')], 20, 0.3, 0);
        break;
      }
      default:
        break;
    }
  }

  /** Dibuja un snapshot (ya interpolado). mode: 'play' sigue al auto local, 'replay' plano de transmisión, 'menu' órbita. */
  render(snap: Snapshot, dt: number, mode: 'play' | 'replay' | 'menu', look = { x: 0, y: 0 }, focusId = -1) {
    this.time += dt;
    (this.sky.material as THREE.ShaderMaterial).uniforms.uTime.value = this.time;
    this.wallMat.uniforms.uTime.value = this.time;
    this.flash.intensity *= Math.exp(-dt * 4);

    // Pelota
    const b = snap.ball;
    this.ball.group.visible = !b.hidden;
    this.ball.group.position.set(b.x, b.y, b.z);
    this.ball.mesh.quaternion.set(b.qx, b.qy, b.qz, b.qw);
    const bspeed = Math.hypot(b.vx, b.vy, b.vz);
    (this.ball.glow.material as THREE.SpriteMaterial).opacity = 0.25 + Math.min(0.5, bspeed / 8000);
    // Sombra de la pelota: proyectada hacia abajo sobre la superficie
    const hit = !b.hidden ? arenaRaycast(new V3(b.x, b.y, b.z), new V3(0, 0, -1), 2200) : null;
    this.ball.shadow.visible = !!hit && hit.normal.z > 0.5;
    if (hit) {
      this.ball.shadow.position.set(hit.point.x + hit.normal.x * 2, hit.point.y + hit.normal.y * 2, hit.point.z + hit.normal.z * 2);
      this.ball.shadow.lookAt(hit.point.x + hit.normal.x * 10, hit.point.y + hit.normal.y * 10, hit.point.z + hit.normal.z * 10);
      const h = Math.max(0, b.z - BALL.RADIUS - hit.point.z);
      const s = 1 + h / 1800;
      this.ball.shadow.scale.set(s, s, 1);
      (this.ball.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.25, 1 - h / 2400);
    }
    if (!b.hidden && bspeed > 1600) {
      const k = Math.min(1, (bspeed - 1600) / 2500);
      const col = new THREE.Color('#bff7ff').lerp(new THREE.Color('#ffffff'), k);
      for (let i = 0; i < 2; i++) {
        this.particles.spawn(b.x + (Math.random() - 0.5) * 60, b.y + (Math.random() - 0.5) * 60, b.z + (Math.random() - 0.5) * 60, 0, 0, 0, col, 90 + 80 * k, 0.35, 0, 0);
      }
    }

    // Autos
    for (const cs of snap.cars) {
      const v = this.cars.get(cs.id);
      if (!v) continue;
      v.group.visible = !cs.demoed;
      if (v.nameplate) v.nameplate.style.display = cs.demoed || mode === 'menu' ? 'none' : '';
      if (cs.demoed) continue;
      v.group.position.set(cs.x, cs.y, cs.z);
      v.group.quaternion.set(cs.qx, cs.qy, cs.qz, cs.qw);
      const q = v.group.quaternion;
      const fwd = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const speedF = cs.vx * fwd.x + cs.vy * fwd.y + cs.vz * fwd.z;
      for (const w of v.wheels) {
        const spin = w.children[0];
        spin.rotation.y += (speedF / v.wheelRadius) * dt;
      }
      for (const w of v.frontWheels) w.rotation.z = -cs.steer * 0.45;
      // Turbo
      v.flame.visible = cs.boosting;
      if (cs.boosting) {
        const f = 0.8 + Math.random() * 0.4;
        v.flame.scale.set(f, 1, 1);
        const rear = v.rearOffset.clone().applyQuaternion(q).add(v.group.position);
        const back = fwd.clone().multiplyScalar(-1);
        for (let i = 0; i < 3; i++) {
          const sp = 400 + Math.random() * 300;
          const col = new THREE.Color(i === 0 ? BOOST_COLOR : TEAM_COLORS_LIGHT[v.team]);
          this.particles.spawn(rear.x + back.x * 40, rear.y + back.y * 40, rear.z + back.z * 40,
            back.x * sp + cs.vx * 0.6 + (Math.random() - 0.5) * 120, back.y * sp + cs.vy * 0.6 + (Math.random() - 0.5) * 120, back.z * sp + cs.vz * 0.6 + (Math.random() - 0.5) * 120,
            col, 38, 0.28, 0, 2);
        }
      }
      if (cs.supersonic) {
        const back = fwd.clone().multiplyScalar(-70);
        this.particles.spawn(cs.x + back.x, cs.y + back.y, cs.z + back.z + 10, 0, 0, 0, new THREE.Color('#e8f4ff'), 50, 0.5, 0, 0);
      }
      // Nombre sobre el auto
      if (v.nameplate && cs.id !== this.localId && mode !== 'menu') {
        const p = new THREE.Vector3(cs.x, cs.y, cs.z + 110).project(this.camera);
        const vis = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
        v.nameplate.style.display = vis ? '' : 'none';
        if (vis) v.nameplate.style.transform = `translate(${((p.x + 1) / 2) * window.innerWidth}px, ${((1 - p.y) / 2) * window.innerHeight}px) translate(-50%, -100%)`;
      }
    }

    // Pads
    snap.pads.forEach((on, i) => {
      const pv = this.pads[i];
      pv.on += ((on ? 1 : 0) - pv.on) * Math.min(1, dt * 8);
      pv.core.visible = pv.on > 0.05;
      const s = 0.2 + pv.on * 0.8;
      pv.core.scale.set(s, s, s);
      if (pv.big) {
        pv.core.rotation.z = this.time * 1.5;
        pv.core.position.z = 110 + Math.sin(this.time * 2 + i) * 10;
      }
    });

    this.particles.update(dt);

    // Cámara
    if (mode === 'menu') {
      this.camCtl.orbit(this.time);
    } else if (mode === 'replay') {
      const focus = snap.cars.find((c) => c.id === focusId) ?? null;
      this.camCtl.replay(b, focus, dt);
    } else {
      const me = snap.cars.find((c) => c.id === this.localId);
      if (me && !me.demoed) this.camCtl.follow(me, b, dt, look.x, look.y);
      else if (me) this.camCtl.replay(b, null, dt);
    }
    this.wallMat.uniforms.uCam.value.copy(this.camera.position);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
