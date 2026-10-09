"""Inspect renderable warehouse OBJs in an isolated Blender background process."""

import hashlib
import json
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'assets/working/warehouse'
WORK.mkdir(parents=True, exist_ok=True)
inventory = json.loads((ROOT / 'assets/warehouse/source-inventory.json').read_text())
source = Path(inventory['source'])
bpy.ops.wm.read_factory_settings(use_empty=True)
report = {'blender': bpy.app.version_string, 'objects': [], 'duplicates': [],
          'excluded_no_faces': [], 'source_axis_import': 'Z-up, Y-forward (no axis rotation)',
          'source_units': 'unspecified in OBJ'}
seen = {}
for item in inventory['files']:
    if not item.get('triangles'):
        report['excluded_no_faces'].append(item['file'])
        continue
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=str(source / item['file']),
                         forward_axis='Y', up_axis='Z')
    for obj in set(bpy.data.objects) - before:
        if obj.type != 'MESH':
            continue
        mesh = obj.data
        mesh.calc_loop_triangles()
        positions = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get('co', positions)
        corners = np.empty(len(mesh.loops), dtype=np.int32)
        mesh.loops.foreach_get('vertex_index', corners)
        digest = hashlib.sha256(positions.tobytes() + corners.tobytes()).hexdigest()
        if digest in seen:
            report['duplicates'].append({'file': item['file'], 'same_as': seen[digest]})
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
            continue
        seen[digest] = item['file']
        bounds = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
        low = [min(p[i] for p in bounds) for i in range(3)]
        high = [max(p[i] for p in bounds) for i in range(3)]
        entry = {'name': obj.name, 'source': item['file'], 'parent': None,
                 'vertices': len(mesh.vertices), 'polygons': len(mesh.polygons),
                 'triangles': len(mesh.loop_triangles), 'bounds': [low, high],
                 'materials': [m.name if m else None for m in mesh.materials],
                 'uv_layers': len(mesh.uv_layers), 'mesh_sha256': digest}
        report['objects'].append(entry)
        obj['source_file'] = item['file']
        obj.color = (0.48 + (len(seen) % 4) * 0.09, 0.61, 0.70, 1)
    print('IMPORTED', item['file'], flush=True)
report['triangles'] = sum(o['triangles'] for o in report['objects'])
report['bounds'] = [[min(o['bounds'][0][i] for o in report['objects']) for i in range(3)],
                    [max(o['bounds'][1][i] for o in report['objects']) for i in range(3)]]
(ROOT / 'assets/warehouse/blender-inspection.json').write_text(
    json.dumps(report, indent=2) + '\n', encoding='utf-8')
bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'warehouse-inspected.blend'), compress=True)
print('INSPECTION', json.dumps({k: v for k, v in report.items() if k != 'objects'}), flush=True)
