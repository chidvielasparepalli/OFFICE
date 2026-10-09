"""Read-only OBJ inventory; run with Blender's bundled Python or Python 3."""

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path


def inventory(source):
    assert source.is_dir(), f'Source directory missing: {source}'
    records = []
    for path in sorted(source.rglob('*')):
        if not path.is_file():
            continue
        raw = path.read_bytes()
        item = dict(file=path.relative_to(source).as_posix(), bytes=len(raw),
                    sha256=hashlib.sha256(raw).hexdigest())
        if path.suffix.lower() == '.obj':
            low, high = [float('inf')] * 3, [-float('inf')] * 3
            vertices = faces = triangles = uv = normals = lines = 0
            objects, groups, libraries, materials = set(), set(), set(), set()
            for line in raw.decode('utf-8-sig').splitlines():
                parts = line.split()
                if not parts:
                    continue
                key = parts[0]
                if key == 'v':
                    point = list(map(float, parts[1:4]))
                    assert len(point) == 3
                    vertices += 1
                    low = [min(a, b) for a, b in zip(low, point)]
                    high = [max(a, b) for a, b in zip(high, point)]
                elif key == 'f':
                    assert len(parts) >= 4
                    faces += 1
                    triangles += len(parts) - 3
                elif key == 'vt':
                    uv += 1
                elif key == 'vn':
                    normals += 1
                elif key == 'l':
                    lines += 1
                elif key in ('o', 'g', 'mtllib', 'usemtl'):
                    {'o': objects, 'g': groups, 'mtllib': libraries,
                     'usemtl': materials}[key].add(' '.join(parts[1:]))
            assert vertices, f'No vertices: {path}'
            item.update(vertices=vertices, faces=faces, triangles=triangles,
                        lines=lines,
                        uv_coordinates=uv, normals=normals, bounds=[low, high],
                        dimensions=[b - a for a, b in zip(low, high)],
                        objects=sorted(objects), groups=sorted(groups),
                        material_libraries=sorted(libraries), materials=sorted(materials),
                        missing_libraries=[p for p in sorted(libraries)
                                           if not (path.parent / p).is_file()])
        records.append(item)
    assert any(i.get('triangles') for i in records), 'No renderable OBJ source files'
    hashes = defaultdict(list)
    for item in records:
        hashes[item['sha256']].append(item['file'])
    return dict(source=str(source.resolve()), files=records,
                file_count=len(records), bytes=sum(i['bytes'] for i in records),
                triangles=sum(i.get('triangles', 0) for i in records),
                byte_identical_groups=[v for v in hashes.values() if len(v) > 1])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = inventory(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: v for k, v in result.items() if k != 'files'}))
