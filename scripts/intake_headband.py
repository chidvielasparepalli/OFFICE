"""Inspect/copy the supplied red headband and export one shared, fitted accessory.

Run in isolated Blender: blender --background --factory-startup --python-exit-code 1
  --python scripts/intake_headband.py
Sources and canonical character geometry are never modified.
"""
import collections
import hashlib
import json
import shutil
import struct
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r'A:\New folder\Prop118 Red Headband')
WORK = ROOT / 'assets/working/headband'
REPORT = ROOT / 'assets/headband'
for folder in [WORK, REPORT, WORK / 'source', WORK / 'textures']:
    folder.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'scripts'))
from inspect_desk_manager import render

FITS = {
    'worker': dict(position=[-.000426, .205, .023386], scale=[1.935, .62, 1.595],
                   rest_head_origin=[0, 1.40, -.025], blend='standard-worker-animated.blend'),
    'manager': dict(position=[.0008, .159, .005], scale=[.98, .68, .95],
                    rest_head_origin=[0, 1.56, -.025], blend='primary-manager-animated.blend'),
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bounds(points):
    points = np.asarray(points)
    return [points.min(axis=0).tolist(), points.max(axis=0).tolist()]


def runtime(p):
    return Vector((p[0], p[2], -p[1]))


def blender(p):
    return Vector((p[0], -p[2], p[1]))


def save_json(name, data):
    (REPORT / name).write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')


def components(mesh):
    parent = list(range(len(mesh.vertices)))
    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index
    positions = {}
    for vertex in mesh.vertices:
        key = tuple(round(value, 6) for value in vertex.co)
        if key in positions:
            parent[find(vertex.index)] = find(positions[key])
        positions[key] = vertex.index
    for edge in mesh.edges:
        parent[find(edge.vertices[0])] = find(edge.vertices[1])
    groups = {}
    for vertex in mesh.vertices:
        groups.setdefault(find(vertex.index), []).append(vertex.index)
    return list(groups.values())


def inspect_source():
    inventory = []
    for path in sorted(p for p in SOURCE.rglob('*') if p.is_file()):
        item = dict(file=path.relative_to(SOURCE).as_posix(), bytes=path.stat().st_size, sha256=sha(path))
        if path.suffix.lower() == '.png':
            item['dimensions'] = list(struct.unpack('>II', path.read_bytes()[16:24]))
        inventory.append(item)
        destination = WORK / 'source' / item['file']
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)
        assert sha(destination) == item['sha256']
    lines = (WORK / 'source/model_0.obj').read_text().splitlines()
    vertices = np.array([list(map(float, line.split()[1:4])) for line in lines if line.startswith('v ')])
    faces = np.array([[int(index.split('/')[0])-1 for index in line.split()[1:]]
                      for line in lines if line.startswith('f ')])
    areas = np.linalg.norm(np.cross(vertices[faces[:, 1]]-vertices[faces[:, 0]],
                                   vertices[faces[:, 2]]-vertices[faces[:, 0]]), axis=1)/2
    face_counts = collections.Counter(tuple(sorted(face)) for face in faces)
    source = dict(location=str(SOURCE), files=inventory,
        source_url=None, creator=None, license='unverified', redistribution_permission='unverified',
        attribution_requirement='unverified', units='unspecified in OBJ; normalization is explicitly chosen',
        coordinates='Z-up inferred from ring and downward tails; knot at +Y; front at -Y',
        obj=dict(objects=[line[2:] for line in lines if line.startswith('o ')],
                 groups=[line[2:] for line in lines if line.startswith('g ')],
                 material_libraries=[line[7:] for line in lines if line.startswith('mtllib ')],
                 missing_material_libraries=['model_0.mtl'], usemtl=[],
                 vertices=len(vertices), normals=sum(line.startswith('vn ') for line in lines),
                 uv_coordinates=sum(line.startswith('vt ') for line in lines),
                 face_records=len(faces), zero_area_faces=int(sum(areas < 1e-8)),
                 repeated_index_faces=sum(n-1 for n in face_counts.values()),
                 bounds=bounds(vertices), dimensions=(vertices.max(axis=0)-vertices.min(axis=0)).tolist(),
                 origin=[0, 0, 0], rigged=False, skinned=False, animation_clips=[]))
    save_json('source-inventory.json', source)
    return source


