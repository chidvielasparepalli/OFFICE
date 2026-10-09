"""Independent headband grip/trajectory checks. Run with Blender --background --python.

Pass --targets-only after -- to inspect current authoring targets before GLB export.
"""
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'assets/headband/sequence-verification.json'
sys.path.insert(0, str(ROOT / 'scripts'))
from verify_character_animation import Glb, sampled_world_matrices


def target_analysis(fits):
    from rig_office_characters import CONFIGS, HEADBAND_SECONDS, skeleton, pose
    result = {}
    for kind, config in CONFIGS.items():
        config['headband'] = fits[kind]
        bones = skeleton(config)
        errors = {'L': [], 'R': []}
        clearance = []
        for fraction in np.linspace(0, 1, 109):
            targets = pose(config, bones, 'headband_on', float(fraction)*HEADBAND_SECONDS)
            head_a, head_b = targets['head']
            rotation = (bones['head'][1]-bones['head'][0]).rotation_difference(head_b-head_a).to_matrix()
            band = targets['headband_anchor'][0]
            crown = head_a + rotation @ Vector((0, config['top']-config['head_y'], 0))
            clearance.append(float(band.y-crown.y))
            for side, grip_index, start in [('R', 0, .12), ('L', 1, .34)]:
                if start <= fraction <= .80:
                    grip = band + rotation @ Vector(fits[kind]['grips'][grip_index])
                    wrist, tip = targets['hand.'+side]
                    finger = wrist + (tip-wrist)*.72
                    errors[side].append({'progress': float(fraction), 'gap_m': float((finger-grip).length)})
        result[kind] = {
            'right_grip_max': max(errors['R'], key=lambda row: row['gap_m']),
            'left_grip_max': max(errors['L'], key=lambda row: row['gap_m']),
            'maximum_band_center_above_crown_m': max(clearance),
            'band_center_at_forehead_below_crown_m': -clearance[-1],
        }
    return result


def prepared_geometry(glb):
    names = {node['mesh']: node.get('name', str(node['mesh']))
             for node in glb.doc['nodes'] if 'mesh' in node}
    result = []
    for mesh_index, mesh in enumerate(glb.doc['meshes']):
        for primitive in mesh['primitives']:
            attributes = primitive['attributes']
            positions = glb.accessor(attributes['POSITION'])
            result.append({
                'name': names[mesh_index], 'positions': positions,
                'homogeneous': np.column_stack((positions, np.ones(len(positions)))),
                'joints': glb.accessor(attributes['JOINTS_0']),
                'weights': glb.accessor(attributes['WEIGHTS_0']),
                'indices': glb.accessor(primitive['indices']).reshape(-1, 3),
            })
    return result


def furniture_geometry(name):
    metadata = json.loads((ROOT / 'assets/desk-manager/conversion.json').read_text())['workstation']
    glb = Glb(metadata)
    node = next(node for node in glb.doc['nodes'] if node.get('name') == name)
    primitive = glb.doc['meshes'][node['mesh']]['primitives'][0]
    positions = glb.accessor(primitive['attributes']['POSITION']).astype(float)
    world = sampled_world_matrices(glb, {'channels': []}, 0)
    node_index = glb.doc['nodes'].index(node)
    positions = (world[node_index] @ np.column_stack((positions, np.ones(len(positions)))).T).T[:, :3]
    positions[:, 2] += .73
    indices = glb.accessor(primitive['indices']).reshape(-1, 3)
    return BVHTree.FromPolygons(positions.tolist(), indices.tolist(), all_triangles=True)


def collision_details(tree, points, triangles, hits):
    """Local contact region and sampled penetrating-vertex depth, not a solid-overlap volume."""
    vertices = np.unique(triangles[[hit[1] for hit in hits]].reshape(-1))
    candidates = points[vertices]
    deepest = None
    direction = Vector((.8391, .2473, .4842)).normalized()
    for point in candidates:
        origin = Vector(point)
        nearest = tree.find_nearest(origin)
        if nearest[0] is None or nearest[3] < .000001:
            continue
        if nearest[1].dot(origin-nearest[0]) >= -.0000001:
            continue
        cursor, crossings = origin + direction*.0000001, 0
        for _ in range(40):
            location, _, _, _ = tree.ray_cast(cursor, direction, 10)
            if location is None:
                break
            crossings += 1
            cursor = location + direction*.000001
        if crossings % 2 and (deepest is None or nearest[3] > deepest['depth_m']):
            deepest = {'position_m': list(point), 'depth_m': float(nearest[3])}
    return {'intersecting_triangle_region_m': [candidates.min(axis=0).tolist(), candidates.max(axis=0).tolist()],
            'deepest_inside_vertex': deepest}


