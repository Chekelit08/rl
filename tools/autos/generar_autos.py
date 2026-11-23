# Genera las seis carrocerías de TURBOGOL en Blender y las exporta como GLB (diseños propios).
# Uso:  /Applications/Blender.app/Contents/MacOS/Blender --background --python tools/autos/generar_autos.py -- [carpeta_previa]
# Cada auto es una grilla de secciones (cola → trompa) con vidrios, luces y rejillas marcados por material,
# suavizada con subdivisión y con los pasarruedas recortados por booleana. Coordenadas del juego:
# X adelante, Y izquierda, Z arriba, en unidades del juego, con origen en el centro del hitbox.
import bpy, bmesh, math, os, sys
from mathutils import Vector

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'assets', 'models')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = argv[0] if argv else ''
CLEAR = 6.0  # despeje del piso

# Medidas del juego (src/sim/constants.ts → CAR_BODIES)
BODIES = [
    dict(id='toro', size=(120.507, 86.6994, 38.6591), off=(13.8757, 20.755), fw=(12.5, 51.25, 25.9), bw=(15, -33.75, 29.5)),
    dict(id='flecha', size=(130.427, 85.7799, 33.8), off=(9, 15.75), fw=(12, 50.3, 31.1), bw=(13.5, -34.75, 33)),
    dict(id='lamina', size=(131.32, 87.1704, 31.8944), off=(9.00857, 12.0942), fw=(12.5, 49.97, 27.8), bw=(17, -35.43, 20.28)),
    dict(id='aguja', size=(133.992, 83.021, 32.8), off=(12.5, 11.75), fw=(13.5, 51.5, 26.67), bw=(15, -35.75, 35)),
    dict(id='mixto', size=(129.519, 84.6879, 36.6591), off=(13.8757, 20.755), fw=(12.5, 51.25, 25.9), bw=(15, -34, 29.5)),
    dict(id='furgon', size=(123.22, 79.2103, 44.1591), off=(11.3757, 21.505), fw=(15, 51.25, 25.9), bw=(15, -33.75, 29.5)),
]

# Diseño de cada carrocería. x en fracción del largo (−0.5 cola, +0.5 trompa); alturas en fracción del alto total.
DESIGNS = {
    # compacto con portón
    'toro': dict(cowl=0.20, roof0=0.06, roof1=-0.30, cabend=-0.43, hood=0.60, nose=0.48, deck=0.68, belt=(0.56, 0.64), tuck=0.72, noseW=0.86, tailW=0.92, wing='techo'),
    # gran turismo de capó largo y caída trasera
    'flecha': dict(cowl=0.10, roof0=-0.04, roof1=-0.24, cabend=-0.42, hood=0.60, nose=0.46, deck=0.70, belt=(0.58, 0.68), tuck=0.68, noseW=0.80, tailW=0.88, wing='labio'),
    # cuña baja con cabina adelantada
    'lamina': dict(cowl=0.27, roof0=0.09, roof1=-0.13, cabend=-0.36, hood=0.52, nose=0.36, deck=0.76, belt=(0.50, 0.72), tuck=0.64, noseW=0.84, tailW=0.96, wing='aleron'),
    # trompa larga y cabina chica
    'aguja': dict(cowl=0.02, roof0=-0.10, roof1=-0.26, cabend=-0.38, hood=0.64, nose=0.50, deck=0.66, belt=(0.60, 0.66), tuck=0.62, noseW=0.72, tailW=0.80, wing='labio'),
    # cupé de tres volúmenes
    'mixto': dict(cowl=0.14, roof0=0.00, roof1=-0.20, cabend=-0.33, hood=0.66, nose=0.58, deck=0.66, belt=(0.60, 0.66), tuck=0.72, noseW=0.92, tailW=0.94, wing='aleron'),
    # furgón alto
    'furgon': dict(cowl=0.30, roof0=0.20, roof1=-0.40, cabend=-0.452, hood=0.56, nose=0.50, deck=0.60, belt=(0.54, 0.58), tuck=0.86, noseW=0.94, tailW=0.97, wing=''),
}

MATS = {}
def material(name, color):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (*color, 1)
    MATS[name] = m
    return m

