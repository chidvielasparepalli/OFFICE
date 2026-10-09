"""Extract the warehouse ground slab for an open-office candidate; never write originals."""
import hashlib
import json
from pathlib import Path
import bmesh
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'assets/working/warehouse'
REPORT = ROOT / 'assets/warehouse'
layout = json.loads((REPORT / 'open-layout.json').read_text())
inventory = json.loads((REPORT / 'source-inventory.json').read_text())
bpy.ops.wm.open_mainfile(filepath=str(WORK / 'warehouse-inspected.blend'))
scene = bpy.context.scene
source = next(o for o in scene.objects if o.get('source_file') == 'model_3.obj')
bm = bmesh.new()
bm.from_mesh(source.data)
bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0001)

# Select the measured connected foundation, not slabs on upper levels.
remaining = set(bm.verts)
candidates = []
while remaining:
    pending = [remaining.pop()]
    vertices = set(pending)
    while pending:
        vertex = pending.pop()
        for edge in vertex.link_edges:
            other = edge.other_vert(vertex)
            if other in remaining:
                remaining.remove(other)
                vertices.add(other)
                pending.append(other)
    lo = Vector([min(v.co[i] for v in vertices) for i in range(3)])
    hi = Vector([max(v.co[i] for v in vertices) for i in range(3)])
    if len(vertices) == 8 and lo.z == 0 and hi.z < 13 and hi.x - lo.x > 640 and hi.y - lo.y > 960:
        candidates.append((vertices, lo, hi))
assert len(candidates) == 1, 'Ground slab is ambiguous; inspect before converting'
keep, low, high = candidates[0]
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v not in keep], context='VERTS')
assert len(bm.faces) == 12
source_size = high - low
center = (low + high) / 2
for vertex in bm.verts:
    # Resize only the plain slab for the new plan; this is not unit calibration.
    vertex.co = (-(vertex.co.x - center.x) * layout['width'] / source_size.x,
                 -(vertex.co.y - center.y) * layout['depth'] / source_size.y,
                 (vertex.co.z - high.z) * 0.0254)
bm.to_mesh(source.data)
bm.free()
source.data.update()
source.name = 'OPEN_OFFICE_FLOOR'
source.data.name = 'Warehouse_ground_slab'
for obj in list(scene.objects):
    if obj != source:
        bpy.data.objects.remove(obj, do_unlink=True)
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
material = bpy.data.materials.new('Neutral_open_floor')
material.use_nodes = True
shader = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
shader.inputs['Base Color'].default_value = (0.72, 0.76, 0.75, 1)
shader.inputs['Roughness'].default_value = 0.95
source.data.materials.clear()
source.data.materials.append(material)
source.color = (0.72, 0.76, 0.75, 1)
source['source_sha256'] = next(i['sha256'] for i in inventory['files'] if i['file'] == 'model_3.obj')
root = bpy.data.objects.new('OPEN_OFFICE_ROOT', None)
scene.collection.objects.link(root)
source.parent = root
root['asset_id'] = 'world.office-open.v1'
root['status'] = 'candidate-local-preview'
root['layout'] = 'Single level; no roof, ceiling or enclosing walls'
markers = bpy.data.objects.new('ANCHORS', None)
scene.collection.objects.link(markers)
markers.parent = root
anchors = list(layout['anchors'])
for department in layout['departments']:
    anchors.append(dict(name=department['anchor'], kind='department', position=department['position']))
    anchors.append(dict(name='WORKSTATION_' + department['id'].upper(), kind='workstation-area', position=department['position']))
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
for anchor in anchors:
    x, y, z = anchor['position']
    hit, point, normal, *_ = scene.ray_cast(depsgraph, Vector((x, -z, 10)), Vector((0, 0, -1)))
    assert hit and abs(point.z) < 1e-5 and abs(normal.z) > 0.99, anchor['name']
    obj = bpy.data.objects.new(anchor['name'], None)
    scene.collection.objects.link(obj)
    obj.parent = markers
    obj.location = (x, -z, y)
    obj['kind'] = anchor['kind']
    obj['status'] = 'proposed-layout-floor-checked'
    anchor['status'] = 'proposed-layout-floor-checked'
assert max(v.co.z for v in source.data.vertices) <= 1e-5
assert all(o == source for o in scene.objects if o.type == 'MESH')
bpy.data.orphans_purge(do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'office-open.blend'), compress=True)
output = WORK / 'office-open.glb'
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', export_yup=True,
                          export_extras=True, export_animations=False, export_cameras=False,
                          export_lights=False, export_texcoords=False)
depth = float(source_size.z * 0.0254)
metadata = dict(asset_id='world.office-open.v1', status='candidate-local-preview',
                file=output.relative_to(ROOT).as_posix(), bytes=output.stat().st_size,
                sha256=hashlib.sha256(output.read_bytes()).hexdigest(),
                coordinate_system='Y-up, meters, +Z entrance, centered ground surface at [0,0,0]',
                source_to_meters=0.0254,
                source_slab_bounds=[list(low), list(high)],
                source_slab_dimensions_m=[float(v * 0.0254) for v in source_size],
                plan_resize=[layout['width'] / (source_size.x * 0.0254), layout['depth'] / (source_size.y * 0.0254)],
                bounds=[[-layout['width']/2, -depth, -layout['depth']/2], [layout['width']/2, 0, layout['depth']/2]],
                dimensions=[layout['width'], depth, layout['depth']], triangles=12,
                components=[dict(name=source.name, source='model_3.obj', triangles=12, vertices=8)],
                materials=['Neutral_open_floor'], textures=0, anchors=anchors,
                excluded='All other geometry: roofs, ceilings, upper floors, enclosing walls, stairs, overhead services, partial furniture batches')
(REPORT / 'conversion.json').write_text(json.dumps(metadata, indent=2) + '\n', encoding='utf-8')
print('EXPORTED', metadata['bytes'], 'bytes, 12 triangles,', len(anchors), 'floor-checked anchors', flush=True)
