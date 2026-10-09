import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  BoxGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  NumberKeyframeTrack,
  Raycaster,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
} from 'three'
import { CharacterAnimationPlayer } from './characterAnimation'

const players: CharacterAnimationPlayer[] = []
afterEach(() => {
  players.splice(0).forEach((player) => player.stop())
})

function fixture() {
  const scene = new Group()
  const hips = new Bone()
  hips.name = 'hips'
  const head = new Bone()
  head.name = 'head'
  head.position.y = 1
  hips.add(head)
  const attachment = new Bone()
  attachment.name = 'headband_anchor'
  head.add(attachment)
  const geometry = new BoxGeometry(0.2, 0.2, 0.2)
  const count = geometry.attributes.position.count
  geometry.setAttribute(
    'skinIndex',
    new Uint16BufferAttribute(
      Array.from({ length: count }, () => [1, 0, 0, 0]).flat(),
      4,
    ),
  )
  geometry.setAttribute(
    'skinWeight',
    new Float32BufferAttribute(
      Array.from({ length: count }, () => [1, 0, 0, 0]).flat(),
      4,
    ),
  )
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial())
  mesh.name = 'body'
  scene.add(hips, mesh)
  mesh.bind(new Skeleton([hips, head]))
  const clips = [
    new AnimationClip('seated_work', 1, [
      new NumberKeyframeTrack('head.position[x]', [0, 1], [0, 1]),
    ]),
    new AnimationClip('seated_sleep', 1, [
      new NumberKeyframeTrack('head.position[x]', [0, 1], [2, 2]),
    ]),
    new AnimationClip('stand_idle', 1, [
      new NumberKeyframeTrack('head.position[x]', [0, 1], [0, 0]),
    ]),
    new AnimationClip('stand_up', 1, [
      new NumberKeyframeTrack('head.position[x]', [0, 1], [0, 3]),
    ]),
    new AnimationClip('headband_on', 1, [
      new NumberKeyframeTrack(
        'headband_anchor.position[y]',
        [0, 1],
        [-0.5, 0.2],
      ),
    ]),
  ]
  const create = () => {
    const player = new CharacterAnimationPlayer(scene, clips)
    players.push(player)
    player.start()
    return player
  }
  return { scene, mesh, head, clips, create }
}

