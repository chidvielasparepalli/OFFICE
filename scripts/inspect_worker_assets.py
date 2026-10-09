"""Read source packages into isolated Blender inspection copies; never modify sources."""
import hashlib
import json
from pathlib import Path
import zipfile
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'assets/workers'
WORK = ROOT / 'assets/working/workers'
WORK.mkdir(parents=True, exist_ok=True)


def render(scene, objects, name, direction):
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    low = Vector([min(p[i] for p in points) for i in range(3)])
    high = Vector([max(p[i] for p in points) for i in range(3)])
    center = (low + high) / 2
    span = max(high - low)
    bpy.ops.object.camera_add(location=center + Vector(direction).normalized() * span * 2.4)
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = span * 1.5
    scene.camera = camera
    for direction in [(1, -2, 3), (-2, -1, 1), (0, 2, 2)]:
        bpy.ops.object.light_add(type='AREA', location=center + Vector(direction) * span)
        lamp = bpy.context.object
        lamp.rotation_euler = (center - lamp.location).to_track_quat('-Z', 'Y').to_euler()
        lamp.data.energy = span * span * 80
        lamp.data.shape = 'DISK'
        lamp.data.size = span * 2
    scene.world = bpy.data.worlds.new('Inspection world')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.65, 0.7, 0.75, 1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.5
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12
    scene.render.resolution_x = scene.render.resolution_y = 760
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(WORK / f'{name}.png')
    bpy.ops.render.render(write_still=True)


for kind, relative in [('worker', 'model_0.obj'), ('workstation', 'source/Office Desk/Office Desk.obj')]:
    inventory = json.loads((REPORT / f'{kind}-source.json').read_text())
    source = Path(inventory['source'])
    archives = []
    for record in inventory['files']:
        if record['file'].endswith('.zip'):
            with zipfile.ZipFile(source / record['file']) as archive:
                archives.append(dict(file=record['file'], entries=[dict(name=i.filename, bytes=i.file_size,
                    sha256=hashlib.sha256(archive.read(i)).hexdigest()) for i in archive.infolist() if not i.is_dir()]))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.obj_import(filepath=str(source / relative), forward_axis='NEGATIVE_Z', up_axis='Y')
    scene = bpy.context.scene
    objects = [o for o in scene.objects if o.type == 'MESH']
    report = dict(blender=bpy.app.version_string, import_axes='source Y-up, -Z forward; visual inspection required',
                  units='not declared in OBJ', objects=[], archives=archives,
                  armatures=[o.name for o in scene.objects if o.type == 'ARMATURE'],
                  actions=[a.name for a in bpy.data.actions], images=[])
    for obj in objects:
        obj.data.calc_loop_triangles()
        points = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        report['objects'].append(dict(name=obj.name, parent=obj.parent.name if obj.parent else None,
            vertices=len(obj.data.vertices), polygons=len(obj.data.polygons), triangles=len(obj.data.loop_triangles),
            bounds=[[min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)]],
            materials=[m.name if m else None for m in obj.data.materials], uv_layers=len(obj.data.uv_layers),
            modifiers=[m.type for m in obj.modifiers], vertex_groups=len(obj.vertex_groups)))
    if kind == 'worker':
        im = bpy.data.images.load(str(source / 'x.png'))
        report['images'].append(dict(file='x.png', size=list(im.size), linked_by_source_mtl=False))
    report['triangles'] = sum(o['triangles'] for o in report['objects'])
    report['vertices'] = sum(o['vertices'] for o in report['objects'])
    (REPORT / f'{kind}-inspection.json').write_text(json.dumps(report, indent=2) + '\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / f'{kind}-inspected.blend'), compress=True)
    # Inspection colors identify source batches; they are not recovered source finishes.
    colors = [(0.16, 0.2, 0.25, 1), (0.6, 0.4, 0.2, 1), (0.2, 0.5, 0.55, 1), (0.65, 0.65, 0.65, 1)]
    for obj in objects:
        mat = bpy.data.materials.new('Inspection_' + obj.name)
        mat.diffuse_color = colors[sum(map(ord, obj.name.rsplit('_', 1)[0])) % len(colors)]
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    render(scene, objects, f'{kind}-inspection', (1.2, -2.5, 1.4))
    if kind == 'worker':
        mat = objects[0].data.materials[0]
        mat.use_nodes = True
        texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
        texture.image = im
        mat.node_tree.links.new(texture.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
        render(scene, objects, 'worker-texture-front', (0, -3, 0.15))
    print('INSPECTED', kind, len(objects), 'meshes', report['vertices'], 'vertices', report['triangles'], 'triangles', flush=True)
