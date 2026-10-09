"""Verify immutable sources and the self-contained GLB produced by Blender."""

import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
inventory = json.loads((ROOT / 'assets/warehouse/source-inventory.json').read_text())
metadata = json.loads((ROOT / 'assets/warehouse/conversion.json').read_text())
for item in inventory['files']:
    path = Path(inventory['source']) / item['file']
    with path.open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == item['sha256'], path
raw = (ROOT / metadata['file']).read_bytes()
assert len(raw) == metadata['bytes'] < 10_000_000
assert hashlib.sha256(raw).hexdigest() == metadata['sha256']
magic, version, length = struct.unpack_from('<4sII', raw)
assert magic == b'glTF' and version == 2 and length == len(raw)
json_length, chunk = struct.unpack_from('<I4s', raw, 12)
assert chunk == b'JSON'
gltf = json.loads(raw[20:20 + json_length])
assert not gltf.get('images') and not gltf.get('textures')
assert not gltf.get('animations') and not gltf.get('skins')
assert all('uri' not in buffer for buffer in gltf['buffers'])
assert not gltf.get('extensionsRequired'), 'Unexpected external decoder dependency'
triangles = 0
for mesh in gltf['meshes']:
    for primitive in mesh['primitives']:
        assert primitive.get('mode', 4) == 4
        triangles += gltf['accessors'][primitive['indices']]['count'] // 3
assert triangles == metadata['triangles'], (triangles, metadata['triangles'])
names = [node.get('name') for node in gltf['nodes']]
for anchor in metadata['anchors']:
    assert names.count(anchor['name']) == 1
    node = next(n for n in gltf['nodes'] if n.get('name') == anchor['name'])
    assert all(abs(a - b) < 0.0001 for a, b in zip(node.get('translation', [0, 0, 0]), anchor['position']))
assert len(gltf['meshes']) == len(metadata['components'])
print(f'PASS: {len(inventory["files"])} source hashes unchanged; '
      f'{len(gltf["meshes"])} meshes; {triangles} triangles; '
      f'{len(metadata["anchors"])} anchors; {len(raw)} bytes; no external dependencies.')
