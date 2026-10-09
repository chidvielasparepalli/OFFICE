"""Optimize copied images with Pillow; source packages remain read-only."""
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'assets/working/desk-manager'
records = []
for kind in ('workstation', 'manager'):
    output = WORK / (kind + '-textures')
    output.mkdir(exist_ok=True)
    for path in sorted((WORK / (kind + '-source')).glob('*.png')):
        # Supplied screen screenshots are not presented as operating-system activity.
        if kind == 'workstation' and path.name not in ('download (20)_0.png', 'download (21)_1.png'):
            continue
        image = Image.open(path).convert('RGB')
        original_size = image.size
        normal = 'Normal' in path.name
        limit = 1024
        if 'Teeth' in path.name:
            limit = 512
        if 'Eyes' in path.name or 'Cornea' in path.name:
            limit = 256
        if path.name == 'download (21)_1.png':
            limit = 512
        image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        target = output / (path.stem + ('.png' if normal else '.jpg'))
        image.save(target, **({'optimize': True} if normal else {'quality': 90, 'subsampling': 0, 'optimize': True}))
        assert max(Image.open(target).size) <= limit
        records.append(dict(kind=kind, source=path.name, file=target.relative_to(ROOT).as_posix(),
            original_dimensions=original_size, dimensions=image.size, bytes=target.stat().st_size,
            encoding='lossless RGB PNG normal map' if normal else 'JPEG quality 90, no chroma subsampling'))
(ROOT / 'assets/desk-manager/textures.json').write_text(json.dumps(records, indent=2) + '\n')
print('Prepared', len(records), 'images;', sum(r['bytes'] for r in records), 'bytes')
