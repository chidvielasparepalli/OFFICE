"""Bind the exact inspected meshes and author proportion-specific office clips in Blender."""
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'assets/working/animation'
REPORT = ROOT / 'assets/animation'
WORK.mkdir(parents=True, exist_ok=True)
REPORT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'scripts'))
from inspect_desk_manager import render

FPS = 30
SCOOT_SECONDS = .6
RISE_SECONDS = 2.0
TRANSITION_SECONDS = SCOOT_SECONDS + RISE_SECONDS
CHAIR_ROLLBACK = .4
HEADBAND_SECONDS = 3.6
RISE_EXIT = Vector((.65, 0, -.22))
EXIT = RISE_EXIT + Vector((0, 0, -CHAIR_ROLLBACK))
CONFIGS = {
    'worker': dict(source='assets/working/workers/standard-worker.blend', name='standard-worker-animated',
        hip=(.051, .753175, -.063114), knee=(.0825, .409502, -.030817), ankle=(.083, .06241, -.03386),
        shoulder=(.11027, 1.316561, -.051971), elbow=(.432567, 1.316988, -.065726), wrist=(.669, 1.317, -.016),
        head_y=1.40, top=1.75, seated_hip=.465, seated_foot_z=.29, hand_length=.17),
    'manager': dict(source='assets/working/desk-manager/primary-manager.blend', name='primary-manager-animated',
        hip=(.09, .94, -.031), knee=(.110, .50, -.043), ankle=(.135, .10, -.070),
        shoulder=(.20, 1.44, -.079), elbow=(.43, 1.419, -.056), wrist=(.685, 1.420, -.006),
        head_y=1.56, top=1.8, seated_hip=.51, seated_foot_z=.43, hand_length=.17),
}


def blender(point):
    return Vector((point[0], -point[2], point[1]))


def runtime(point):
    return Vector((point.x, point.z, -point.y))


def geometry_hash(mesh):
    values = [[list(v.co) for v in mesh.vertices], [list(p.vertices) for p in mesh.polygons],
              [[list(uv.uv) for uv in layer.data] for layer in mesh.uv_layers]]
    return hashlib.sha256(json.dumps(values).encode()).hexdigest()


def chain_joint(start, end, a, b, pole):
    delta = end-start
    distance = delta.length
    if distance >= a+b-.0001:
        end = start + delta.normalized()*(a+b-.0001)
        delta = end-start
        distance = delta.length
    assert distance > abs(a-b)+.00001, 'IK target folded beyond physical reach'
    axis = delta.normalized()
    side = pole-axis*pole.dot(axis)
    side.normalize()
    along = (a*a-b*b+distance*distance)/(2*distance)
    joint = start + axis*along + side*math.sqrt(max(0, a*a-along*along))
    return joint, end


def skeleton(config):
    h, sy = config['hip'][1], config['shoulder'][1]
    hz = config['hip'][2]
    bones = {
        'root': ((0, 0, 0), (0, .1, 0), None),
        'hips': ((0, h, hz), (0, h+.10, hz), 'root'),
        'spine': ((0, h+.10, hz), (0, sy-.14, -.05), 'hips'),
        'chest': ((0, sy-.14, -.05), (0, sy+.045, -.045), 'spine'),
        'neck': ((0, sy+.045, -.045), (0, config['head_y'], -.025), 'chest'),
        'head': ((0, config['head_y'], -.025), (0, config['top']-.04, -.025), 'neck'),
    }
    band = Vector(bones['head'][0]) + Vector(config['headband']['headOffset'])
    bones['headband_anchor'] = (band, band + Vector((0, .1, 0)), 'head')
    for suffix, sign in [('L', 1), ('R', -1)]:
        points = {name: Vector((sign*p[0], p[1], p[2])) for name, p in config.items()
                  if name in ('hip', 'knee', 'ankle', 'shoulder', 'elbow', 'wrist')}
        def add(name, start, end, parent):
            bones[name+'.'+suffix] = (start, end, parent)
        add('thigh', points['hip'], points['knee'], 'hips')
        add('shin', points['knee'], points['ankle'], 'thigh.'+suffix)
        add('foot', points['ankle'], points['ankle']+Vector((0, 0, .16)), 'shin.'+suffix)
        add('clavicle', (0, sy, -.05), points['shoulder'], 'chest')
        add('upper_arm', points['shoulder'], points['elbow'], 'clavicle.'+suffix)
        add('forearm', points['elbow'], points['wrist'], 'upper_arm.'+suffix)
        add('hand', points['wrist'], points['wrist']+Vector((sign*config['hand_length'], 0, 0)), 'forearm.'+suffix)
    return {name: (Vector(a), Vector(b), parent) for name, (a,b,parent) in bones.items()}


