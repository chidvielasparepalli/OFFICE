"""Inspect unchanged source copies in an isolated Blender process."""
import hashlib
import json
import shutil
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'assets/desk-manager'
WORK = ROOT / 'assets/working/desk-manager'
WORK.mkdir(parents=True, exist_ok=True)


def render(objects, filename, direction=(1.2, -2.5, 1.4), size=760):
    scene = bpy.context.scene
    points = [o.matrix_world @ Vector(c) for o in objects for c in o.bound_box]
    low = Vector([min(p[i] for p in points) for i in range(3)])
    high = Vector([max(p[i] for p in points) for i in range(3)])
    center, span = (low + high) / 2, max(high - low)
    bpy.ops.object.camera_add(location=center + Vector(direction).normalized() * span * 2.4)
    camera = bpy.context.object
    camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = span * 1.25
    scene.camera = camera
    lamps = []
    for direction in [(1, -2, 3), (-2, -1, 1), (0, 2, 2)]:
        bpy.ops.object.light_add(type='AREA', location=center + Vector(direction) * span)
        lamp = bpy.context.object
        lamps.append(lamp)
        lamp.rotation_euler = (center - lamp.location).to_track_quat('-Z', 'Y').to_euler()
        lamp.data.energy = span * span * 80
        lamp.data.size = span * 2
    scene.world = bpy.data.worlds.new('Inspection world')
    scene.world.color = (.5, .5, .5)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 8
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(filename)
    bpy.ops.render.render(write_still=True)
    for obj in [camera, *lamps]:
        bpy.data.objects.remove(obj, do_unlink=True)


def inspect(kind):
    inventory = json.loads((REPORT / f'{kind}-source.json').read_text())
    source = Path(inventory['source'])
    copied = WORK / f'{kind}-source'
    copied.mkdir(exist_ok=True)
    for record in inventory['files']:
        target = copied / record['file']
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / record['file'], target)
        assert hashlib.sha256(target.read_bytes()).hexdigest() == record['sha256']
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objects, duplicates, hashes = [], [], {}
    for path in sorted(copied.glob('*.obj'), key=lambda p: int(p.stem.split('_')[-1])):
        bpy.ops.wm.obj_import(filepath=str(path), forward_axis='NEGATIVE_Z', up_axis='Y')
        for obj in bpy.context.selected_objects:
            mesh = obj.data
            mesh.calc_loop_triangles()
            positions = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
            mesh.vertices.foreach_get('co', positions)
            corners = np.empty(len(mesh.loops), dtype=np.int32)
            mesh.loops.foreach_get('vertex_index', corners)
            uvs = np.empty(len(mesh.loops) * 2, dtype=np.float32)
            if mesh.uv_layers:
                mesh.uv_layers.active.data.foreach_get('uv', uvs)
            else:
                uvs.fill(0)
            digest = hashlib.sha256(positions.tobytes() + corners.tobytes() + uvs.tobytes()).hexdigest()
            points = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
            item = dict(file=path.name, object=obj.name, parent=None,
                vertices=len(mesh.vertices), polygons=len(mesh.polygons), triangles=len(mesh.loop_triangles),
                blender_bounds=[[min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)]],
                materials=[m.name if m else None for m in mesh.materials], uv_layers=len(mesh.uv_layers),
                modifiers=[m.type for m in obj.modifiers], vertex_groups=len(obj.vertex_groups), geometry_uv_sha256=digest)
            if digest in hashes:
                duplicates.append(dict(file=path.name, retained=hashes[digest]))
            else:
                hashes[digest] = path.name
            objects.append(item)
    images = []
    for path in copied.glob('*.png'):
        im = bpy.data.images.load(str(path))
        images.append(dict(file=path.name, size=list(im.size)))
    report = dict(blender=bpy.app.version_string, import_axes='Y-up hypothesis; visual confirmation required',
        source_units='unspecified', objects=objects, duplicates=duplicates, images=images,
        armatures=[o.name for o in bpy.context.scene.objects if o.type == 'ARMATURE'],
        actions=[a.name for a in bpy.data.actions])
    (REPORT / f'{kind}-inspection.json').write_text(json.dumps(report, indent=2) + '\n')
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / f'{kind}-inspected.blend'), compress=True)
    for item in duplicates:
        bpy.data.objects.remove(bpy.data.objects[Path(item['file']).stem], do_unlink=True)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for i, obj in enumerate(meshes):
        mat = bpy.data.materials.new('inspection_' + obj.name)
        mat.diffuse_color = [(.2, .3, .4, 1), (.6, .4, .2, 1), (.3, .55, .5, 1), (.65, .65, .65, 1)][i % 4]
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    render(meshes, WORK / f'{kind}-whole.png', (1.2, -2.5, 1.4))
    for obj in meshes:
        for other in meshes:
            other.hide_render = other != obj
        render([obj], WORK / f'{kind}-{obj.name}.png', size=240)
    print('INSPECTED', kind, len(objects), 'objects', len(duplicates), 'duplicates', flush=True)


if __name__ == '__main__':
    for kind in ['workstation', 'manager']:
        inspect(kind)
