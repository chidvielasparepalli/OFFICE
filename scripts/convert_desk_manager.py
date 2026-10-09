"""Convert inspected Blender copies. Never touch originals or the canonical stickman."""
import hashlib
import json
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from inspect_desk_manager import render

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'assets/working/desk-manager'
REPORT = ROOT / 'assets/desk-manager'
textures = json.loads((REPORT / 'textures.json').read_text())


def bounds(objects):
    points = [o.matrix_world @ v.co for o in objects for v in o.data.vertices]
    return [Vector([min(p[i] for p in points) for i in range(3)]),
            Vector([max(p[i] for p in points) for i in range(3)])]


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def material(name, color=(1, 1, 1), kind=None, color_image=None, normal_image=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = .72
    for filename, is_normal in [(color_image, False), (normal_image, True)]:
        if not filename:
            continue
        record = next(r for r in textures if r['kind'] == kind and r['source'] == filename)
        image = bpy.data.images.load(str(ROOT / record['file']), check_existing=True)
        image.colorspace_settings.name = 'Non-Color' if is_normal else 'sRGB'
        image.pack()
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = image
        if is_normal:
            normal = mat.node_tree.nodes.new('ShaderNodeNormalMap')
            mat.node_tree.links.new(tex.outputs['Color'], normal.inputs['Color'])
            mat.node_tree.links.new(normal.outputs['Normal'], shader.inputs['Normal'])
        else:
            mat.node_tree.links.new(tex.outputs['Color'], shader.inputs['Base Color'])
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for face in obj.data.polygons:
        face.material_index = 0


def simplify(obj, budget):
    before = triangles(obj)
    original_low, original_high = bounds([obj])
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    # Preserve UV seams while removing coincident geometric vertices.
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=1e-7)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    after_weld = triangles(obj)
    if after_weld > budget:
        bpy.context.view_layer.objects.active = obj
        mod = obj.modifiers.new('Bounded simplification', 'DECIMATE')
        mod.ratio = budget / after_weld
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for v in obj.data.vertices:
        for axis in range(3):
            v.co[axis] = max(original_low[axis], min(original_high[axis], v.co[axis]))
    obj.data.validate()
    obj.data.update()
    return dict(source=obj.name, before=before, after_weld=after_weld, after=triangles(obj))


def finish(filename, objects, extra):
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    root = bpy.data.objects.new(filename.upper().replace('-', '_') + '_ROOT', None)
    scene.collection.objects.link(root)
    for obj in objects:
        obj.parent = root
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / f'{filename}.blend'), compress=True)
    path = WORK / f'{filename}.glb'
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', export_yup=True,
        export_animations=False, export_cameras=False, export_lights=False, export_extras=False)
    raw = path.read_bytes()
    length = int.from_bytes(raw[12:16], 'little')
    gltf = json.loads(raw[20:20+length])
    assert not gltf.get('skins') and not gltf.get('animations')
    assert all('uri' not in i for i in gltf.get('images', []))
    low, high = bounds(objects)
    runtime_low, runtime_high = [low.x, low.z, -high.y], [high.x, high.z, -low.y]
    assert abs(runtime_low[1]) < 1e-5
    entry = dict(file=path.relative_to(ROOT).as_posix(), bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
        bounds=[runtime_low, runtime_high], dimensions=[b-a for a,b in zip(runtime_low, runtime_high)],
        vertices=sum(len(o.data.vertices) for o in objects), triangles=sum(triangles(o) for o in objects),
        exported_vertices=sum(gltf['accessors'][p['attributes']['POSITION']]['count'] for m in gltf['meshes'] for p in m['primitives']),
        meshes=[dict(name=o.name, vertices=len(o.data.vertices), triangles=triangles(o),
                     materials=[m.name for m in o.data.materials]) for o in objects],
        images=len(gltf.get('images', [])), rigged=False, animations=0,
        coordinate_system='Y-up, meters, origin at ground; character faces +Z, desk user side faces -Z', **extra)
    render(objects, WORK / f'{filename}-render.png', (1.2, -2.5, 1.4) if filename == 'primary-manager' else (-1.2, 2.5, 1.8))
    print('EXPORTED', filename, len(raw), 'bytes', entry['triangles'], 'triangles', flush=True)
    return entry