def components(mesh):
    parent = list(range(len(mesh.vertices)))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    def join(a,b):
        parent[find(a)] = find(b)
    positions = {}
    for v in mesh.vertices:
        key = tuple(round(x, 6) for x in v.co)
        if key in positions:
            join(v.index, positions[key])
        positions[key] = v.index
    for edge in mesh.edges:
        join(*edge.vertices)
    groups = {}
    for v in mesh.vertices:
        groups.setdefault(find(v.index), []).append(v.index)
    return list(groups.values())


def distance_to_bone(point, bone):
    a,b,_ = bone
    t = max(0, min(1, (point-a).dot(b-a)/(b-a).length_squared))
    return (point-a-(b-a)*t).length


def bind(objects, armature, bones, kind):
    for obj in objects:
        groups = {name: obj.vertex_groups.new(name=name) for name in bones if name not in ('root', 'headband_anchor')}
        if kind == 'worker':
            for indices in components(obj.data):
                points = [runtime(obj.data.vertices[i].co) for i in indices]
                low = Vector([min(p[i] for p in points) for i in range(3)])
                high = Vector([max(p[i] for p in points) for i in range(3)])
                center = (low+high)/2
                side = '.L' if center.x >= 0 else '.R'
                if low.y > 1.38:
                    bone = 'head'
                elif abs(center.x) < .045 and low.y > 1.29:
                    bone = 'neck'
                elif center.y > 1.25 and abs(center.x) > .07:
                    bone = ('hand' if abs(center.x) > .65 else 'forearm' if abs(center.x) >= .43 else 'upper_arm')+side
                elif high.y-low.y > .35 and abs(center.x) < .04:
                    bone = 'spine'
                elif center.y < .14:
                    bone = 'foot'+side
                elif center.y <= .42:
                    bone = 'shin'+side
                elif center.y < .80:
                    bone = 'thigh'+side
                else:
                    bone = 'hips'
                groups[bone].add(indices, 1, 'REPLACE')
        else:
            for v in obj.data.vertices:
                p = runtime(v.co)
                side = '.L' if p.x >= 0 else '.R'
                if obj.name == 'HANDS':
                    candidates = ['hand'+side]
                elif obj.name != 'SUIT_SHOES':
                    candidates = ['head', 'neck'] if obj.name == 'HEAD' and p.y < 1.60 else ['head']
                elif p.y < .12:
                    candidates = ['foot'+side]
                elif p.y < .25:
                    candidates = ['foot'+side, 'shin'+side]
                elif p.y < .89:
                    candidates = ['thigh'+side, 'shin'+side, 'hips'] if p.y > .80 else ['thigh'+side, 'shin'+side]
                elif abs(p.x) > .19 and p.y > 1.25:
                    candidates = ['clavicle'+side, 'upper_arm'+side, 'forearm'+side, 'hand'+side]
                else:
                    candidates = ['hips', 'spine', 'chest', 'neck']
                # Compact influence radius avoids a bent knee dragging distant cloth.
                ranked = sorted([(distance_to_bone(p, bones[n]), n) for n in candidates])[:3]
                closest = ranked[0][0]
                weights = [(math.exp(-((distance-closest)/.055)**2), n) for distance,n in ranked]
                total = sum(w for w,n in weights)
                for weight, name in weights:
                    if weight/total > .001:
                        groups[name].add([v.index], weight/total, 'REPLACE')
        for v in obj.data.vertices:
            total = sum(g.weight for g in v.groups)
            assert .998 < total < 1.002 and len(v.groups) <= 3
        obj.parent = armature
        mod = obj.modifiers.new('Office skeletal deformation', 'ARMATURE')
        mod.object = armature


def smooth(t):
    t = max(0, min(1, t))
    return t*t*(3-2*t)