def material():
    mat = bpy.data.materials.new('RED_HEADBAND_SUPPLIED_TEXTURES')
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Metallic'].default_value = 0
    shader.inputs['IOR'].default_value = 1.45
    for filename, size, socket in [('Headband_BaseColor.png', 1024, 'Base Color'),
                                    ('Headband_Roughness.png', 512, 'Roughness')]:
        image = bpy.data.images.load(str(WORK / 'source' / filename))
        if socket == 'Roughness':
            image.colorspace_settings.name = 'Non-Color'
        image.scale(size, size)
        image.filepath_raw = str(WORK / 'textures' / filename)
        image.file_format = 'PNG'
        image.save()
        image.pack()
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = image
        mat.node_tree.links.new(node.outputs['Color'], shader.inputs[socket])
    return mat


def convert(source):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.obj_import(filepath=str(WORK / 'source/model_0.obj'), forward_axis='NEGATIVE_Y', up_axis='Z')
    objects = [obj for obj in bpy.context.selected_objects if obj.type == 'MESH']
    assert len(objects) == 1
    obj = objects[0]
    obj.name = 'RED_HEADBAND'
    obj.matrix_world = Matrix.Identity(4)  # Explicit raw Z-up coordinates, no implicit importer rotation.
    parts = components(obj.data)
    ring = max(parts, key=len)
    ring_points = np.array([list(obj.data.vertices[i].co) for i in ring])
    low, high = ring_points.min(axis=0), ring_points.max(axis=0)
    center = (low+high)/2
    unit_scale = .200/(high[0]-low[0])
    part_report = []
    for indices in parts:
        raw = np.array([list(obj.data.vertices[i].co) for i in indices])
        part_report.append(dict(vertices=len(indices), raw_bounds=bounds(raw)))
    for vertex in obj.data.vertices:
        vertex.co = Vector((np.array(vertex.co)-center)*unit_scale)
    obj.data.materials.clear()
    obj.data.materials.append(material())
    obj.data.calc_loop_triangles()
    assert len(obj.data.loop_triangles) == source['obj']['face_records'] - source['obj']['zero_area_faces']
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    runtime_points = np.array([list(runtime(v.co)) for v in obj.data.vertices])
    runtime_ring = runtime_points[ring]
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'red-headband.blend'), compress=True)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    glb = WORK / 'red-headband.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format='GLB', use_selection=True,
        export_yup=True, export_animations=False, export_materials='EXPORT',
        export_texcoords=True, export_normals=True, export_cameras=False, export_lights=False)
    result = dict(blender=bpy.app.version_string, file=glb.relative_to(ROOT).as_posix(), bytes=glb.stat().st_size,
        sha256=sha(glb), object='RED_HEADBAND', materials=['RED_HEADBAND_SUPPLIED_TEXTURES'],
        vertices=len(obj.data.vertices), triangles=len(obj.data.loop_triangles), polygons=len(obj.data.polygons),
        armatures=0, skins=0, animation_clips=[], connected_components=part_report,
        unit='meters', coordinate_system='Y-up; front +Z; bow and tails -Z',
        pivot='center of ring opening bounds (not full accessory including bow and tails)',
        source_center=center.tolist(), source_unit_to_meters=unit_scale,
        source_to_runtime='[(x-centerX)*s, (z-centerZ)*s, -(y-centerY)*s]',
        bounds=bounds(runtime_points), dimensions=(runtime_points.max(axis=0)-runtime_points.min(axis=0)).tolist(),
        ring_bounds=bounds(runtime_ring), ring_dimensions=(runtime_ring.max(axis=0)-runtime_ring.min(axis=0)).tolist(),
        textures=dict(base_color=[1024, 1024], roughness=[512, 512], embedded=True),
        optimization=['Blender rejects 6997 zero-area OBJ faces, including 71 repeated degenerate faces',
            'Ring, bow, knot and tails retain all nondegenerate supplied triangles; no decimation or redesign',
            'Shared material; base color 2048→1024, roughness 2048→512; embedded PNG images',
            'No character geometry, materials, rig or source file changes'],
        missing_mtl_resolution='Reconstructed metallic=0 cloth PBR material from supplied BaseColor and Roughness maps; original shader parameters unknown')
    save_json('conversion.json', result)
    for label, direction in [('front', (0, -1, .25)), ('back', (0, 1, .25)), ('top', (0, 0, 1)), ('iso', (1, -2, 1.3))]:
        render([obj], WORK / f'normalized-{label}.png', direction, size=650)
    return result, runtime_points, ring


