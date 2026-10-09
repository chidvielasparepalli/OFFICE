"""Convert inspected copies only. Keep the exact worker silhouette and authored UVs."""
import hashlib
import json
import math
from pathlib import Path
import bpy
import bmesh
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'assets/working/workers'
REPORT = ROOT / 'assets/workers'


def bounds(objects):
    points = [o.matrix_world @ v.co for o in objects for v in o.data.vertices]
    return [Vector([min(p[i] for p in points) for i in range(3)]),
            Vector([max(p[i] for p in points) for i in range(3)])]


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def material(name, color):
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    shader = result.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = 0.75
    return result


def finish(name, objects, extra):
    for obj in list(bpy.context.scene.objects):
        if obj not in objects:
            bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    root = bpy.data.objects.new(name.upper() + '_ROOT', None)
    scene.collection.objects.link(root)
    for obj in objects:
        obj.parent = root
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / f'{name}.blend'), compress=True)
    path = WORK / f'{name}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', export_yup=True,
        export_animations=False, export_cameras=False, export_lights=False, export_extras=False)
    low, high = bounds(objects)
    runtime_low = [low.x, low.z, -high.y]
    runtime_high = [high.x, high.z, -low.y]
    assert abs(runtime_low[1]) < 1e-5, 'Not on ground'
    entry = dict(file=path.relative_to(ROOT).as_posix(), bytes=path.stat().st_size,
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(), bounds=[runtime_low, runtime_high],
        dimensions=[b-a for a,b in zip(runtime_low, runtime_high)],
        meshes=[dict(name=o.name, vertices=len(o.data.vertices), triangles=triangles(o),
                     materials=[m.name for m in o.data.materials]) for o in objects],
        triangles=sum(triangles(o) for o in objects), vertices=sum(len(o.data.vertices) for o in objects),
        coordinate_system='Y-up, meters, +Z facing/desk direction, ground pivot', **extra)
    print('EXPORTED', name, entry['bytes'], 'bytes', entry['triangles'], 'triangles', flush=True)
    return entry


bpy.ops.wm.open_mainfile(filepath=str(WORK / 'worker-inspected.blend'))
worker = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
worker.data.transform(worker.matrix_world)
worker.matrix_world.identity()
low, high = bounds([worker])
scale = 1.75 / (high.z - low.z)
feet = [v.co for v in worker.data.vertices if v.co.z < low.z + 0.02 * (high.z-low.z)]
pivot = Vector(((low.x + high.x)/2, (min(v.y for v in feet)+max(v.y for v in feet))/2, low.z))
for v in worker.data.vertices:
    v.co = (v.co - pivot) * scale
