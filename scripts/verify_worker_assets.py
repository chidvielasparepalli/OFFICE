"""Assert source immutability and self-contained GLB exports; record runtime counts."""
import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'assets/workers'
result = {'sources_unchanged': [], 'assets': {}}
for kind in ['worker', 'workstation']:
    source = json.loads((REPORT / f'{kind}-source.json').read_text())
    for item in source['files']:
        path = Path(source['source']) / item['file']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], path
        result['sources_unchanged'].append(str(path))
conversion = json.loads((REPORT / 'conversion.json').read_text())
worker_source = json.loads((REPORT / 'worker-source.json').read_text())
worker_path = Path(worker_source['source'])
faces = [[int(token.split('/')[0]) for token in line.split()[1:]]
         for line in (worker_path / 'model_0.obj').read_text().splitlines() if line.startswith('f ')]
result['worker_source_face_check'] = dict(raw_faces=len(faces),
    repeated_index_faces=sum(len(set(face)) < 3 for face in faces))
assert len(faces) - result['worker_source_face_check']['repeated_index_faces'] == conversion['standardWorker']['triangles']
for kind, item in conversion.items():
    raw = (ROOT / item['file']).read_bytes()
    assert len(raw) == item['bytes'] < 1_000_000
    assert hashlib.sha256(raw).hexdigest() == item['sha256']
    assert struct.unpack_from('<4sII', raw) == (b'glTF', 2, len(raw))
    length, chunk = struct.unpack_from('<I4s', raw, 12)
    assert chunk == b'JSON'
    gltf = json.loads(raw[20:20+length])
    if kind == 'standardWorker':
        view = gltf['bufferViews'][gltf['images'][0]['bufferView']]
        start = 28 + length + view.get('byteOffset', 0)
        embedded = raw[start:start+view['byteLength']]
        result['worker_atlas_bytes_preserved'] = embedded == (worker_path / 'x.png').read_bytes()
        assert result['worker_atlas_bytes_preserved'], 'Atlas changed during export'
    assert not gltf.get('skins') and not gltf.get('animations') and not gltf.get('extensionsRequired')
    assert all('uri' not in entry for entry in gltf['buffers'])
    assert all('uri' not in image and 'bufferView' in image for image in gltf.get('images', []))
    triangles = vertices = 0
    for mesh in gltf['meshes']:
        for primitive in mesh['primitives']:
            assert primitive.get('mode', 4) == 4
            triangles += gltf['accessors'][primitive['indices']]['count'] // 3
            vertices += gltf['accessors'][primitive['attributes']['POSITION']]['count']
    assert triangles == item['triangles']
    assert len(gltf['meshes']) == len(item['meshes'])
    assert abs(item['bounds'][0][1]) < 1e-5
    result['assets'][kind] = dict(bytes=len(raw), triangles=triangles, exported_vertices=vertices,
        meshes=len(gltf['meshes']), materials=len(gltf['materials']), embedded_images=len(gltf.get('images', [])))
assert result['assets']['standardWorker']['embedded_images'] == 1
assert result['assets']['workstation']['embedded_images'] == 0
(REPORT / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