MAT_ORDER = ['paint', 'glass', 'trim', 'light_front', 'light_rear']
MAT_COLORS = dict(paint=(0.05, 0.25, 0.9), glass=(0.02, 0.03, 0.05), trim=(0.015, 0.016, 0.02), light_front=(0.95, 0.95, 0.9), light_rear=(0.8, 0.02, 0.05))

def lerp(a, b, t):
    return a + (b - a) * t

def build_body(b):
    d = DESIGNS[b['id']]
    L, W, H = b['size']
    ox, oz = b['off']
    g0 = -(17 + oz)                # piso en coordenadas del chasis
    top = 17 + oz + H / 2          # alto total sobre el piso
    zbot = g0 + CLEAR
    Wh = W / 2 * 0.985
    cab = (d['roof1'], (d['roof0'] + d['roof1']) / 2, d['roof0'])
    # Estaciones: cola, esquina de cola, base de luneta, techo (3), base de parabrisas, capó, esquina de trompa, punta
    # El ancho se mantiene completo hasta pasar las ruedas (quedan dentro de los pasarruedas); sólo se afinan las puntas
    xfw = (b['fw'][1] - ox) / L
    xh = min(0.40, max(d['cowl'] + 0.05, xfw))
    th = (xh - d['cowl']) / (0.455 - d['cowl'])
    xs = [-0.5, -0.468, d['cabend'], cab[0], cab[1], cab[2], d['cowl'], xh, 0.455, 0.5]
    tops = [d['deck'] * 0.86, d['deck'], d['deck'], 0.975, 1.0, 0.965, d['hood'], lerp(d['hood'], d['nose'], th) + 0.012, d['nose'], d['nose'] * 0.74]
    wid = [d['tailW'] * 0.9, 0.975, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 0.97, d['noseW'] * 0.9]
    rings = []
    for i, xf in enumerate(xs):
        x = xf * L
        zt = g0 + tops[i] * top
        w = Wh * wid[i]
        in_cab = 3 <= i <= 5
        base = i in (2, 6)
        belt = g0 + lerp(d['belt'][1], d['belt'][0], (xf + 0.5)) * top
        belt = min(belt, zt - (2.0 if not in_cab else 6.0))
        if i in (0, 9):
            belt = min(belt, zt - 3.0)
        # Guardabarros: sobre cada rueda el hombro sube lo necesario para cubrirla, aunque el capó o la cola sean más bajos
        for (r, wx, _wy) in (b['fw'], b['bw']):
            dx = abs(x - (wx - ox)) / (r + 16.0)
            if dx < 1.0:
                belt = max(belt, g0 + 2 * r + 9.5 - dx * dx * 8.0)
        y1 = w * (d['tuck'] if in_cab else (d['tuck'] + 0.1 if base else 0.76))
        z1 = zt - (1.2 if in_cab else 1.6)
        if not in_cab:
            z1 = max(z1, belt + 0.6)
        sill = zbot + (3.0 if 0 < i < 9 else 8.0)
        zb = zbot + (0.0 if 0 < i < 9 else 6.0)
        zmid = lerp(sill, belt, 0.52)
        half = [(0.0, zb), (w * 0.93, sill), (w, zmid), (w * 0.95, belt), (y1, z1), (0.0, zt)]
        ring = [Vector((x, half[0][0], half[0][1]))]
        ring += [Vector((x, y, z)) for (y, z) in half[1:5]]
        ring.append(Vector((x, 0.0, half[5][1])))
        ring += [Vector((x, -y, z)) for (y, z) in reversed(half[1:5])]
        rings.append(ring)

    bm = bmesh.new()
    crease = bm.edges.layers.float.new('crease_edge')
    V = [[bm.verts.new(p) for p in ring] for ring in rings]
    N = 10
    faces = {}
    for i in range(len(V) - 1):
        for j in range(N):
            k = (j + 1) % N
            faces[(i, j)] = bm.faces.new((V[i][j], V[i][k], V[i + 1][k], V[i + 1][j]))
    cap_rear = bm.faces.new(list(reversed(V[0])))
    cap_front = bm.faces.new(V[-1])
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()

    def ring_edge(i, j):
        return bm.edges.get((V[i][j], V[i + 1][j]))
    # Líneas de carácter: zócalo, hombro y borde superior
    for i in range(len(V) - 1):
        for j, c in ((1, 0.85), (9, 0.85), (3, 0.72), (7, 0.72), (4, 0.55), (6, 0.55)):
            e = ring_edge(i, j)
            if e:
                e[crease] = c

    def zone(keys, mat, thick, cr=0.8, depth=0.0):
        fs = [faces[k] if isinstance(k, tuple) else k for k in keys]
        # El marco nunca puede ser más grueso que una fracción de la zona (si no, la malla se da vuelta)
        pts = [v.co for f in fs for v in f.verts]
        ext = sorted(max(p[a] for p in pts) - min(p[a] for p in pts) for a in range(3))
        thick = min(thick, ext[1] * 0.16)
        depth = max(depth, -thick * 0.4)
        bmesh.ops.inset_region(bm, faces=fs, thickness=thick, depth=depth, use_boundary=True, use_even_offset=True)
        for f in fs:
            f.material_index = MAT_ORDER.index(mat)
        inner = set(fs)
        for f in fs:
            for e in f.edges:
                if sum(1 for lf in e.link_faces if lf in inner) == 1:
                    e[crease] = cr
    # Piso oscuro
    for i in range(len(V) - 1):
        for j in (0, 9):
            faces[(i, j)].material_index = MAT_ORDER.index('trim')
    zone([(5, 4), (5, 5)], 'glass', 2.2)                      # parabrisas
    zone([(2, 4), (2, 5)], 'glass', 2.2)                      # luneta
    zone([(2, 3), (3, 3), (4, 3), (5, 3)], 'glass', 2.4)      # ventanillas izquierdas
    zone([(2, 6), (3, 6), (4, 6), (5, 6)], 'glass', 2.4)      # ventanillas derechas
    zone([(8, 2), (8, 3)], 'light_front', 1.1)
    zone([(8, 6), (8, 7)], 'light_front', 1.1)
    zone([(0, 2), (0, 3)], 'light_rear', 1.1)
    zone([(0, 6), (0, 7)], 'light_rear', 1.1)
    zone([cap_front], 'trim', 3.6, 0.9, -1.2)                 # rejilla
    zone([cap_rear], 'trim', 4.0, 0.9, -1.0)                  # panel trasero
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)

    me = bpy.data.meshes.new(b['id'])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(b['id'], me)
    bpy.context.collection.objects.link(ob)
    for name in MAT_ORDER:
        me.materials.append(material(name, MAT_COLORS[name]))
    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    sub = ob.modifiers.new('sub', 'SUBSURF')
    sub.levels = 2
    bpy.ops.object.modifier_apply(modifier=sub.name)

    # Pasarruedas: se restan cilindros en las cuatro ruedas
    wells = []
    for (r, wx, wy) in (b['fw'], b['bw']):
        wy = max(wy, W * 0.5 * 0.9 - 7.5)
        y_in = wy - 9.5
        rc = r + 3.4
        cx, cz = wx - ox, g0 + r
        for s in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=rc, depth=70 - y_in, location=(cx, s * (y_in + 70) / 2, cz), rotation=(math.pi / 2, 0, 0))
            cyl = bpy.context.active_object
            wells.append(dict(ob=cyl, cx=cx, cz=cz, rc=rc, y_in=y_in))
    for w in wells:
        bpy.context.view_layer.objects.active = ob
        backup = ob.data.copy()
        for solver in ('EXACT', 'FLOAT'):
            mod = ob.modifiers.new('well', 'BOOLEAN')
            mod.operation = 'DIFFERENCE'
            mod.object = w['ob']
            mod.solver = solver
            bpy.ops.object.modifier_apply(modifier=mod.name)
            # Si la resta falla, el cilindro queda pegado al auto: se detecta por el ancho y se reintenta
            if max(abs(v.co.y) for v in ob.data.vertices) < W / 2 + 1.5:
                break
            print('AVISO: recorte fallido con', solver, 'en', b['id'])
            ob.data = backup.copy()
        me = ob.data
        bpy.data.objects.remove(w['ob'], do_unlink=True)
    # El interior del pasarruedas, en negro
    trim = MAT_ORDER.index('trim')
    for p in me.polygons:
        c = p.center
        for w in wells:
            dist = math.hypot(c.x - w['cx'], c.z - w['cz'])
            ny = abs(p.normal.y)
            if abs(c.y) > w['y_in'] - 0.6 and ((abs(dist - w['rc']) < 0.7 and ny < 0.5) or (abs(abs(c.y) - w['y_in']) < 0.6 and dist < w['rc'] and ny > 0.9)):
                p.material_index = trim
                break

    # Alerón o labio trasero (pieza aparte, del color de los detalles)
    wing = d.get('wing')
    if wing:
        zt = g0 + d['deck'] * top
        bmw = bmesh.new()
        if wing == 'aleron':
            bmesh.ops.create_cube(bmw, size=1.0)
            bmesh.ops.scale(bmw, vec=(11, W * 0.86, 1.6), verts=bmw.verts)
            bmesh.ops.translate(bmw, vec=(-0.455 * L, 0, zt + 9), verts=bmw.verts)
            for s in (1, -1):
                r = bmesh.ops.create_cube(bmw, size=1.0)
                bmesh.ops.scale(bmw, vec=(7, 1.8, 9), verts=r['verts'])
                bmesh.ops.translate(bmw, vec=(-0.445 * L, s * W * 0.3, zt + 4), verts=r['verts'])
        elif wing == 'labio':
            bmesh.ops.create_cube(bmw, size=1.0)
            bmesh.ops.scale(bmw, vec=(7, W * 0.78, 1.8), verts=bmw.verts)
            bmesh.ops.translate(bmw, vec=(-0.478 * L, 0, zt + 0.6), verts=bmw.verts)
        else:  # visera sobre el portón
            bmesh.ops.create_cube(bmw, size=1.0)
            bmesh.ops.scale(bmw, vec=(9, W * 0.62, 1.6), verts=bmw.verts)
            bmesh.ops.translate(bmw, vec=((d['roof1'] - 0.005) * L, 0, g0 + 0.975 * top - 3.2), verts=bmw.verts)
        mw = bpy.data.meshes.new(b['id'] + '_wing')
        bmw.to_mesh(mw)
        bmw.free()
        ow = bpy.data.objects.new(b['id'] + '_wing', mw)
        bpy.context.collection.objects.link(ow)
        mw.materials.append(material('trim', MAT_COLORS['trim']))
        for o in bpy.context.selected_objects:
            o.select_set(False)
        ow.select_set(True)
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.join()

    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
    return ob, wells