def workstation():
    bpy.ops.wm.open_mainfile(filepath=str(WORK / 'workstation-inspected.blend'))
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for obj in objects:
        obj.data.transform(obj.matrix_world)
        obj.matrix_world.identity()
    low, high = bounds([bpy.data.objects['model_0'], bpy.data.objects['model_1']])
    scale = .75 / (high.z - low.z)
    center = Vector(((low.x+high.x)/2, (low.y+high.y)/2, low.z))
    mats = {
        'WOOD_TOP': material('Supplied_wood', kind='workstation', color_image='download (20)_0.png'),
        'DESK_MAT': material('Supplied_desk_mat', kind='workstation', color_image='download (21)_1.png'),
        'FRAME_ELECTRONICS': material('Neutral_charcoal', (.075, .09, .105)),
        'KEYS_ACCESSORIES': material('Neutral_ivory', (.65, .68, .7)),
        'SCREENS_OFF': material('Screens_off', (.018, .03, .045)),
    }
    cleanup = []
    components = {}
    for obj in objects:
        index = int(obj.name.split('_')[-1])
        category = ('WOOD_TOP' if index == 0 else 'DESK_MAT' if index == 2 else
            'SCREENS_OFF' if index in (4, 28, 30) else
            'KEYS_ACCESSORIES' if index in (13, 16, 17, 23, 24, 25, 26, 27, 29) else 'FRAME_ELECTRONICS')
        components[obj.name] = category
        budget = {1: 1800, 10: 2400, 13: 900, 15: 100, 16: 900, 17: 700,
                  24: 1100, 26: 1100, 29: 1400}.get(index, max(triangles(obj), 1))
        cleanup.append(simplify(obj, budget))
        for v in obj.data.vertices:
            v.co = (v.co-center)*scale
            v.co.x *= -1
            v.co.y *= -1
        assign(obj, mats[category])
    merged = []
    for category, mat in mats.items():
        parts = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o.data.materials[0] == mat]
        bpy.ops.object.select_all(action='DESELECT')
        for obj in parts:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = parts[0]
        bpy.ops.object.join()
        obj = bpy.context.object
        obj.name = category
        obj.data.update()
        merged.append(obj)
    # The new package has no chair. Reuse only the user's previously converted chair.
    old_blend = ROOT / 'assets/working/workers/office-workstation.blend'
    with bpy.data.libraries.load(str(old_blend), link=False) as (data_from, data_to):
        assert 'CHAIR' in data_from.objects
        data_to.objects = ['CHAIR']
    chair = data_to.objects[0]
    bpy.context.scene.collection.objects.link(chair)
    chair.parent = None
    chair.matrix_world.identity()
    c_low, c_high = bounds([chair])
    for v in chair.data.vertices:
        v.co.x -= (c_low.x+c_high.x)/2
        v.co.y -= (c_low.y+c_high.y)/2
        v.co.y += .88
        v.co.z -= c_low.z
    chair.data.update()
    merged.append(chair)
    result = finish('standard-workstation', merged, dict(scale_factor=scale, source_pivot_blender=list(center),
        desk_top_height=.75, worker_standing_anchor=[0, 0, -1.62],
        chair_center=[0, 0, -.88], chair_source='assets/working/workers/office-workstation.blend:CHAIR',
        chair_source_glb_sha256=json.loads((ROOT / 'assets/workers/conversion.json').read_text())['workstation']['sha256'],
        source_components=components, cleanup=cleanup,
        normalization='Uniform desk scale to 0.75 m top, rotated 180 degrees around up axis; prior supplied chair keeps its scale',
        material_assignment='Wood/pad images assigned by visible content and UVs; neutral finishes and powered-off screens replace missing MTL settings'))
    assert result['triangles'] < 35000
    return result


def manager():
    bpy.ops.wm.open_mainfile(filepath=str(WORK / 'manager-inspected.blend'))
    inspection = json.loads((REPORT / 'manager-inspection.json').read_text())
    for item in inspection['duplicates']:
        bpy.data.objects.remove(bpy.data.objects[Path(item['file']).stem], do_unlink=True)
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for obj in objects:
        obj.data.transform(obj.matrix_world)
        obj.matrix_world.identity()
    low, high = bounds(objects)
    scale = 1.8 / (high.z-low.z)
    feet = [v.co for o in objects for v in o.data.vertices if v.co.z < low.z + .03]
    pivot = Vector(((min(p.x for p in feet)+max(p.x for p in feet))/2,
        (min(p.y for p in feet)+max(p.y for p in feet))/2, low.z))
    mappings = [
        ('HANDS', 'AvatarBodyMale_Color_1K.png', 'AvatarBodyMale_Normal1_1K.png'),
        ('EYELASHES', None, None),
        ('HEAD', 'AvatarHeadMale_Color_1K.png', 'AvatarHeadMale_Normal1_1K.png'),
        ('CORNEA_LEFT', 'AvatarLeftCornea_Color_512.png', None),
        ('EYE_LEFT', 'AvatarEyes_Color_512.png', 'AvatarEyes_Normal_512.png'),
        ('CORNEA_RIGHT', 'AvatarRightCornea_Color_512.png', None),
        ('EYE_RIGHT', 'AvatarEyes_Color_512.png', 'AvatarEyes_Normal_512.png'),
        ('TEETH_LOWER', 'AvatarTeeth_Color_1K.png', 'AvatarTeeth_Normal1_1K.png'),
        ('TEETH_UPPER', 'AvatarTeeth_Color_1K.png', 'AvatarTeeth_Normal1_1K.png'),
        ('SUIT_SHOES', 'ARARAT_Color_1K.png', 'ARARAT_Normal_1K.png'),
        ('GLASSES', 'glasses_10_Color_256.png', None),
    ]
    cleanup, mapping = [], {}
    for i, (name, color_image, normal_image) in enumerate(mappings):
        obj = bpy.data.objects[f'model_{i}']
        mapping[obj.name] = dict(component=name, color=color_image, normal=normal_image)
        if i in (1, 9):
            cleanup.append(simplify(obj, 1200 if i == 1 else 24500))
        for v in obj.data.vertices:
            v.co = (v.co-pivot)*scale
        obj.data.update()
        mat = material(name, (.012, .012, .012) if i == 1 else (1, 1, 1), 'manager', color_image, normal_image)
        assign(obj, mat)
        obj.name = name
    result = finish('primary-manager', objects, dict(scale_factor=scale, source_pivot_blender=list(pivot),
        duplicates_removed=inspection['duplicates'], source_components=mapping, cleanup=cleanup,
        normalization='Uniform scale to chosen canonical height 1.80 m; feet-center ground pivot; source units unspecified',
        pose='Unchanged source T-pose; no rig or animation',
        material_assignment='Explicit anatomical/UV texture mapping; missing MTL means source shader settings are unknown'))
    assert abs(result['dimensions'][1] - 1.8) < 1e-5 and result['triangles'] < 60000
    return result


if __name__ == '__main__':
    result = dict(workstation=workstation(), manager=manager())
    (REPORT / 'conversion.json').write_text(json.dumps(result, indent=2) + '\n')