def verify_fit(kind, conversion, band_points, ring):
    config = FITS[kind]
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/working/animation' / config['blend']))
    bpy.context.preferences.filepaths.save_version = 0
    arm = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
    arm.data.pose_position = 'REST'
    head_matrix = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1))) @ arm.data.bones['head'].matrix_local
    assert max(abs(head_matrix[i][j] - float(i == j)) for i in range(3) for j in range(3)) < .00001
    head_origin = Vector(head_matrix.translation)
    assert (head_origin - Vector(config['rest_head_origin'])).length < .00001
    heads = []
    for obj in list(bpy.context.scene.objects):
        if obj.type != 'MESH':
            continue
        obj.modifiers.clear()
        if kind == 'worker':
            group = obj.vertex_groups['head'].index
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bm.verts.ensure_lookup_table()
            keep = {v.index for v in obj.data.vertices if any(g.group == group and g.weight > .9 for g in v.groups)}
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context='VERTS')
            bm.to_mesh(obj.data)
            bm.free()
            heads.append(obj)
        elif obj.name in ['HEAD', 'GLASSES', 'EYELASHES', 'CORNEA_LEFT', 'CORNEA_RIGHT', 'EYE_LEFT', 'EYE_RIGHT', 'TEETH_LOWER', 'TEETH_UPPER']:
            heads.append(obj)
        else:
            obj.hide_render = True
    bpy.ops.import_scene.gltf(filepath=str(WORK / 'red-headband.glb'))
    band = next(obj for obj in bpy.context.selected_objects if obj.type == 'MESH')
    world_center = head_origin + Vector(config['position'])
    # Imported canonical accessory is Z-up again in Blender. Apply runtime fit with Y/Z scale swapped.
    band.location = blender(world_center)
    band.scale = (config['scale'][0], config['scale'][2], config['scale'][1])
    bpy.context.view_layer.update()
    fitted = band_points * np.array(config['scale']) + np.array(world_center)
    ring_fitted = fitted[ring]
    # Grip directly on the widest corresponding supplied ring surface, avoiding bow and tails.
    grip_indices = [ring[int(np.argmin(ring_fitted[:, 0]))], ring[int(np.argmax(ring_fitted[:, 0]))]]
    grips = [band_points[i].tolist() for i in grip_indices]
    result = dict(bone='headband_anchor', fallback_bone='head', headOffset=config['position'], position=config['position'],
        rotation=[0, 0, 0], scale=config['scale'], rest_head_origin=list(head_origin),
        world_center=list(world_center), ring_bounds=bounds(ring_fitted),
        ring_dimensions=(ring_fitted.max(axis=0)-ring_fitted.min(axis=0)).tolist(),
        full_bounds=bounds(fitted), full_dimensions=(fitted.max(axis=0)-fitted.min(axis=0)).tolist(),
        grips=[(fitted[i]-np.array(world_center)).tolist() for i in grip_indices],
        grips_asset_local=dict(right=grips[0], left=grips[1]),
        grips_head_local=dict(right=(fitted[grip_indices[0]]-np.array(head_origin)).tolist(),
                              left=(fitted[grip_indices[1]]-np.array(head_origin)).tolist()),
        fits_only_accessory='Nonuniform accessory fit preserves canonical worker/Manager geometry and uses the same accessory GLB')
    for label, direction in [('front', (0, -1, 0)), ('side', (1, 0, 0)), ('back', (0, 1, 0)), ('iso', (1, -2, 1))]:
        render([*heads, band], WORK / f'{kind}-fit-{label}.png', direction, size=740)
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / f'{kind}-fit.blend'), compress=True)
    return result


if __name__ == '__main__':
    source = inspect_source()
    conversion, points, ring = convert(source)
    fits = {kind: verify_fit(kind, conversion, points, ring) for kind in FITS}
    save_json('fits.json', fits)
    conversion['fits'] = fits
    save_json('conversion.json', conversion)
    for record in source['files']:
        assert sha(SOURCE / record['file']) == record['sha256'], 'Original source changed'
    print('HEADBAND_CONVERSION_READY_FOR_RENDER_REVIEW', json.dumps(conversion), flush=True)
