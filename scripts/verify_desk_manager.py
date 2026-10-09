"""Assert source preservation, GLB portability, counts and ground normalization."""
import hashlib
import json
import shutil
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'assets/desk-manager'
conversion = json.loads((REPORT / 'conversion.json').read_text())
result = dict(sources=[], exports=[])
for kind in ('workstation', 'manager'):
    inventory = json.loads((REPORT / f'{kind}-source.json').read_text())
    degenerate_faces = 0
    for item in inventory['files']:
        source = Path(inventory['source']) / item['file']
        copied = ROOT / f'assets/working/desk-manager/{kind}-source' / item['file']
        for path in (source, copied):
            assert hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256'], str(path)
        if source.suffix == '.obj':
            for line in source.read_text().splitlines():
                if line.startswith('f '):
                    indices = [p.split('/')[0] for p in line.split()[1:]]
                    if len(set(indices)) < 3:
                        degenerate_faces += 1
    result['sources'].append(dict(kind=kind, files_verified=len(inventory['files']),
        copies_verified=len(inventory['files']), repeated_index_degenerate_faces=degenerate_faces))
    entry = conversion[kind]
    raw = (ROOT / entry['file']).read_bytes()
    assert raw[:4] == b'glTF' and struct.unpack_from('<II', raw, 4) == (2, len(raw))
    assert hashlib.sha256(raw).hexdigest() == entry['sha256']
    length = struct.unpack_from('<I', raw, 12)[0]
    data = json.loads(raw[20:20+length])
    assert not data.get('skins') and not data.get('animations')
    assert not data.get('extensionsRequired')
    assert all('uri' not in i for i in data['buffers'] + data.get('images', []))
    triangles = sum(data['accessors'][p['indices']]['count']//3 for m in data['meshes'] for p in m['primitives'])
    assert triangles == entry['triangles']
    assert abs(entry['bounds'][0][1]) < 1e-5
    assert all(i > 0 for i in entry['dimensions'])
    result['exports'].append(dict(kind=kind, file=entry['file'], triangles=triangles,
        exported_vertices=entry['exported_vertices'], bytes=len(raw), materials=len(data['materials']),
        images=len(data.get('images', [])), external_dependencies=0, embedded_images=[i['name'] for i in data.get('images', [])]))

worker = json.loads((ROOT / 'assets/workers/conversion.json').read_text())['standardWorker']
assert hashlib.sha256((ROOT / worker['file']).read_bytes()).hexdigest() == worker['sha256']
result['canonical_stickman_unchanged'] = worker['sha256']
assert len(json.loads((REPORT / 'manager-inspection.json').read_text())['duplicates']) == 66
animated = json.loads((ROOT / 'assets/animation/conversion.json').read_text())
runtime_files = [(animated['worker'], 'characters/standard-worker-animated.glb'),
                 (animated['manager'], 'characters/primary-manager-animated.glb'),
                 (conversion['workstation'], 'workstations/standard-workstation.glb')]
for entry, relative in runtime_files:
    target = ROOT / 'public/assets/3d' / relative
    if '--stage-runtime' in sys.argv:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / entry['file'], target)
    if target.exists():
        assert hashlib.sha256(target.read_bytes()).hexdigest() == entry['sha256'], str(target)
result['runtime_files'] = [f'public/assets/3d/{relative}' for _, relative in runtime_files]
(REPORT / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result, indent=2))