original_triangles = triangles(worker)
bm = bmesh.new()
bm.from_mesh(worker.data)
# Coincident worker seams are retained: welding changes imported face topology.
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(worker.data)
bm.free()
assert triangles(worker) == original_triangles, 'Worker faces changed'
worker.name = 'STANDARD_WORKER'
mat = material('Stickman_supplied_atlas', (1, 1, 1))
image = bpy.data.images.load(str(Path(json.loads((REPORT / 'worker-source.json').read_text())['source']) / 'x.png'))
image.pack()
texture = mat.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = image
mat.node_tree.links.new(texture.outputs['Color'], mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'])
worker.data.materials.clear()
worker.data.materials.append(mat)
worker_report = finish('standard-worker', [worker], dict(scale_factor=scale,
    source_pivot_blender=list(pivot), texture='x.png', texture_dimensions=list(image.size),
    material_assignment='Supplied image assigned to existing UVs; missing MTL means original shader settings are unknown',
    rigged=False, animations=0, pose='Unchanged source T-pose', normalization='Uniform scale to chosen canonical height 1.75 m; original units unspecified'))

bpy.ops.wm.open_mainfile(filepath=str(WORK / 'workstation-inspected.blend'))
groups = {
    'DESK': ('archmodels53_20', 6500, (0.45, 0.33, 0.22)),
    'CHAIR': ('objArmchair_07_Mesh', 7000, (0.19, 0.24, 0.29)),
    'MONITOR': ('Arch35_020', 3300, (0.13, 0.18, 0.22)),
    'KEYBOARD': ('Arch35_051', 2800, (0.2, 0.25, 0.3)),
    'MOUSE': ('Arch35_025', 700, (0.2, 0.25, 0.3)),
}
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
kept, cleanup = [], []
desk_low, desk_high = bounds([o for o in objects if o.name.startswith('archmodels53_20')])
desk_scale = 0.75 / (desk_high.z - desk_low.z)
plan_center_x = (desk_low.x + desk_high.x) / 2
plan_center_y = (desk_low.y + desk_high.y) / 2
for label, (prefix, budget, color) in groups.items():
    parts = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.name.startswith(prefix)]
    for obj in parts:
        obj.data.transform(obj.matrix_world)
        obj.matrix_world.identity()
        before = triangles(obj)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-5)
        bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-6)
        area_before = sum(f.calc_area() for f in bm.faces)
        original = bm.copy()
        bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(0.5), verts=list(bm.verts), edges=list(bm.edges), delimit={'NORMAL'})
        if abs(sum(f.calc_area() for f in bm.faces)-area_before) > max(1e-6, area_before * 0.001):
            bm.free()
            bm = original
        else:
            original.free()
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        bm.to_mesh(obj.data)
        bm.free()
        cleanup.append(dict(source=obj.name, before=before, after_planar=triangles(obj)))
    count = sum(triangles(o) for o in parts)
    small_parts = sum(triangles(o) for o in parts if triangles(o) <= 1000) if label == 'DESK' else 0
    ratio = max(0.001, (budget - small_parts) / max(1, count - small_parts))
    for obj in parts:
        original_low, original_high = bounds([obj])
        if count > budget and triangles(obj) > (1000 if label == 'DESK' else 100):
            bpy.context.view_layer.objects.active = obj
            mod = obj.modifiers.new('Bounded furniture simplification', 'DECIMATE')
            mod.ratio = ratio
            bpy.ops.object.modifier_apply(modifier=mod.name)
        for v in obj.data.vertices:
            # Collapse can overshoot rounded feet; keep the measured source envelope.
            for axis in range(3):
                v.co[axis] = max(original_low[axis], min(original_high[axis], v.co[axis]))
            v.co.x = (v.co.x - plan_center_x) * desk_scale
            v.co.y = (v.co.y - plan_center_y) * desk_scale
            v.co.z = (v.co.z - (0 if label == 'CHAIR' else desk_low.z)) * desk_scale
        obj.data.update()
    # Retain semantic components, each merged to one draw batch and one neutral material.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = label
    merged.data.validate()
    if label in ('DESK', 'CHAIR'):
        bottom = min(v.co.z for v in merged.data.vertices)
        for v in merged.data.vertices:
            v.co.z -= bottom
    merged.data.update()
    merged.data.materials.clear()
    merged.data.materials.append(material('Neutral_' + label.lower(), color))
    for face in merged.data.polygons:
        face.material_index = 0
    kept.append(merged)
workstation_report = finish('office-workstation', kept, dict(scale_factor=desk_scale,
    desk_top_height=0.75, source_plan_center_blender=[plan_center_x, plan_center_y],
    source_desk_ground=desk_low.z, texture=None, rigged=False, animations=0,
    normalization='Units unspecified; uniform scale calibrated to a chosen 0.75 m desk top; desk assembly lowered to floor independently of chair',
    omitted_prefixes=['arch20_039', 'arch20_068', 'arch20_069', 'Arch35_078'], cleanup=cleanup))
assert workstation_report['triangles'] < 22500
assert abs(worker_report['dimensions'][1] - 1.75) < 1e-5
(REPORT / 'conversion.json').write_text(json.dumps(dict(standardWorker=worker_report, workstation=workstation_report), indent=2) + '\n')