describe('shared character animation playback', () => {
  it('attaches cached accessory resources to each independent rig and clamps pickup endpoints', () => {
    const { scene, clips } = fixture()
    const accessory = new Group()
    const band = new Mesh(
      new BoxGeometry(0.2, 0.04, 0.2),
      new MeshBasicMaterial(),
    )
    accessory.add(band)
    const create = () => {
      const player = new CharacterAnimationPlayer(scene, clips, {
        scene: accessory,
        scale: [1.8, 0.62, 1.4],
      })
      players.push(player)
      player.start()
      return player
    }
    const first = create()
    const second = create()
    expect(first.headband?.parent?.name).toBe('headband_anchor')
    expect(first.headband?.parent).not.toBe(second.headband?.parent)
    expect((first.headband!.children[0] as Mesh).geometry).toBe(band.geometry)
    expect((second.headband!.children[0] as Mesh).material).toBe(band.material)
    first.headband!.visible = true
    expect(second.headband?.visible).toBe(false)
    first.model.updateMatrixWorld(true)
    second.model.updateMatrixWorld(true)
    const ray = new Raycaster(new Vector3(0, 1, 2), new Vector3(0, 0, -1))
    expect(ray.intersectObject(first.headband!, true).length).toBeGreaterThan(0)
    expect(ray.intersectObject(second.headband!, true)).toHaveLength(0)
    first.update('headband_on', 2, 0, false, true, true)
    expect(first.headband?.parent?.position.y).toBeCloseTo(0.2)
    expect(accessory.parent).toBeNull()
  })

  it('shares geometry, materials and clip data while skeleton poses remain independent', () => {
    const { mesh, head, clips, create } = fixture()
    const actions = vi.spyOn(AnimationMixer.prototype, 'clipAction')
    const first = create()
    const second = create()
    const a = first.model.getObjectByName('body') as SkinnedMesh
    const b = second.model.getObjectByName('body') as SkinnedMesh
    expect(a.geometry).toBe(mesh.geometry)
    expect(b.geometry).toBe(mesh.geometry)
    expect(a.material).toBe(mesh.material)
    expect(b.material).toBe(mesh.material)
    expect(a.skeleton).not.toBe(b.skeleton)
    expect(a.skeleton.bones[1]).not.toBe(b.skeleton.bones[1])
    expect(first.head).not.toBe(head)
    for (const call of actions.mock.calls) expect(clips).toContain(call[0])
    first.update('seated_work', 0.25, 0, false, true, true)
    second.update('seated_work', 0.75, 0, false, true, true)
    expect(first.head.position.x).toBeCloseTo(0.25)
    expect(second.head.position.x).toBeCloseTo(0.75)
    expect(head.position.x).toBe(0)
  })

  it('replays the StrictMode start/update/stop lifecycle without invalidating mixer bindings or cached resources', () => {
    const { mesh, create } = fixture()
    const player = create()
    const clone = player.model.getObjectByName('body') as SkinnedMesh
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(
      mesh.material as MeshBasicMaterial,
      'dispose',
    )
    for (let replay = 0; replay < 3; replay++) {
      player.start()
      expect(() =>
        player.update('seated_work', 0.35, 0, false, true, false),
      ).not.toThrow()
      expect(player.head.position.x).toBeCloseTo(0.35)
      clone.skeleton.computeBoneTexture()
      const textureDispose = vi.spyOn(clone.skeleton.boneTexture!, 'dispose')
      player.stop()
      expect(textureDispose).toHaveBeenCalledOnce()
      expect(clone.skeleton.boneTexture).toBeNull()
    }
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(materialDispose).not.toHaveBeenCalled()
  })

  it('applies the final idle pose before ending a throttled demand-loop blend', () => {
    const { create } = fixture()
    const player = create()
    player.update('seated_work', 0.25, 0, false, true, false)
    expect(player.update('seated_sleep', 0, 0, false, false, false)).toBe(true)
    let pending = true
    let frames = 0
    while (pending && frames++ < 30) {
      pending = player.update('seated_sleep', 0, 1 / 60, false, false, false)
    }
    expect(pending).toBe(false)
    expect(player.head.position.x).toBeCloseTo(2)
    const samples = vi.spyOn(AnimationMixer.prototype, 'update')
    for (let frame = 0; frame < 30; frame++)
      expect(
        player.update('seated_sleep', 0, 1 / 60, false, false, false),
      ).toBe(false)
    expect(samples).not.toHaveBeenCalled()
  })

  it('retains outgoing clip time when effects replay during a blend', () => {
    const { create } = fixture()
    const player = create()
    player.update('seated_work', 0.5, 0, false, true, true)
    player.update('seated_sleep', 0, 0.09, false, false, true)
    const before = player.head.position.x
    player.stop()
    player.start()
    player.update('seated_sleep', 0, 0, false, false, true)
    expect(player.head.position.x).toBeCloseTo(before)
  })

  it('settles a cleanup clip change before freezing a blocked character', () => {
    const { create } = fixture()
    const player = create()
    player.update('seated_work', 0.5, 0, false, true, true)
    expect(player.update('stand_idle', 0, 0, true, false, false)).toBe(false)
    expect(player.head.position.x).toBe(0)
    player.update('stand_idle', 0.5, 1, true, false, false)
    expect(player.head.position.x).toBe(0)
  })

  it('freezes blocked poses, resumes supplied time, loops work clips and clamps posture endpoints', () => {
    const { create } = fixture()
    const player = create()
    player.update('seated_work', 3.25, 0, false, true, true)
    expect(player.head.position.x).toBeCloseTo(0.25)
    player.update('seated_work', 0.9, 10, true, false, true)
    expect(player.head.position.x).toBeCloseTo(0.25)
    player.update('seated_work', 0.5, 1 / 60, false, true, true)
    expect(player.head.position.x).toBeCloseTo(0.5)
    player.update('stand_up', 2, 0.2, false, true, true)
    expect(player.head.position.x).toBeCloseTo(3)
    expect(() => player.update('walk', 0, 0, false, true, true)).toThrow(
      'clip missing',
    )
  })

  it('throttles unselected bone evaluation while selected characters sample every active frame', () => {
    const { create } = fixture()
    const player = create()
    player.update('seated_work', 0, 0, false, true, false)
    player.update('seated_work', 0.01, 0.01, false, true, false)
    expect(player.head.position.x).toBe(0)
    player.update('seated_work', 0.05, 0.04, false, true, false)
    expect(player.head.position.x).toBeCloseTo(0.05)
    player.update('seated_work', 0.06, 0.01, false, true, true)
    expect(player.head.position.x).toBeCloseTo(0.06)
  })

  it('skips offscreen skeleton evaluation and resumes at the current supplied clip time', () => {
    const { create } = fixture()
    const player = create()
    player.update('seated_work', 0.25, 0, false, true, false)
    const samples = vi.spyOn(AnimationMixer.prototype, 'update').mockClear()
    for (let frame = 1; frame <= 60; frame++) {
      player.update(
        'seated_work',
        0.25 + frame / 60,
        1 / 60,
        false,
        true,
        false,
        false,
        false,
      )
    }
    expect(samples).not.toHaveBeenCalled()
    expect(player.head.position.x).toBeCloseTo(0.25)
    player.update('seated_work', 1.75, 0, false, true, false, false, true)
    expect(samples).toHaveBeenCalledOnce()
    expect(player.head.position.x).toBeCloseTo(0.75)
    const mesh = player.model.getObjectByName('body') as SkinnedMesh
    expect(mesh.frustumCulled).toBe(true)
    expect(mesh.boundingSphere?.radius).toBe(2)
    samples.mockRestore()
  })

  it('finishes offscreen blend timing and samples an inactive paused pose on re-entry', () => {
    const { create } = fixture()
    const player = create()
    player.update('seated_work', 0.25, 0, false, true, false)
    const samples = vi.spyOn(AnimationMixer.prototype, 'update').mockClear()
    expect(
      player.update('seated_sleep', 0, 0, false, false, false, false, false),
    ).toBe(true)
    expect(
      player.update('seated_sleep', 0, 0.2, false, false, false, false, false),
    ).toBe(false)
    expect(samples).not.toHaveBeenCalled()
    expect(
      player.update('seated_sleep', 0, 0, true, false, false, false, true),
    ).toBe(false)
    expect(samples).toHaveBeenCalledOnce()
    expect(player.head.position.x).toBeCloseTo(2)
    samples.mockRestore()
  })

  it('keeps a selected character sampled even when outside the camera envelope', () => {
    const { create } = fixture()
    const player = create()
    player.update('seated_work', 0.25, 0, false, true, false)
    player.update('seated_work', 0.75, 0.01, false, true, true, false, false)
    expect(player.head.position.x).toBeCloseTo(0.75)
    player.update('seated_work', 0.76, 0.01, false, true, true, false, false)
    expect(player.head.position.x).toBeCloseTo(0.76)
  })

  it('settles the current clip on re-entry after multiple hidden changes instead of blending an obsolete pose', () => {
    const { create } = fixture()
    const player = create()
    player.update('seated_work', 0.25, 0, false, true, false)
    player.update('stand_up', 0.4, 0.05, false, true, false, false, false)
    player.update('stand_idle', 0, 0.01, false, false, false, false, false)
    player.update('seated_work', 0.7, 0.01, false, true, false, false, false)
    expect(player.head.position.x).toBeCloseTo(0.25)
    expect(
      player.update('seated_work', 0.7, 0, false, true, false, false, true),
    ).toBe(false)
    expect(player.head.position.x).toBeCloseTo(0.7)
    // Subsequent transitions that are visible still use the normal crossfade.
    expect(player.update('seated_sleep', 0, 0.09, false, false, false)).toBe(
      true,
    )
    expect(player.head.position.x).toBeCloseTo(1.35)
  })
})