def rise_offset(progress):
    return Vector((RISE_EXIT.x*smooth((progress-.42)/.40), 0,
                   .22*smooth(progress/.40)-.44*smooth((progress-.80)/.20)))


def chair_offset(progress):
    return Vector((0, 0, -CHAIR_ROLLBACK*smooth(progress*TRANSITION_SECONDS/SCOOT_SECONDS)))


def exit_offset(progress):
    rise = max(0, min(1, (progress*TRANSITION_SECONDS-SCOOT_SECONDS)/RISE_SECONDS))
    return chair_offset(progress) + rise_offset(rise)


def pose(config, bones, clip, seconds):
    # Blend joint targets, then solve limbs at their original lengths.
    accessory = clip in ('headband_on', 'headband_off')
    seated = clip.startswith('seated') or clip in ('stand_up', 'sit_down') or accessory
    transition = seconds/TRANSITION_SECONDS if clip == 'stand_up' else 1-seconds/TRANSITION_SECONDS if clip == 'sit_down' else 0 if seated else 1
    transition = max(0, min(1, transition))
    scoot = max(0, min(1, transition*TRANSITION_SECONDS/SCOOT_SECONDS))
    progress = max(0, min(1, (transition*TRANSITION_SECONDS-SCOOT_SECONDS)/RISE_SECONDS)) if clip in ('stand_up','sit_down') else transition
    sit = 1-progress
    theta = seconds*2*math.pi
    hard = clip == 'seated_work_hard'
    work = clip == 'seated_work' or hard
    walking = clip == 'walk'
    hip_rest = bones['hips'][0]
    hip = hip_rest.lerp(Vector((0, config['seated_hip'], 0)), sit)
    lean = sit*(.07 if clip != 'seated_sleep' else .16) + (.035 if walking else 0)
    if walking:
        hip.y -= .045-.003*math.cos(theta*2)
    if work:
        lean += (.012 if hard else .008 if config is CONFIGS['worker'] else .004)*math.sin(theta/2)
    feet = {}
    for suffix, sign in [('L',1),('R',-1)]:
        ankle = bones['foot.'+suffix][0].copy()
        seated_ankle = Vector((sign*config['ankle'][0], config['ankle'][1], config['seated_foot_z']))
        if clip in ('stand_up','sit_down'):
            if scoot < 1:
                a,b = (0,.5) if sign > 0 else (.5,1)
                step = smooth((scoot-a)/(b-a))
                ankle = seated_ankle.copy()
                ankle.z += CHAIR_ROLLBACK*(smooth(scoot)-step)
                ankle.y += .02*math.sin(math.pi*step)
            else:
                a,b = (.32,.76) if sign > 0 else (.56,1)
                step = smooth((progress-a)/(b-a))
                target = ankle+RISE_EXIT
                ankle = seated_ankle.lerp(target, step)
                # Keep the stepping knee forward until the foot is beyond the chair arm.
                ankle.z = seated_ankle.z+(target.z-seated_ankle.z)*smooth((step-.65)/.35)
                ankle -= rise_offset(progress)
                # Trail leg clears the chair arm while the front foot stays near the floor.
                ankle.y += (.016 if sign > 0 else .065)*math.sin(math.pi*step)
                if sign < 0 and config is CONFIGS['worker']:
                    ankle.z += .085*math.sin(math.pi*smooth((progress-.56)/.18))
        elif seated:
            ankle = seated_ankle
        if walking:
            phase = (seconds+(0 if sign > 0 else .5)) % 1
            if phase < .5:
                ankle.z += .19-.76*phase
            else:
                swing = (phase-.5)*2
                ankle.z += -.19+.38*smooth(swing)
                ankle.y += .07*math.sin(math.pi*swing)
        feet[suffix] = ankle
    # During the side-step, lower hips slightly if required to keep planted feet reachable.
    for suffix, sign in [('L',1),('R',-1)]:
        rest_hip = bones['thigh.'+suffix][0]
        phip = hip+(rest_hip-hip_rest)
        ankle = feet[suffix]
        length = (bones['thigh.'+suffix][1]-rest_hip).length+(bones['shin.'+suffix][1]-bones['shin.'+suffix][0]).length-.0002
        horizontal = (phip.x-ankle.x)**2+(phip.z-ankle.z)**2
        hip.y = min(hip.y, ankle.y+math.sqrt(max(.001, length*length-horizontal)))
    rotation = Matrix.Rotation(lean, 3, 'X')
    result = {'root': (bones['root'][0], bones['root'][1])}
    for name in ('hips','spine','chest','neck','head'):
        a,b,_ = bones[name]
        result[name] = (hip+rotation@(a-hip_rest), hip+rotation@(b-hip_rest))
    if work or clip == 'seated_sleep':
        a,b = result['head']
        angle = (.014*math.sin(theta/2) if work else .22)
        result['head'] = (a, a+Matrix.Rotation(angle,3,'X')@(b-a))
    head_a, head_b = result['head']
    head_rotation = (bones['head'][1]-bones['head'][0]).rotation_difference(head_b-head_a).to_matrix()
    band_head = head_a + head_rotation @ Vector(config['headband']['headOffset'])
    band = band_head.copy()
    band_rotation = head_rotation
    equip = max(0, min(1, seconds/HEADBAND_SECONDS if clip == 'headband_on' else 1-seconds/HEADBAND_SECONDS)) if accessory else 1
    if accessory:
        # Lift the opening above the crown before lowering it; no accessory reparenting/pop.
        pocket = Vector((-.12, config['seated_hip']+.22, .035))
        lifted = Vector((-.12, .96, .035))
        front = Vector((0, band_head.y+.10, band_head.z+.28))
        above = band_head + Vector((0, .23 if config is CONFIGS['worker'] else .18, 0))
        if equip < .30:
            band = pocket.lerp(lifted, smooth((equip-.18)/.12))
        elif equip < .46:
            band = lifted.lerp(front, smooth((equip-.30)/.16))
        elif equip < .64:
            band = front.lerp(above, smooth((equip-.46)/.18))
        else:
            band = above.lerp(band_head, smooth((equip-.64)/.16))
    result['headband_anchor'] = (band, band+band_rotation @ Vector((0, .1, 0)))
    for suffix,sign in [('L',1),('R',-1)]:
        def length(name):
            a,b,_ = bones[name+'.'+suffix]
            return (b-a).length
        thigh, shin = 'thigh.'+suffix, 'shin.'+suffix
        start = hip+(bones[thigh][0]-hip_rest)
        knee, ankle = chain_joint(start, feet[suffix], length('thigh'), length('shin'), Vector((0,0,1)))
        result[thigh], result[shin] = (start,knee), (knee,ankle)
        result['foot.'+suffix] = (ankle, ankle+Vector((0,0,.16)))
        a,b,_ = bones['clavicle.'+suffix]
        clavicle = (hip+rotation@(a-hip_rest), hip+rotation@(b-hip_rest))
        result['clavicle.'+suffix] = clavicle
        shoulder = clavicle[1]
        standing_wrist = Vector((sign*(.20 if config is CONFIGS['worker'] else .24),
                                 config['shoulder'][1]-(.51 if config is CONFIGS['worker'] else .475), .015))
        # Wrist sits before the keyboard; authored fingers point forward into its key area.
        seated_wrist = Vector((sign*.105, .820, .45))
        if clip in ('seated_idle','seated_sleep','stand_up','sit_down'):
            seated_wrist = Vector((sign*.15, .72, .045))
        if work:
            frequency = 3.5 if hard else 2
            tap = math.sin(theta*frequency+(0 if sign > 0 else math.pi))
            seated_wrist.y += (.015 if hard else .008)*tap
            seated_wrist.z += (.008 if hard else .004)*math.cos(theta*frequency)
        wrist = standing_wrist.lerp(seated_wrist, sit)
        if walking:
            wrist.z += .13*math.sin(theta+(math.pi if sign>0 else 0))
        pole = Vector((sign*.7,-.5,-.25))
        elbow,wrist = chain_joint(shoulder, wrist, length('upper_arm'), length('forearm'), pole)
        result['upper_arm.'+suffix],result['forearm.'+suffix] = (shoulder,elbow),(elbow,wrist)
        hand_sit = sit
        if clip in ('stand_up','sit_down'):
            # Posture clips meet the same resting hands used after stowing the band.
            wrist.z = .045*(1-smooth(progress/.40)) + .015*smooth(progress/.40)
            elbow,wrist = chain_joint(shoulder, wrist, length('upper_arm'), length('forearm'), pole)
            result['upper_arm.'+suffix],result['forearm.'+suffix] = (shoulder,elbow),(elbow,wrist)
            hand_sit = 1-smooth((progress-.42)/.4)
        hand_direction = Vector((0,-1,0)).lerp(Vector((0,-.025,1)), hand_sit).normalized()
        if accessory:
            rest_wrist = Vector((sign*.15, .72, .045))
            grip = band + band_rotation @ Vector(config['headband']['grips'][1 if sign > 0 else 0])
            grip_direction = Vector((-sign, .15, .12)).normalized()
            reach_wrist = grip - grip_direction*config['hand_length']*.72
            reach = smooth(equip/(.12 if sign < 0 else .34))
            release = smooth((equip-.80)/.20)
            wrist = rest_wrist.lerp(reach_wrist, reach).lerp(seated_wrist, release)
            hand_direction = hand_direction.lerp(grip_direction, reach*(1-release)).normalized()
            # Keep the elbow pole behind the body to avoid a flip while the wrist rises past the shoulder.
            elbow,wrist = chain_joint(shoulder, wrist, length('upper_arm'), length('forearm'), pole)
            result['upper_arm.'+suffix],result['forearm.'+suffix] = (shoulder,elbow),(elbow,wrist)
        result['hand.'+suffix] = (wrist,wrist+hand_direction*config['hand_length'])
    return result