def accessory_geometry(record):
    glb = Glb(record)
    world = sampled_world_matrices(glb, {'channels': []}, 0)
    positions, triangles, offset = [], [], 0
    for node_index, node in enumerate(glb.doc['nodes']):
        if 'mesh' not in node:
            continue
        for primitive in glb.doc['meshes'][node['mesh']]['primitives']:
            points = glb.accessor(primitive['attributes']['POSITION'])
            points = (world[node_index] @ np.column_stack((points, np.ones(len(points)))).T).T[:, :3]
            positions.append(points)
            triangles.append(glb.accessor(primitive['indices']).reshape(-1, 3) + offset)
            offset += len(points)
    bounds = record['ring_bounds']
    corners = np.array([[bounds[x][0], bounds[y][1], bounds[z][2]]
                        for x in (0, 1) for y in (0, 1) for z in (0, 1)])
    return np.concatenate(positions), np.concatenate(triangles), corners


def verify_export(kind, record, fit, desk, chair, accessory):
    assert record['headband']['fit'] == fit, 'GLB metadata uses a stale accessory fit'
    glb = Glb(record)
    geometry = prepared_geometry(glb)
    skin = glb.doc['skins'][0]
    inverse = glb.accessor(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    names = {node.get('name'): index for index, node in enumerate(glb.doc['nodes'])}
    animations = {animation['name']: animation for animation in glb.doc['animations']}
    triangles, triangle_ends, offset, triangle_count = [], [], 0, 0
    for part in geometry:
        triangles.append(part['indices'] + offset)
        offset += len(part['positions'])
        triangle_count += len(part['indices'])
        triangle_ends.append(triangle_count)
    triangles = np.concatenate(triangles)
    rest = np.concatenate([part['positions'] for part in geometry])
    head_mask = rest[:, 1] > (1.38 if kind == 'worker' else 1.60)
    assert head_mask.any()
    accessory_points, accessory_triangles, ring_corners = accessory
    accessory_points = np.column_stack((accessory_points * fit['scale'], np.ones(len(accessory_points))))
    ring_corners = np.column_stack((ring_corners * fit['scale'], np.ones(len(ring_corners))))
    checks = {}
    failures = []
    for clip in ('headband_on', 'headband_off', 'seated_work_hard'):
        duration = record['clips'][clip]
        critical = np.linspace(0, 1, 37).tolist() + [.12, .18, .30, .34, .46, .64, .80]
        fractions = sorted(set(round(value, 12) for value in critical + [1-value for value in critical]))
        grips = {'R': [], 'L': []}
        floor, centers, contacts, accessory_contacts, chair_contacts, attachments = [], [], [], [], [], []
        for fraction in fractions:
            seconds = float(fraction)*duration
            world = sampled_world_matrices(glb, animations[clip], seconds)
            transforms = world[skin['joints']] @ inverse
            pieces = []
            for part in geometry:
                transformed = np.einsum('nvij,nj->nvi', transforms[part['joints']], part['homogeneous'])
                pieces.append((transformed*part['weights'][:, :, None]).sum(axis=1)[:, :3])
            points = np.concatenate(pieces)
            floor.append(float(points[:, 1].min()))
            character = BVHTree.FromPolygons(points.tolist(), triangles.tolist(), all_triangles=True)
            hits = desk.overlap(character)
            if hits:
                contact_names = sorted({geometry[int(np.searchsorted(triangle_ends, hit[1], side='right'))]['name']
                                        for hit in hits})
                contacts.append({'seconds': seconds, 'pairs': len(hits), 'meshes': contact_names,
                                 **collision_details(desk, points, triangles, hits)})
            anchor = world[names['headband_anchor']]
            equip = 1-fraction if clip == 'headband_off' else fraction
            if clip == 'seated_work_hard' or equip >= .12:
                band_points = (anchor @ accessory_points.T).T[:, :3]
                band_mesh = BVHTree.FromPolygons(band_points.tolist(), accessory_triangles.tolist(), all_triangles=True)
                band_hits = desk.overlap(band_mesh)
                if band_hits:
                    accessory_contacts.append({'seconds': seconds, 'progress': equip, 'pairs': len(band_hits),
                                                **collision_details(desk, band_points, accessory_triangles, band_hits)})
                chair_hits = chair.overlap(band_mesh)
                if chair_hits:
                    chair_contacts.append({'seconds': seconds, 'progress': equip, 'pairs': len(chair_hits),
                                           **collision_details(chair, band_points, accessory_triangles, chair_hits)})
            crown = points[head_mask, 1].max()
            ring_minimum_y = (anchor @ ring_corners.T).T[:, 1].min()
            centers.append({'progress': equip, 'center_above_crown_m': float(anchor[1, 3]-crown),
                            'ring_lower_bound_above_crown_m': float(ring_minimum_y-crown)})
            if clip in ('headband_on', 'headband_off'):
                for side, grip_index, start in [('R', 0, .12), ('L', 1, .34)]:
                    if start-.0000000001 <= equip <= .80+.0000000001:
                        grip = anchor @ np.array([*fit['grips'][grip_index], 1])
                        finger = world[names['hand.'+side]] @ np.array([0, .17*.72, 0, 1])
                        grips[side].append({'seconds': seconds, 'progress': equip,
                                            'gap_m': float(np.linalg.norm(finger[:3]-grip[:3]))})
            else:
                relative = np.linalg.inv(world[names['head']]) @ anchor
                attachments.append(float(np.max(np.abs(relative[:3, 3]-fit['headOffset']))))
                assert np.allclose(relative[:3, :3], np.eye(3), atol=.00002), 'Band twists relative to head'
        check = {'samples': len(fractions), 'floor_range_m': [min(floor), max(floor)],
                 'maximum_desk_triangle_pairs': max((row['pairs'] for row in contacts), default=0),
                 'desk_contacts': contacts,
                 'maximum_accessory_desk_triangle_pairs': max((row['pairs'] for row in accessory_contacts), default=0),
                 'accessory_desk_contacts': accessory_contacts,
                 'maximum_accessory_chair_triangle_pairs': max((row['pairs'] for row in chair_contacts), default=0),
                 'accessory_chair_contacts': chair_contacts}
        if clip in ('headband_on', 'headband_off'):
            check['right_grip_max'] = max(grips['R'], key=lambda row: row['gap_m'])
            check['left_grip_max'] = max(grips['L'], key=lambda row: row['gap_m'])
            check['maximum_band_center_above_crown_m'] = max(row['center_above_crown_m'] for row in centers)
            check['maximum_ring_lower_bound_above_crown_m'] = max(row['ring_lower_bound_above_crown_m'] for row in centers)
            check['forehead_below_crown_m'] = -min(centers, key=lambda row: abs(row['progress']-1))['center_above_crown_m']
            if max(check['right_grip_max']['gap_m'], check['left_grip_max']['gap_m']) > .01:
                failures.append(f'{kind}/{clip}: hand-to-band gap exceeds 10 mm')
            if check['maximum_ring_lower_bound_above_crown_m'] < .015:
                failures.append(f'{kind}/{clip}: band does not clear crown')
        else:
            check['maximum_head_attachment_error_m'] = max(attachments)
            if max(attachments) > .00001:
                failures.append(f'{kind}/{clip}: headband attachment drifts')
        if min(floor) < -.002 or max(floor) > .002:
            failures.append(f'{kind}/{clip}: seated feet lose floor contact')
        if contacts:
            failures.append(f'{kind}/{clip}: desktop triangle intersections')
        if accessory_contacts:
            failures.append(f'{kind}/{clip}: visible accessory intersects desktop')
        if chair_contacts:
            failures.append(f'{kind}/{clip}: visible accessory intersects chair')
        checks[clip] = check
    return {'file': record['file'], 'sha256': record['sha256'], 'bytes': record['bytes'],
            'clips': checks, 'failures': failures}


def blended_world_matrices(glb, outgoing, incoming, amount):
    """Two-action Three.js normal blend: local position/scale lerp and quaternion SLERP."""
    parents = {child: parent for parent, node in enumerate(glb.doc['nodes']) for child in node.get('children', [])}
    local, cache = [], {}
    for index in range(len(glb.doc['nodes'])):
        poses = []
        for pose in (outgoing, incoming):
            transform = np.linalg.inv(pose[parents[index]]) @ pose[index] if index in parents else pose[index]
            poses.append(Matrix(transform.tolist()).decompose())
        a, b = poses
        local.append(np.array(Matrix.LocRotScale(a[0].lerp(b[0], amount), a[1].slerp(b[1], amount),
                                                a[2].lerp(b[2], amount))))

    def world(index):
        if index not in cache:
            cache[index] = world(parents[index]) @ local[index] if index in parents else local[index]
        return cache[index]

    return np.array([world(index) for index in range(len(local))])


def verify_blends(kind, record, desk):
    from rig_office_characters import TRANSITION_SECONDS, exit_offset
    glb = Glb(record)
    geometry = prepared_geometry(glb)
    skin = glb.doc['skins'][0]
    inverse = glb.accessor(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    animations = {animation['name']: animation for animation in glb.doc['animations']}
    triangles, offset = [], 0
    for part in geometry:
        triangles.append(part['indices'] + offset)
        offset += len(part['positions'])
    triangles = np.concatenate(triangles)
    checks, failures = {}, []
    pairs = [('headband_off', 'seated_idle'), ('headband_off', 'stand_up'),
             ('sit_down', 'headband_on'), ('headband_on', 'seated_work_hard')]
    for source, target in pairs:
        name = source+' → '+target
        outgoing = sampled_world_matrices(glb, animations[source], record['clips'][source])
        samples = []
        for amount in (0, .25, .5, .75, 1):
            seconds = .18*amount
            incoming = sampled_world_matrices(glb, animations[target], seconds)
            world = blended_world_matrices(glb, outgoing, incoming, amount)
            transforms = world[skin['joints']] @ inverse
            pieces = []
            for part in geometry:
                transformed = np.einsum('nvij,nj->nvi', transforms[part['joints']], part['homogeneous'])
                pieces.append((transformed*part['weights'][:, :, None]).sum(axis=1)[:, :3])
            points = np.concatenate(pieces)
            if target == 'stand_up':
                points += np.array(exit_offset(seconds/TRANSITION_SECONDS))
            tree = BVHTree.FromPolygons(points.tolist(), triangles.tolist(), all_triangles=True)
            hits = desk.overlap(tree)
            sample = {'amount': amount, 'incoming_seconds': seconds, 'desktop_triangle_pairs': len(hits)}
            if hits:
                sample.update(collision_details(desk, points, triangles, hits))
            samples.append(sample)
        checks[name] = samples
        if any(sample['desktop_triangle_pairs'] for sample in samples):
            failures.append(f'{kind}/{name}: crossfade intersects desktop')
    return {'blend_seconds': .18, 'clips': checks, 'failures': failures}


if __name__ == '__main__':
    conversion = json.loads((ROOT / 'assets/headband/conversion.json').read_text())
    result = {
        'method': 'Independent current authored joint targets; exported GLB checks pending.',
        'rig_script_sha256': hashlib.sha256((ROOT/'scripts/rig_office_characters.py').read_bytes()).hexdigest(),
        'target_checks': target_analysis(conversion['fits']),
    }
    if '--targets-only' not in sys.argv:
        animations = json.loads((ROOT / 'assets/animation/conversion.json').read_text())
        desk, chair = furniture_geometry('WOOD_TOP'), furniture_geometry('CHAIR')
        accessory = accessory_geometry(conversion)
        result['method'] = 'Independent authored targets and exported GLB skin/joint samples; Blender triangle BVH checks character against supplied desktop and visible accessory against desktop/chair. Coordinates are relative to seated actor ground pivot. Penetration depth samples inside vertices using ray parity and nearest surface distance.'
        result['grip_definition'] = '72% of the 0.17 m hand bone; grip coordinates are scaled asset-relative offsets from headband_anchor.'
        result['visibility'] = 'Right hand carries at progress 0.12–0.80; left grip established by 0.34; release begins 0.80.'
        result['accessory'] = {key: conversion[key] for key in ('file', 'sha256', 'bytes')}
        result['export_checks'] = {kind: verify_export(kind, animations[kind], conversion['fits'][kind], desk, chair, accessory)
                                   for kind in ('worker', 'manager')}
        result['blend_checks'] = {kind: verify_blends(kind, animations[kind], desk) for kind in ('worker', 'manager')}
    REPORT.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result, indent=2))
    if 'export_checks' in result:
        failures = [failure for check in result['export_checks'].values() for failure in check['failures']]
        failures += [failure for check in result['blend_checks'].values() for failure in check['failures']]
        assert not failures, '; '.join(failures)