def export(ob):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    path = os.path.join(OUT, ob.name + '.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=False, export_apply=True,
                              export_texcoords=False, export_normals=True, export_materials='EXPORT', export_cameras=False, export_lights=False)
    print('EXPORTADO', ob.name, len(ob.data.polygons), 'caras', os.path.getsize(path) // 1024, 'KB')

def preview(objs):
    """Lámina de control: los seis autos con ruedas de muestra, vistos de frente y de atrás."""
    sc = bpy.context.scene
    tire = material('tire', (0.03, 0.03, 0.035))
    for n, (ob, b) in enumerate(objs):
        col, row = n % 3, n // 3
        ox, oz = b['off']
        pos = Vector((row * 210.0, col * -170.0, 17 + oz))
        ob.location = pos
        for (r, wx, wy) in (b['fw'], b['bw']):
            wy = max(wy, b['size'][1] * 0.5 * 0.9 - 7.5)
            for s in (1, -1):
                bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=r, depth=15, location=(pos.x + wx - ox, pos.y + s * wy, r), rotation=(math.pi / 2, 0, 0))
                bpy.context.active_object.data.materials.append(tire)
    bpy.ops.mesh.primitive_plane_add(size=4000, location=(0, 0, 0))
    bpy.context.active_object.data.materials.append(material('floor', (0.55, 0.57, 0.6)))
    sc.render.engine = 'BLENDER_WORKBENCH'
    sh = sc.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'MATERIAL'
    sh.show_cavity = True
    sh.show_shadows = True
    sc.render.resolution_x, sc.render.resolution_y = 1500, 900
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 60
    cam.data.clip_end = 5000
    target = Vector((105, -170, 22))
    for name, off in (('frente', Vector((560, 330, 250))), ('atras', Vector((-560, -330, 250))), ('lado', Vector((0, 760, 90)))):
        cam.location = target + off
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PREVIEW, 'autos-' + name + '.png')
        bpy.ops.render.render(write_still=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
os.makedirs(OUT, exist_ok=True)
built = []
for b in BODIES:
    ob, _ = build_body(b)
    export(ob)
    built.append((ob, b))
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    preview(built)