def apply_pose(rig, targets):
    world = {}
    for name,bone in rig.data.bones.items():
        a,b = targets[name]
        a,b = blender(a),blender(b)
        rotation = (bone.tail_local-bone.head_local).rotation_difference(b-a)
        desired = Matrix.Translation(a) @ rotation.to_matrix().to_4x4() @ bone.matrix_local.to_3x3().to_4x4()
        rest_local = bone.parent.matrix_local.inverted() @ bone.matrix_local if bone.parent else bone.matrix_local
        local = world[bone.parent.name].inverted() @ desired if bone.parent else desired
        rig.pose.bones[name].matrix_basis = rest_local.inverted() @ local
        world[name] = desired


def build(kind, config):
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/config['source']))
    bpy.context.preferences.filepaths.save_version = 0
    config['headband'] = json.loads((ROOT/'assets/headband/conversion.json').read_text())['fits'][kind]
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    baseline = {o.name: dict(hash=geometry_hash(o.data), vertices=len(o.data.vertices), materials=[m.name for m in o.data.materials]) for o in objects}
    assert not any(o.type == 'ARMATURE' for o in bpy.context.scene.objects)
    assert not bpy.data.actions and all(not o.vertex_groups for o in objects)
    for o in list(bpy.context.scene.objects):
        if o not in objects:
            bpy.data.objects.remove(o, do_unlink=True)
    armature = bpy.data.armatures.new('OfficeRig')
    rig = bpy.data.objects.new('OfficeRig', armature)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bones = skeleton(config)
    for name,(a,b,parent) in bones.items():
        bone = armature.edit_bones.new(name)
        bone.head, bone.tail = blender(a),blender(b)
        if parent:
            bone.parent = armature.edit_bones[parent]
        bone.use_deform = name not in ('root', 'headband_anchor')
    bpy.ops.object.mode_set(mode='OBJECT')
    bind(objects,rig,bones,kind)
    clips = {'stand_idle':1, 'seated_idle':1, 'seated_sleep':1, 'seated_work':4,
             'seated_work_hard':4, 'headband_on':HEADBAND_SECONDS, 'headband_off':HEADBAND_SECONDS,
             'walk':1, 'stand_up':TRANSITION_SECONDS, 'sit_down':TRANSITION_SECONDS}
    bpy.context.scene.render.fps = FPS
    rig.animation_data_create()
    for name,duration in clips.items():
        action = bpy.data.actions.new(name)
        rig.animation_data.action = action
        count = round(duration*FPS)
        frames = [0,count] if name in ('stand_idle','seated_idle','seated_sleep') else range(count+1)
        for frame in frames:
            apply_pose(rig,pose(config,bones,name,frame/FPS))
            for bone in rig.pose.bones:
                bone.rotation_mode = 'QUATERNION'
                bone.keyframe_insert(data_path='location', frame=frame)
                bone.keyframe_insert(data_path='rotation_quaternion', frame=frame)
        track = rig.animation_data.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, action)
        strip.action_frame_start,strip.action_frame_end = 0,count
        track.mute = True
    rig.animation_data.action = None
    for obj in objects:
        assert geometry_hash(obj.data) == baseline[obj.name]['hash'], 'Source mesh appearance/topology changed'
    apply_pose(rig,pose(config,bones,'stand_idle',0))
    bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK/(config['name']+'.blend')),compress=True)
    path = WORK/(config['name']+'.glb')
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', export_yup=True,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_frame_range=False, export_def_bones=False, export_cameras=False, export_lights=False,
        export_skins=True, export_all_influences=False)
    raw = path.read_bytes()
    gltf = json.loads(raw[20:20+int.from_bytes(raw[12:16],'little')])
    assert set(a['name'] for a in gltf['animations']) == set(clips), [a['name'] for a in gltf.get('animations',[])]
    assert len(gltf['skins']) == 1
    record = dict(file=path.relative_to(ROOT).as_posix(), bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
        source=config['source'], meshes=baseline, bones=list(bones), clips=clips, rigged=True,
        skeletal_skin_count=len(gltf['skins']), seated_pelvis_height=config['seated_hip'],
        source_geometry_unchanged=True, skinning='rigid connected components' if kind=='worker' else 'anatomical region/capsule weights; up to three influences',
        headband=dict(anchor='headband_anchor', fit=config['headband'], duration=HEADBAND_SECONDS,
            visible_from_progress=.12, process='waist pickup; lift above crown; lower to forehead; release to keyboard; exact reverse removal'),
        workstation_motion=dict(seated_anchor=[0,0,-.73], transition_seconds=TRANSITION_SECONDS,
            scoot_seconds=SCOOT_SECONDS, rise_seconds=RISE_SECONDS, chair_rollback_meters=CHAIR_ROLLBACK,
            standing_offset_from_seat=list(EXIT), standing_anchor=[EXIT.x,0,EXIT.z-.73],
            curve='r=clamp(2.6*p/.6);q=clamp((2.6*p-.6)/2);S(t)=clamped smoothstep;chairZ=-.4*S(r);root=[.65*S((q-.42)/.4),0,chairZ+.22*S(q/.4)-.44*S((q-.8)/.2)];sit_down reverses p',
            calibration='Chair and seated occupant roll back together before rising; foot steps preserve ground contact; only CHAIR geometry translates'))
    if '--skip-renders' in sys.argv:
        return record
    # Posed validation copies include the existing desk; those props are not in character GLBs.
    with bpy.data.libraries.load(str(ROOT/'assets/working/desk-manager/standard-workstation.blend')) as (source,target):
        target.objects = [n for n in source.objects if not n.endswith('ROOT')]
    for obj in target.objects:
        if obj and obj.type == 'MESH':
            bpy.context.scene.collection.objects.link(obj)
            obj.parent = None
            obj.location.y -= .73
    all_meshes = [o for o in bpy.context.scene.objects if o.type=='MESH']
    for name,time in [('seated_work',.375),('stand_idle',0),('stand_up',TRANSITION_SECONDS*.6),('walk',.25)]:
        rig.animation_data.action = None
        apply_pose(rig,pose(config,bones,name,time))
        rig.location = blender(exit_offset(time/TRANSITION_SECONDS) if name=='stand_up' else EXIT if name in ('stand_idle','walk') else Vector((0,0,0)))
        chair = next(o for o in all_meshes if o.name=='CHAIR')
        chair.location.y = -.73 - (chair_offset(time/TRANSITION_SECONDS).z if name=='stand_up' else -CHAIR_ROLLBACK if name in ('stand_idle','walk') else 0)
        bpy.context.view_layer.update()
        render(all_meshes, WORK/f'{kind}-{name}.png', (2,-3,1.5),size=800)
    return record


if __name__ == '__main__':
    result = {kind:build(kind,config) for kind,config in CONFIGS.items()}
    (REPORT/'conversion.json').write_text(json.dumps(result,indent=2)+'\n')
