"""Reproduce with Blender's bundled Python (NumPy); reads source assets without modifying them."""
import hashlib
import json
import math
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'assets/animation'
EXPECTED_CLIPS = {'stand_idle', 'seated_idle', 'seated_sleep', 'seated_work',
                  'seated_work_hard', 'headband_on', 'headband_off', 'walk', 'stand_up', 'sit_down'}
DTYPES = {5120: '<i1', 5121: '<u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}
WIDTHS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Glb:
    def __init__(self, record):
        path = ROOT / record['file']
        raw = path.read_bytes()
        assert len(raw) == record['bytes'] and sha256(path) == record['sha256'], path
        assert struct.unpack_from('<4sII', raw) == (b'glTF', 2, len(raw)), path
        length, kind = struct.unpack_from('<I4s', raw, 12)
        assert kind == b'JSON'
        self.doc = json.loads(raw[20:20 + length])
        binary_length, kind = struct.unpack_from('<I4s', raw, 20 + length)
        assert kind == b'BIN\0' and len(raw) == 28 + length + binary_length
        self.binary = raw[28 + length:]
        assert len(self.doc['buffers']) == 1 and 'uri' not in self.doc['buffers'][0]
        assert self.doc['buffers'][0]['byteLength'] <= len(self.binary)
        assert not self.doc.get('extensionsRequired'), 'Unexpected decoder dependency'
        assert all('uri' not in image and 'bufferView' in image for image in self.doc.get('images', []))

    def accessor(self, index):
        value = self.doc['accessors'][index]
        assert not value.get('sparse'), 'Add sparse accessor decoding before accepting it'
        view = self.doc['bufferViews'][value['bufferView']]
        dtype = np.dtype(DTYPES[value['componentType']])
        width = WIDTHS[value['type']]
        stride = view.get('byteStride', width * dtype.itemsize)
        offset = view.get('byteOffset', 0) + value.get('byteOffset', 0)
        end = offset + (value['count'] - 1) * stride + width * dtype.itemsize
        assert end <= view.get('byteOffset', 0) + view['byteLength'] <= len(self.binary)
        array = np.ndarray((value['count'], width), dtype, self.binary, offset,
                           strides=(stride, dtype.itemsize)).copy()
        if value.get('normalized'):
            limit = np.iinfo(dtype).max
            array = np.maximum(array.astype(float) / limit, -1)
        assert np.isfinite(array).all()
        return array

    def image_bytes(self, image):
        view = self.doc['bufferViews'][image['bufferView']]
        offset = view.get('byteOffset', 0)
        return self.binary[offset:offset + view['byteLength']]


def quaternion_matrix(q):
    x, y, z, w = q / np.linalg.norm(q)
    return np.array([[1 - 2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                     [2*(x*y+z*w), 1 - 2*(x*x+z*z), 2*(y*z-x*w)],
                     [2*(x*z-y*w), 2*(y*z+x*w), 1 - 2*(x*x+y*y)]])


def sampled_world_matrices(glb, animation, seconds):
    values = [{key: np.array(node.get(key, default), dtype=float)
               for key, default in [('translation', [0, 0, 0]), ('rotation', [0, 0, 0, 1]), ('scale', [1, 1, 1])]}
              for node in glb.doc['nodes']]
    for channel in animation['channels']:
        sampler = animation['samplers'][channel['sampler']]
        times = glb.accessor(sampler['input'])[:, 0]
        output = glb.accessor(sampler['output'])
        index = max(0, min(len(times)-2, int(np.searchsorted(times, seconds)) - 1))
        alpha = np.clip((seconds-times[index])/(times[index+1]-times[index]), 0, 1)
        start, end = output[index].astype(float), output[index+1].astype(float)
        if sampler.get('interpolation', 'LINEAR') == 'STEP':
            value = output[min(len(times)-1, int(np.searchsorted(times, seconds, side='right'))-1)]
        elif channel['target']['path'] == 'rotation':
            dot = np.dot(start, end)
            if dot < 0:
                end, dot = -end, -dot
            if dot < .9995:
                angle = math.acos(np.clip(dot, -1, 1))
                value = (start*math.sin((1-alpha)*angle) + end*math.sin(alpha*angle))/math.sin(angle)
            else:
                value = start*(1-alpha)+end*alpha
            value /= np.linalg.norm(value)
        else:
            value = start*(1-alpha)+end*alpha
        values[channel['target']['node']][channel['target']['path']] = value
    parents = {child: parent for parent, node in enumerate(glb.doc['nodes']) for child in node.get('children', [])}
    cache = {}

    def world(index):
        if index not in cache:
            node = glb.doc['nodes'][index]
            if 'matrix' in node:
                matrix = np.array(node['matrix']).reshape(4, 4).T
            else:
                value = values[index]
                matrix = np.eye(4)
                matrix[:3, :3] = quaternion_matrix(value['rotation']) @ np.diag(value['scale'])
                matrix[:3, 3] = value['translation']
            cache[index] = world(parents[index]) @ matrix if index in parents else matrix
        return cache[index]

    return np.array([world(index) for index in range(len(values))])


def pose_bounds(glb, animation, seconds, geometry):
    skin = glb.doc['skins'][0]
    world = sampled_world_matrices(glb, animation, seconds)
    inverse = glb.accessor(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    transforms = world[skin['joints']] @ inverse
    points = []
    for position, joints, weights in geometry:
        homogeneous = np.column_stack((position, np.ones(len(position))))
        transformed = np.einsum('nvij,nj->nvi', transforms[joints], homogeneous)
        points.append((transformed * weights[:, :, None]).sum(axis=1)[:, :3])
    merged = np.concatenate(points)
    return np.array([merged.min(axis=0), merged.max(axis=0)]), world


def verify(kind, record, static_record, inventory_file):
    clips = record['clips']
    assert set(clips) == EXPECTED_CLIPS
    assert all(math.isfinite(duration) and duration > 0 for duration in clips.values())
    assert clips['stand_up'] == clips['sit_down']
    inventory = json.loads((ROOT / inventory_file).read_text())
    for source in inventory['files']:
        path = Path(inventory['source']) / source['file']
        assert path.stat().st_size == source['bytes'] and sha256(path) == source['sha256'], path
    source, animated = Glb(static_record), Glb(record)
    old, new = source.doc, animated.doc
    assert not old.get('skins') and not old.get('animations')
    assert len(new['skins']) == 1 and len(new['meshes']) == len(old['meshes'])
    assert old['materials'] == new['materials'] and old.get('textures') == new.get('textures')
    assert len(old.get('images', [])) == len(new.get('images', []))
    for a, b in zip(old.get('images', []), new.get('images', [])):
        assert a['mimeType'] == b['mimeType'] and source.image_bytes(a) == animated.image_bytes(b)
    skin = new['skins'][0]
    assert len(skin['joints']) == len(set(skin['joints'])) == len(record['bones'])
    names = {new['nodes'][index]['name']: index for index in skin['joints']}
    assert set(names) == set(record['bones'])
    inverse = animated.accessor(skin['inverseBindMatrices']).reshape(-1, 4, 4)
    assert len(inverse) == len(skin['joints']) and np.allclose(np.linalg.det(inverse), 1, atol=.00002)
    for node in new['nodes']:
        if 'mesh' in node:
            assert node['skin'] == 0 and not any(key in node for key in ('matrix', 'rotation', 'scale', 'translation'))
    geometry, triangles, vertices, normal_error = [], 0, 0, 0
    for a, b in zip(old['meshes'], new['meshes']):
        assert a['name'] == b['name'] and len(a['primitives']) == len(b['primitives'])
        for first, second in zip(a['primitives'], b['primitives']):
            assert first.get('mode', 4) == second.get('mode', 4) == 4
            assert first['material'] == second['material'] and not second.get('targets')
            indices = animated.accessor(second['indices'])
            assert np.array_equal(source.accessor(first['indices']), indices)
            for attribute, index in first['attributes'].items():
                before, after = source.accessor(index), animated.accessor(second['attributes'][attribute])
                assert before.shape == after.shape
                if attribute == 'NORMAL':
                    difference = float(np.max(np.abs(before-after)))
                    normal_error = max(normal_error, difference)
                    assert difference <= .000002
                else:
                    assert np.array_equal(before, after), f'{kind}: {attribute} changed'
            position = animated.accessor(second['attributes']['POSITION'])
            joints = animated.accessor(second['attributes']['JOINTS_0'])
            weights = animated.accessor(second['attributes']['WEIGHTS_0'])
            assert joints.shape == weights.shape == (len(position), 4)
            assert joints.min() >= 0 and joints.max() < len(skin['joints'])
            assert weights.min() >= 0 and weights.max() <= 1
            assert np.allclose(weights.sum(axis=1), 1, atol=.00002)
            assert np.max(np.count_nonzero(weights > 0, axis=1)) <= (1 if kind == 'worker' else 3)
            assert indices.max() < len(position) and len(indices) % 3 == 0
            triangles += len(indices)//3
            vertices += len(position)
            geometry.append((position, joints, weights))
    positions = np.concatenate([item[0] for item in geometry])
    rest_bounds = np.array([positions.min(axis=0), positions.max(axis=0)])
    assert np.allclose(rest_bounds, static_record['bounds'], atol=.00001)
    assert abs(rest_bounds[0, 1]) < .00001
    assert abs(rest_bounds[1, 1] - (1.75 if kind == 'worker' else 1.8)) < .00001
    assert triangles == static_record['triangles']
    animations = {animation['name']: animation for animation in new['animations']}
    assert set(animations) == EXPECTED_CLIPS
    channels = {}
    for name, animation in animations.items():
        tracks = {}
        for channel in animation['channels']:
            sampler = animation['samplers'][channel['sampler']]
            assert sampler.get('interpolation', 'LINEAR') in ('LINEAR', 'STEP')
            times, output = animated.accessor(sampler['input'])[:, 0], animated.accessor(sampler['output'])
            if sampler.get('interpolation') == 'STEP':
                assert np.allclose(output, output[0], atol=.00002), 'Only static tracks may use STEP'
            assert len(times) >= 2 and len(times) == len(output) and np.all(np.diff(times) > 0)
            assert abs(times[0]) < .00001 and abs(times[-1]-clips[name]) < .00001
            target, path = channel['target']['node'], channel['target']['path']
            assert target in skin['joints'] and path in ('rotation', 'translation', 'scale')
            key = (new['nodes'][target]['name'], path)
            assert key not in tracks
            tracks[key] = output
            if path == 'rotation':
                assert np.allclose(np.linalg.norm(output, axis=1), 1, atol=.00002)
            if path == 'scale':
                assert np.allclose(output, 1, atol=.00002)
            if name not in ('sit_down', 'stand_up', 'headband_on', 'headband_off'):
                error = min(np.max(np.abs(output[0]-output[-1])), np.max(np.abs(output[0]+output[-1]))) if path == 'rotation' else np.max(np.abs(output[0]-output[-1]))
                assert error < .00002, f'{kind}/{name}/{key}: loop does not close'
            if key[0] == 'root':
                assert np.allclose(output, output[0], atol=.00002), 'Root movement belongs to navigation'
        assert set(tracks) == {(bone, channel) for bone in record['bones'] for channel in ('translation', 'rotation', 'scale')}
        if name in ('seated_work', 'seated_work_hard', 'walk'):
            assert max(float(np.max(np.ptp(track, axis=0))) for track in tracks.values()) > .002
        channels[name] = tracks
    for key, forward in channels['stand_up'].items():
        reverse = channels['sit_down'][key][::-1]
        assert forward.shape == reverse.shape
        error = np.minimum(np.max(np.abs(forward-reverse), axis=1), np.max(np.abs(forward+reverse), axis=1)) if key[1] == 'rotation' else np.max(np.abs(forward-reverse), axis=1)
        assert np.max(error) < .00002, f'{kind}/{key}: sit/stand reversal mismatch'
    for key, forward in channels['headband_on'].items():
        reverse = channels['headband_off'][key][::-1]
        assert forward.shape == reverse.shape
        error = np.minimum(np.max(np.abs(forward-reverse), axis=1), np.max(np.abs(forward+reverse), axis=1)) if key[1] == 'rotation' else np.max(np.abs(forward-reverse), axis=1)
        assert np.max(error) < .00002, f'{kind}/{key}: accessory reversal mismatch'
    fit = record['headband']['fit']
    for time in np.linspace(0, clips['seated_work_hard'], 17):
        world = sampled_world_matrices(animated, animations['seated_work_hard'], time)
        relative = np.linalg.inv(world[names['head']]) @ world[names['headband_anchor']]
        assert np.allclose(relative[:3, 3], fit['headOffset'], atol=.00001), 'Headband drifts from head'
    samples = {}
    for name, animation in animations.items():
        bounds = [pose_bounds(animated, animation, clips[name]*fraction, geometry)[0]
                  for fraction in np.linspace(0, 1, 9)]
        samples[name] = {'minimum_floor_y': min(float(box[0, 1]) for box in bounds),
                         'maximum_floor_y': max(float(box[0, 1]) for box in bounds),
                         'start_dimensions': (bounds[0][1]-bounds[0][0]).tolist()}
        assert samples[name]['minimum_floor_y'] > -.025, f'{kind}/{name}: floor penetration'
        assert samples[name]['maximum_floor_y'] < .025, f'{kind}/{name}: both feet float'
    seated_bounds, world = pose_bounds(animated, animations['seated_work'], 0, geometry)
    assert abs(world[names['hips'], 1, 3] - record['seated_pelvis_height']) < .02
    for side in ('L', 'R'):
        assert world[names['shin.'+side], 1, 3] > world[names['foot.'+side], 1, 3] + .2
        assert abs(world[names['hand.'+side], 1, 3] - .82) < .02
    assert samples['stand_idle']['start_dimensions'][0] < (rest_bounds[1, 0]-rest_bounds[0, 0])*.8
    return {'file': record['file'], 'sha256': record['sha256'], 'bytes': record['bytes'],
            'original_source_files_unchanged': len(inventory['files']), 'canonical_static_sha256': static_record['sha256'],
            'vertices': vertices, 'triangles': triangles, 'skin_count': 1, 'bone_count': len(names),
            'rest_dimensions': (rest_bounds[1]-rest_bounds[0]).tolist(),
            'positions_uvs_indices_images_materials_preserved': True, 'maximum_normal_rounding_error': normal_error,
            'clips': clips, 'weights_normalized': True, 'loops_closed': True, 'sit_stand_reversible': True,
            'headband_reversible': True, 'headband_attachment_verified': True,
            'sampled_pose_bounds': samples, 'seated_dimensions': (seated_bounds[1]-seated_bounds[0]).tolist()}


if __name__ == '__main__':
    conversion = json.loads((REPORT / 'conversion.json').read_text())
    workers = json.loads((ROOT / 'assets/workers/conversion.json').read_text())
    manager = json.loads((ROOT / 'assets/desk-manager/conversion.json').read_text())
    result = {
        'worker': verify('worker', conversion['worker'], workers['standardWorker'], 'assets/workers/worker-source.json'),
        'manager': verify('manager', conversion['manager'], manager['manager'], 'assets/desk-manager/manager-source.json'),
    }
    (REPORT / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
