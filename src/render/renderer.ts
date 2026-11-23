// Compone la escena y dibuja "snapshots" de la simulación (el mismo formato sirve para repeticiones y online).

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { arenaRaycast } from '../sim/arena.ts';
import { BALL, CAR_BODIES } from '../sim/constants.ts';
import { V3 } from '../sim/math.ts';
import type { GameEvent, Snapshot } from '../sim/world.ts';
import { buildArenaSurface, buildFloor, Goals, wallMaterial } from './arenaMesh.ts';
import { CameraController, type CameraSettings } from './camera.ts';
import { buildCar, type CarVisual } from './carMesh.ts';
import { BallVisual, confettiTexture, ContactShadows, PadField, Particles, SkidMarks } from './effects.ts';
import { DEFAULT_BOOST, FlashBalls, Shockwaves, TrailSystem, type BoostStyle, type GoalFxStyle } from './fx.ts';
import { DynamicResolution, FpsMeter, PRESETS, QUALITY_LABELS, type QualityLevel } from './quality.ts';
import { BOOST_COLOR, TEAM_COLORS, TEAM_COLORS_LIGHT } from './palette.ts';
import { buildDaySky, buildNightSky, Stadium, type Theme } from './stadium.ts';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

/** Gradación de color: contraste suave, saturación y viñeta (look de transmisión deportiva). */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.28 }, uSat: { value: 1.08 }, uContrast: { value: 1.06 } },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uSat; uniform float uContrast; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = (c.rgb - 0.18) * uContrast + 0.18;
      c.rgb = max(c.rgb, 0.0);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVignette * dot(d, d) * 2.2;
      gl_FragColor = c;
    }`,
};

export interface CarInfo { id: number; team: number; bodyIndex: number; name: string }

export class GameRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  camCtl: CameraController;
  particles = new Particles();
  smoke = new Particles({ additive: false, grow: 3.5, max: 3000 });
  confetti = new Particles({ additive: false, texture: confettiTexture(), max: 1500 });
  trails = new TrailSystem(24);
  waves = new Shockwaves();
  flashes = new FlashBalls();
  padField = new PadField();
  goals = new Goals();
  /** Estilos personalizables (los define el garage): turbo por auto y explosión de gol por equipo. */
  boostStyles = new Map<number, BoostStyle>();
  goalStyles = new Map<number, GoalFxStyle>();
  dynRes = new DynamicResolution();
  fps: FpsMeter;
  stadium!: Stadium;
  theme: Theme;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private wallMat: THREE.ShaderMaterial;
  private sky: THREE.Mesh | null = null;
  private envGroup = new THREE.Group();
  private pmrem: THREE.PMREMGenerator;
  private envTex: THREE.Texture | null = null;
  private hdrCache = new Map<Theme, THREE.DataTexture>();
  private sun!: THREE.DirectionalLight;
  private sunDir = new THREE.Vector3(0, 0, 1);
  private skids = new SkidMarks();
  private contact = new ContactShadows(8);
  private lastWheels = new Map<number, THREE.Vector3[]>();
  private ball = new BallVisual();
  private cars = new Map<number, CarVisual & { team: number; name: string }>();
  private airborne = new Map<number, { air: boolean; vz: number }>();
  private lastT = performance.now();
  private baseRatio = 1;
  private container: HTMLElement;
  private nameLayer: HTMLDivElement;
  private time = 0;
  private flash: THREE.PointLight;
  localId = -1;
  quality: QualityLevel = 'alta';

  constructor(container: HTMLElement, camSettings: CameraSettings, theme: Theme = 'dia') {
    this.theme = theme;
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.info.autoReset = false; // acumula las llamadas de todos los pases del frame
    this.dynRes.enabled = !navigator.webdriver; // en pruebas automáticas no degradar la resolución
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);

    this.nameLayer = document.createElement('div');
    this.nameLayer.className = 'namelayer';
    container.appendChild(this.nameLayer);

    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 10, 900000);
    this.camCtl = new CameraController(this.camera, camSettings);

    this.flash = new THREE.PointLight('#ffffff', 0, 6000, 1.5);
    this.scene.add(this.flash);
    this.scene.add(this.envGroup);

    // Escena estática de juego (idéntica en todos los estadios)
    this.scene.add(buildFloor());
    this.fps = new FpsMeter(container);
    this.wallMat = wallMaterial();
    const walls = new THREE.Mesh(buildArenaSurface(40), this.wallMat);
    walls.renderOrder = 2;
    this.scene.add(walls);
    this.scene.add(this.goals.group, this.padField.group);
    this.scene.add(this.ball.group, this.ball.shadow);
    this.scene.add(this.smoke.points, this.particles.points, this.confetti.points, this.skids.mesh, this.contact.mesh,
      this.trails.mesh, this.waves.group, this.flashes.group);

    this.setTheme(theme);
    this.setQuality(this.quality);
    window.addEventListener('resize', () => this.resize());
  }

  /** Construye cielo, luces, reflejos y estadio según el tema (día / noche). */
  setTheme(theme: Theme) {
    this.theme = theme;
    this.scene.remove(this.envGroup);
    this.envGroup = new THREE.Group();
    this.scene.add(this.envGroup);
    const g = this.envGroup;
    const day = theme === 'dia';

    // Cielo provisorio (procedural) mientras carga el HDRI fotográfico
    if (day) {
      const el = (40 * Math.PI) / 180, az = (35 * Math.PI) / 180;
      this.sunDir.set(Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el));
      this.sky = buildDaySky(this.sunDir);
      this.scene.background = null;
      this.scene.fog = new THREE.Fog('#c9d8e6', 40000, 200000);
      this.renderer.toneMappingExposure = 0.85;
      g.add(new THREE.HemisphereLight('#d6e8ff', '#4e6b3d', 0.7));
      this.sun = new THREE.DirectionalLight('#fff1dc', 2.7);
      this.sun.position.copy(this.sunDir).multiplyScalar(12000);
      this.setupShadow(this.sun);
      g.add(this.sun, this.sun.target);
      this.wallMat.uniforms.uSky.value.set('#a9c8e8');
      this.wallMat.uniforms.uBoard.value.set('#1f2b3d');
    } else {
      this.sky = buildNightSky();
      this.scene.background = new THREE.Color('#02060d');
      this.scene.fog = new THREE.Fog('#070d18', 30000, 150000);
      this.renderer.toneMappingExposure = 1.0;
      g.add(new THREE.HemisphereLight('#9cb8e0', '#1c2a20', 0.65));
      this.sunDir.set(0.05, 0.08, 1).normalize();
      this.sun = new THREE.DirectionalLight('#f2f7ff', 2.4);
      this.sun.position.set(400, 700, 12000);
      this.setupShadow(this.sun);
      g.add(this.sun, this.sun.target);
      for (const [x, y] of [[7000, 8000], [-7000, -8000], [-7000, 8000], [7000, -8000]] as const) {
        const l = new THREE.DirectionalLight('#e6f0ff', 0.55);
        l.position.set(x, y, 5000);
        g.add(l);
      }
      this.wallMat.uniforms.uSky.value.set('#2a3e5c');
      this.wallMat.uniforms.uBoard.value.set('#141c28');
    }
    this.wallMat.uniforms.uSunDir.value.copy(this.sunDir);
    g.add(this.sky);
    this.stadium = new Stadium(theme);
    g.add(this.stadium.group);
    if (this.bloom) {
      this.bloom.strength = day ? 0.18 : 0.5;
      this.bloom.radius = day ? 0.25 : 0.5;
      this.bloom.threshold = day ? 4.0 : 0.85;
    }
    this.stadium.setSun(this.sunDir);
    this.applyStadiumQuality();
    this.captureEnvironment();
    void this.loadSky(theme);
  }

  /** Carga el cielo HDRI (CC0, Poly Haven), ubica el sol donde está en la foto y recaptura los reflejos. */
  private async loadSky(theme: Theme) {
    let tex = this.hdrCache.get(theme);
    if (!tex) {
      try {
        const loader = new HDRLoader().setDataType(THREE.FloatType);
        tex = await loader.loadAsync(`${import.meta.env.BASE_URL}assets/hdri/${theme === 'dia' ? 'cielo_dia' : 'cielo_noche'}.hdr`);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        this.hdrCache.set(theme, tex);
      } catch (e) {
        console.warn('No se pudo cargar el cielo HDRI; se usa el procedural.', e);
        return;
      }
    }
    if (this.theme !== theme) return;
    // Dirección del sol en la foto (píxel más brillante) → orientación del cielo para que el sol quede a 35° de azimut
    let yaw = 0;
    if (theme === 'dia') {
      const img = tex.image as { data: Float32Array; width: number; height: number };
      let best = -1, bi = 0;
      for (let i = 0; i < img.width * img.height; i++) {
        const l = img.data[i * 4] + img.data[i * 4 + 1] + img.data[i * 4 + 2];
        if (l > best) { best = l; bi = i; }
      }
      const px = bi % img.width, py = Math.floor(bi / img.width);
      const u = (px + 0.5) / img.width, v = 1 - (py + 0.5) / img.height;
      const lon = (u - 0.5) * 2 * Math.PI, lat = (v - 0.5) * Math.PI;
      // Dirección en el marco Y-arriba del HDRI → nuestro mundo Z-arriba (rotación X +90°)
      const dy = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      const w0 = new THREE.Vector3(dy.x, -dy.z, dy.y);
      yaw = (35 * Math.PI) / 180 - Math.atan2(w0.y, w0.x);
      this.sunDir.copy(w0).applyAxisAngle(new THREE.Vector3(0, 0, 1), yaw).normalize();
      if (this.sunDir.z < 0.35) { this.sunDir.z = 0.35; this.sunDir.normalize(); }
      this.sun.position.copy(this.sunDir).multiplyScalar(12000);
      this.wallMat.uniforms.uSunDir.value.copy(this.sunDir);
      this.stadium.setSun(this.sunDir);
    }
    this.scene.background = tex;
    this.scene.backgroundRotation.set(Math.PI / 2, 0, yaw, 'ZXY');
    this.scene.backgroundIntensity = theme === 'dia' ? 0.55 : 1.6;
    if (this.sky) { this.envGroup.remove(this.sky); this.sky = null; }
    this.captureEnvironment();
  }

  /** Reflejos reales: fotografía cúbica del estadio desde el centro de la cancha (sin autos ni pelota). */
  captureEnvironment() {
    const hidden: THREE.Object3D[] = [this.ball.group, this.ball.shadow, this.particles.points, this.smoke.points, this.confetti.points, this.skids.mesh,
      this.trails.mesh, this.waves.group, this.flashes.group, this.contact.mesh];
    for (const v of this.cars.values()) hidden.push(v.group);
    const prev = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    const rt = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
    const cube = new THREE.CubeCamera(10, 300000, rt);
    cube.position.set(0, 0, 700);
    const env = this.scene.environment;
    this.scene.environment = null;
    cube.update(this.renderer, this.scene);
    this.scene.environment = env;
    hidden.forEach((o, i) => (o.visible = prev[i]));
    const pm = this.pmrem.fromCubemap(rt.texture);
    rt.dispose();
    this.envTex?.dispose();
    this.envTex = pm.texture;
    this.scene.environment = this.envTex;
    this.scene.environmentIntensity = this.theme === 'dia' ? 0.7 : 0.9;
  }

  private setupShadow(l: THREE.DirectionalLight) {
    const p = PRESETS[this.quality];
    l.target.position.set(0, 0, 0);
    l.castShadow = p.shadows !== 'off';
    l.shadow.mapSize.set(p.shadowMapSize, p.shadowMapSize);
    // Frustum ajustado a la cancha y las gradas con techo (no más grande de lo necesario)
    const sc = l.shadow.camera;
    sc.left = -7000; sc.right = 7000; sc.top = 7000; sc.bottom = -7000; sc.near = 3000; sc.far = 22000;
    l.shadow.bias = -0.0004;
    l.shadow.normalBias = 4;
  }

  private applyStadiumQuality() {
    const p = PRESETS[this.quality];
    this.stadium.setCrowdQuality(p.crowdDensity, !p.post || p.msaa > 0);
    this.updateViewport();
  }

  private setupComposer() {
    const p = PRESETS[this.quality];
    if (this.composer) { this.composer.dispose(); this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    this.composer = null;
    this.bloom = null;
    if (!p.post) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    // Antialiasing real (MSAA) dentro del pipeline de post-proceso
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: p.msaa });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (p.gtao !== 'off') {
      // Oclusión ambiental (sombras de contacto en rincones, bajo los autos y en las gradas); a media resolución en "Alta"
      const half = p.gtao === 'half';
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      if (half) {
        const orig = ao.setSize.bind(ao);
        ao.setSize = (w: number, h: number) => orig(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
        ao.setSize(size.x, size.y);
      }
      ao.updateGtaoMaterial({ radius: 90, distanceExponent: 1.2, thickness: 30, scale: 1.1, samples: half ? 10 : 14 });
      ao.blendIntensity = 0.85;
      // Sin oclusión sobre sprites, partículas, líneas ni materiales transparentes (brillos, estelas, ondas, redes, público)
      const aoAny = ao as unknown as { _overrideVisibility: () => void; _visibilityCache: THREE.Object3D[]; scene: THREE.Scene };
      aoAny._overrideVisibility = function () {
        const cache = this._visibilityCache;
        this.scene.traverse((o) => {
          if (!o.visible) return;
          const m = o as THREE.Mesh;
          const mat = m.material as THREE.Material | THREE.Material[] | undefined;
          const transp = !!mat && (Array.isArray(mat) ? mat.some((x) => x.transparent) : mat.transparent);
          const blend = !!mat && !Array.isArray(mat) && mat.blending !== THREE.NormalBlending;
          if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite || transp || blend || o.userData.noAO) {
            o.visible = false;
            cache.push(o);
          }
        });
      };
      this.composer.addPass(ao);
    }
    const day = this.theme === 'dia';
    if (p.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), day ? 0.18 : 0.5, day ? 0.25 : 0.5, day ? 4.0 : 0.85);
      this.composer.addPass(this.bloom);
    }
    this.composer.addPass(new ShaderPass(GradeShader));
    this.composer.addPass(new OutputPass());
  }

  setQuality(q: QualityLevel) {
    this.quality = q;
    const p = PRESETS[q];
    this.dynRes.minScale = p.minScale;
    this.dynRes.reset();
    this.dynRes.scale = 1;
    this.particles.density = p.particles;
    this.smoke.density = p.particles;
    this.confetti.density = p.particles;
    this.renderer.shadowMap.enabled = p.shadows !== 'off';
    this.setupShadow(this.sun);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.baseRatio = Math.min(window.devicePixelRatio || 1, p.pixelRatio);
    this.renderer.setPixelRatio(this.baseRatio);
    this.setupComposer();
    this.resize();
    this.applyStadiumQuality();
    // Las sombras y el MSAA cambian los programas de los materiales
    this.scene.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
    });
  }

  /** Nombre legible del preset actual (para el HUD). */
  get qualityLabel() { return QUALITY_LABELS[this.quality]; }

  private applyScale() {
    const r = this.baseRatio * this.dynRes.scale;
    this.renderer.setPixelRatio(r);
    this.composer?.setPixelRatio(r);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
    this.updateViewport();
  }

  private updateViewport() {
    const h = window.innerHeight * this.renderer.getPixelRatio();
    for (const p of [this.particles, this.smoke, this.confetti]) p.setViewportHeight(h, this.camera.fov);
    this.padField.setViewportHeight(h, this.camera.fov);
    this.stadium.setViewportHeight(h, this.camera.fov);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camCtl.updateFov(w / h);
    this.updateViewport();
  }

  setupCars(cars: CarInfo[], localId: number) {
    this.skids.clear();
    this.lastWheels.clear();
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

  /**
   * Explosión de gol parametrizable: `style.kind` elige la forma y los colores salen del estilo.
   * Los cosméticos del garage llaman a esta función con su propio estilo (ver GoalFxStyle).
   */
  playGoalFx(style: GoalFxStyle, p: THREE.Vector3) {
    const c1 = new THREE.Color(style.primary), c2 = new THREE.Color(style.secondary), white = new THREE.Color('#ffffff');
    const up = new THREE.Vector3(0, 0, 1);
    this.flashes.spawn(p, c1, style.kind === 'nova' ? 1700 : 1100, style.kind === 'nova' ? 0.9 : 0.6);
    this.waves.spawn(p, up, c1, 100, style.kind === 'nova' ? 4200 : 2600, 1.1);
    this.waves.spawn(p, new THREE.Vector3(0, 1, 0), c2, 100, style.kind === 'nova' ? 3000 : 1800, 0.9, 0.8);
    switch (style.kind) {
      case 'confeti': {
        const cols = [c1, c2, white, new THREE.Color('#ffd166')];
        this.confetti.burst(p, 420, 2200, cols, 46, 3.2, -650, 0.9);
        this.particles.burst(p, 200, 1800, [c1, white], 30, 1.2, -400);
        break;
      }
      case 'chispas': {
        this.particles.burst(p, 700, 3200, [c1, c2, white], 20, 1.6, -900, 0.8);
        for (let i = 0; i < 70; i++) {
          const a = Math.random() * Math.PI * 2, s = 600 + Math.random() * 900;
          this.particles.spawn(p.x, p.y, p.z, Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5, 1800 + Math.random() * 1800, i % 2 ? c1 : c2, 50, 1.6, -1400, 0.4, white);
        }
        break;
      }
      case 'nova': {
        this.particles.burst(p, 1100, 3600, [c1, c2, white], 36, 2, -300, 1.0);
        this.particles.burst(p, 360, 1100, [white, c2], 70, 1.3, 0);
        this.waves.spawn(p, new THREE.Vector3(1, 0, 0), c1, 100, 2400, 1.0, 0.7);
        break;
      }
      default: {
        this.particles.burst(p, 900, 2600, [c1, c2, white], 28, 1.8, -500, 1.2, white);
        this.particles.burst(p, 260, 900, [white, new THREE.Color(BOOST_COLOR)], 60, 1.0, 0);
      }
    }
    this.flash.position.copy(p);
    this.flash.color.copy(c1);
    this.flash.intensity = 22;
  }

  private goalStyle(team: number): GoalFxStyle {
    return this.goalStyles.get(team) ?? { kind: 'clasica', primary: TEAM_COLORS[team], secondary: TEAM_COLORS_LIGHT[team] };
  }

  /** Polvo / pasto levantado al aterrizar o rebotar contra una superficie. */
  dust(at: THREE.Vector3, normal: THREE.Vector3, strength: number) {
    const k = Math.min(1, strength / 1800);
    const col = this.theme === 'dia' ? new THREE.Color('#b9c79a') : new THREE.Color('#6d7a74');
    this.smoke.ring(at, normal, 10 + 22 * k, 220 + 500 * k, col, 60 + 50 * k, 0.7 + 0.5 * k);
    this.particles.ring(at, normal, 6 + 14 * k, 380 + 700 * k, new THREE.Color('#fff2c8'), 14, 0.35);
    if (k > 0.35) this.waves.spawn(at.clone().addScaledVector(normal, 4), normal, new THREE.Color('#ffffff'), 40, 220 + 300 * k, 0.4, 0.35);
  }

  onEvent(ev: GameEvent, snap: Snapshot) {
    switch (ev.type) {
      case 'goal': {
        const p = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z);
        this.playGoalFx(this.goalStyle(ev.team), p);
        this.goals.impact(1 - ev.team, p, ev.speed);
        this.camCtl.shake(60);
        this.stadium.cheer(1);
        break;
      }
      case 'demo': {
        const p = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z);
        this.particles.burst(p, 260, 1200, [new THREE.Color('#ff9a3d'), new THREE.Color('#ffd166'), new THREE.Color('#444444')], 60, 1.1, -300);
        this.smoke.burst(p, 40, 500, [new THREE.Color('#555555'), new THREE.Color('#888888')], 130, 1.4, 60, 1.5);
        this.waves.spawn(p, new THREE.Vector3(0, 0, 1), new THREE.Color('#ffb347'), 60, 900, 0.5, 0.8);
        this.flashes.spawn(p, new THREE.Color('#ffb347'), 380, 0.3);
        this.camCtl.shake(ev.victim === this.localId ? 40 : 10);
        break;
      }
      case 'hit': {
        const p = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z);
        const n = Math.min(60, Math.floor(ev.strength / 40));
        this.particles.burst(p, n, 500 + ev.strength * 0.2, [new THREE.Color('#ffffff'), new THREE.Color('#9fe8ff'), new THREE.Color('#ffd98a')], 24, 0.35, -300, 0.8);
        if (ev.strength > 1200) {
          const car = snap.cars.find((c) => c.id === ev.carId);
          const nrm = car ? new THREE.Vector3(car.x - p.x, car.y - p.y, car.z - p.z).normalize() : new THREE.Vector3(0, 0, 1);
          this.waves.spawn(p, nrm, new THREE.Color('#ffffff'), 30, 140 + Math.min(260, ev.strength * 0.08), 0.28, 0.7);
          this.flashes.spawn(p, new THREE.Color('#ffffff'), 90 + Math.min(120, ev.strength * 0.03), 0.16);
        }
        if (ev.carId === this.localId && ev.strength > 1800) this.camCtl.shake(8);
        break;
      }
      case 'bounce': {
        const p = new THREE.Vector3(ev.pos.x, ev.pos.y, ev.pos.z);
        if (ev.strength > 700) {
          const g = arenaRaycast(new V3(p.x, p.y, p.z), new V3(0, 0, -1), BALL.RADIUS + 120);
          if (g) this.dust(new THREE.Vector3(g.point.x, g.point.y, g.point.z + 3), new THREE.Vector3(g.normal.x, g.normal.y, g.normal.z), ev.strength * 0.6);
        }
        break;
      }
      case 'pad': {
        const c = snap.cars.find((x) => x.id === ev.carId);
        if (c) {
          const at = new THREE.Vector3(c.x, c.y, c.z + 30);
          this.particles.burst(at, ev.big ? 40 : 12, 300, [new THREE.Color(BOOST_COLOR)], 26, 0.4, 200);
          if (ev.big) this.waves.spawn(new THREE.Vector3(c.x, c.y, c.z - 10), new THREE.Vector3(0, 0, 1), new THREE.Color(BOOST_COLOR), 60, 420, 0.45, 0.7);
        }
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
    const su = (this.sky?.material as THREE.ShaderMaterial | undefined)?.uniforms;
    if (su?.uTime) su.uTime.value = this.time;
    if (su?.time) su.time.value = this.time;
    this.stadium.update(this.time, dt);
    this.goals.update(this.time);
    this.wallMat.uniforms.uTime.value = this.time;
    this.flash.intensity *= Math.exp(-dt * 4);

    // Pelota
    const b = snap.ball;
    this.ball.group.visible = !b.hidden;
    this.ball.group.position.set(b.x, b.y, b.z);
    this.ball.mesh.quaternion.set(b.qx, b.qy, b.qz, b.qw);
    const bspeed = Math.hypot(b.vx, b.vy, b.vz);
    (this.ball.glow.material as THREE.SpriteMaterial).opacity = this.theme === 'noche' ? 0.12 + Math.min(0.3, bspeed / 10000) : 0;
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
    // Estela de la pelota (cinta) + chispitas a alta velocidad
    if (!b.hidden && bspeed > 1800) {
      const k = Math.min(1, (bspeed - 1800) / 3200);
      const col = new THREE.Color('#bff7ff').lerp(new THREE.Color('#ffffff'), k);
      this.trails.push('ball', new THREE.Vector3(b.x, b.y, b.z), BALL.RADIUS * (0.55 + 0.35 * k), col, 0.25 + 0.55 * k, 0.4);
      if (Math.random() < 0.5 * k) this.particles.spawn(b.x + (Math.random() - 0.5) * 80, b.y + (Math.random() - 0.5) * 80, b.z + (Math.random() - 0.5) * 80, 0, 0, 0, col, 70 + 60 * k, 0.3, 0, 0);
    } else this.trails.end('ball');

    // Autos
    let shadowIdx = 0;
    for (const cs of snap.cars) {
      const v = this.cars.get(cs.id);
      if (!v) continue;
      v.group.visible = !cs.demoed;
      if (v.nameplate) v.nameplate.style.display = cs.demoed || mode === 'menu' ? 'none' : '';
      if (cs.demoed) { this.lastWheels.delete(cs.id); continue; }
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
      // Luces de freno
      const braking = (cs.throttle < -0.1 && speedF > 50) || (cs.throttle > 0.1 && speedF < -50);
      v.brakeLights.color.set(braking ? '#ff2a3d' : '#7a0a18');
      // Sombra de contacto
      const up = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const ground = arenaRaycast(new V3(cs.x, cs.y, cs.z), new V3(0, 0, -1), 900);
      const yawC = Math.atan2(fwd.y, fwd.x);
      if (ground && up.z > 0.3) {
        const h = Math.max(0, cs.z - 17 - ground.point.z);
        this.contact.set(shadowIdx++, true, ground.point.x, ground.point.y, ground.point.z, ground.normal.x, ground.normal.y, ground.normal.z, yawC, 120, 85, h);
      }
      // Marcas de neumáticos al derrapar o patinar de costado
      const vel = new THREE.Vector3(cs.vx, cs.vy, cs.vz);
      const right = new THREE.Vector3(fwd.y, -fwd.x, 0).normalize();
      const lateral = Math.abs(vel.dot(right));
      const skid = cs.onGround && up.z > 0.9 && vel.length() > 250 && (cs.handbrake > 0.35 || lateral > 380);
      const prev = this.lastWheels.get(cs.id);
      if (skid) {
        v.group.updateMatrixWorld();
        const rears = v.wheels.slice(2).map((w) => w.getWorldPosition(new THREE.Vector3()));
        if (prev) rears.forEach((p, k) => this.skids.add(prev[k].x, prev[k].y, p.x, p.y, 0, 13));
        this.lastWheels.set(cs.id, rears);
      } else this.lastWheels.delete(cs.id);
      // Aterrizaje: polvo y chispas
      const st = this.airborne.get(cs.id) ?? { air: false, vz: 0 };
      if (cs.onGround && st.air && st.vz < -450 && ground) {
        this.dust(new THREE.Vector3(ground.point.x, ground.point.y, ground.point.z + 3), new THREE.Vector3(ground.normal.x, ground.normal.y, ground.normal.z), -st.vz * 0.9);
      }
      st.air = !cs.onGround;
      st.vz = cs.vz;
      this.airborne.set(cs.id, st);
      // Turbo: llama, chispas y humo según el estilo del auto
      v.flame.visible = cs.boosting;
      if (cs.boosting) this.boostFx(v, cs, fwd, q);
      // Supersónico: estela de cinta
      const tid = 'car' + cs.id;
      if (cs.supersonic) {
        const back = fwd.clone().multiplyScalar(-40);
        this.trails.push(tid, new THREE.Vector3(cs.x + back.x, cs.y + back.y, cs.z + back.z + 10), 26, new THREE.Color(TEAM_COLORS_LIGHT[v.team]).lerp(new THREE.Color('#ffffff'), 0.5), 0.55, 0.35);
      } else this.trails.end(tid);
      // Nombre sobre el auto
      if (v.nameplate && cs.id !== this.localId && mode !== 'menu') {
        const p = new THREE.Vector3(cs.x, cs.y, cs.z + 110).project(this.camera);
        const vis = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
        v.nameplate.style.display = vis ? '' : 'none';
        if (vis) v.nameplate.style.transform = `translate(${((p.x + 1) / 2) * window.innerWidth}px, ${((1 - p.y) / 2) * window.innerHeight}px) translate(-50%, -100%)`;
      }
    }

    for (let i = shadowIdx; i < 8; i++) this.contact.set(i, false);

    this.padField.update(snap.pads, dt, this.time);
    this.particles.update(dt);
    this.smoke.update(dt);
    this.confetti.update(dt);
    this.trails.update(dt, this.camera.position);
    this.waves.update(dt);
    this.flashes.update(dt);

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

    // Resolución dinámica y contador de fps
    const now = performance.now();
    const real = (now - this.lastT) / 1000;
    this.lastT = now;
    if (this.dynRes.update(real)) this.applyScale();
    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    const inf = this.renderer.info.render;
    this.fps.tick(real, { calls: inf.calls, triangles: inf.triangles }, this.dynRes.scale, this.qualityLabel);
  }

  /** Llama, chispas y humo del turbo; `BoostStyle` personalizable por auto (this.boostStyles). */
  private boostFx(v: CarVisual & { team: number }, cs: Snapshot['cars'][number], fwd: THREE.Vector3, q: THREE.Quaternion) {
    const st = this.boostStyles.get(cs.id) ?? DEFAULT_BOOST[v.team] ?? DEFAULT_BOOST[0];
    const f = 0.8 + Math.random() * 0.4;
    v.flame.scale.set(st.kind === 'humo' ? 0.35 : f * (st.kind === 'plasma' ? 1.25 : 1), st.kind === 'plasma' ? 0.6 : 1, st.kind === 'plasma' ? 0.6 : 1);
    const rear = v.rearOffset.clone().applyQuaternion(q).add(v.group.position);
    const back = fwd.clone().multiplyScalar(-1);
    const core = new THREE.Color(st.core), flame = new THREE.Color(st.flame), tip = new THREE.Color(st.tip);
    if (st.kind !== 'humo') {
      const n = this.particles.count(st.kind === 'chispas' ? 1 : 3);
      for (let i = 0; i < n; i++) {
        const sp = 400 + Math.random() * 300;
        this.particles.spawn(rear.x + back.x * 40, rear.y + back.y * 40, rear.z + back.z * 40,
          back.x * sp + cs.vx * 0.6 + (Math.random() - 0.5) * 120, back.y * sp + cs.vy * 0.6 + (Math.random() - 0.5) * 120, back.z * sp + cs.vz * 0.6 + (Math.random() - 0.5) * 120,
          i === 0 ? core : flame, 38, 0.28, 0, 2, tip);
      }
    }
    if (st.sparks) {
      const n = this.particles.count(st.kind === 'chispas' ? 3 : 1);
      for (let i = 0; i < n; i++) {
        const sp = 600 + Math.random() * 900;
        this.particles.spawn(rear.x + back.x * 50, rear.y + back.y * 50, rear.z + back.z * 50,
          back.x * sp + cs.vx * 0.5 + (Math.random() - 0.5) * 500, back.y * sp + cs.vy * 0.5 + (Math.random() - 0.5) * 500, back.z * sp + cs.vz * 0.5 + (Math.random() - 0.3) * 500,
          core, 14, 0.5 + Math.random() * 0.4, -900, 0.5, flame);
      }
    }
    if (st.smoke && this.smoke.count(1) > 0) {
      const gray = 0.75 + Math.random() * 0.2;
      this.smoke.spawn(rear.x + back.x * 70, rear.y + back.y * 70, rear.z + back.z * 70,
        cs.vx * 0.15 + (Math.random() - 0.5) * 60, cs.vy * 0.15 + (Math.random() - 0.5) * 60, cs.vz * 0.15 + 40,
        new THREE.Color(gray, gray, gray * 1.02), 55, 0.9, 30, 1.5);
    }
  }
}
