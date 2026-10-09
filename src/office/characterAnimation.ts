import { SkeletonUtils } from 'three-stdlib'
import { AnimationMixer, Box3, SkinnedMesh, Sphere, Vector3 } from 'three'
import type {
  AnimationAction,
  AnimationClip,
  Group,
  Object3D,
  Skeleton,
} from 'three'
import type { CharacterClip } from './characterMotion'

const BLEND_SECONDS = 0.18
const UNSELECTED_INTERVAL = 1 / 24

export class CharacterAnimationPlayer {
  readonly model: Object3D
  readonly head: Object3D
  readonly headband: Object3D | null
  private readonly mixer: AnimationMixer
  private readonly actions: Map<string, AnimationAction>
  private readonly skeletons = new Set<Skeleton>()
  private clip = ''
  private blendTime = BLEND_SECONDS
  private previousWeights = new Map<string, number>()
  private elapsed = 0
  private needsSample = true
  private offscreen = false

  constructor(
    scene: Group,
    clips: readonly AnimationClip[],
    accessory?: { scene: Group; scale: readonly number[] },
  ) {
    this.model = SkeletonUtils.clone(scene)
    const head = this.model.getObjectByName('head')
    if (!head) throw new Error('Character rig is missing its head bone')
    this.head = head
    this.headband = null
    if (accessory) {
      const attachment = this.model.getObjectByName('headband_anchor')
      if (!attachment)
        throw new Error('Character rig is missing its headband attachment')
      this.headband = accessory.scene.clone(true)
      this.headband.name = 'working-headband'
      this.headband.scale.set(
        accessory.scale[0],
        accessory.scale[1],
        accessory.scale[2],
      )
      this.headband.visible = false
      const headband = this.headband
      // Three raycasts invisible objects unless their subtree explicitly opts out.
      headband.raycast = () => (headband.visible ? undefined : false)
      attachment.add(this.headband)
    }
    this.model.traverse((object) => {
      if (object instanceof SkinnedMesh) {
        this.skeletons.add(object.skeleton)
        // Conservative pose envelope avoids per-frame CPU skinning for bounds.
        object.boundingBox = new Box3(
          new Vector3(-1, -0.2, -1),
          new Vector3(1, 2, 1.5),
        )
        object.boundingSphere = new Sphere(new Vector3(0, 0.9, 0.2), 2)
        object.frustumCulled = true
      }
    })
    this.mixer = new AnimationMixer(this.model)
    this.actions = new Map(
      clips.map((clip) => {
        const action = this.mixer.clipAction(clip)
        action.setEffectiveWeight(0)
        action.paused = true
        return [clip.name, action]
      }),
    )
  }

  start() {
    this.actions.forEach((action) => {
      action.play()
      action.paused = true
    })
    this.needsSample = true
  }

  setHeadbandVisible(visible: boolean) {
    if (this.headband) this.headband.visible = visible
  }

  stop() {
    const times = [...this.actions.values()].map(
      (action) => [action, action.time] as const,
    )
    this.mixer.stopAllAction()
    for (const [action, time] of times) action.time = time
    // Retain mixer bindings for StrictMode replay; the whole player is collected on unmount.
    this.skeletons.forEach((skeleton) => skeleton.dispose())
    this.needsSample = true
  }

  /** Samples a supplied physical state; returns whether another blend frame is needed. */
  update(
    clip: CharacterClip,
    time: number,
    delta: number,
    paused: boolean,
    active: boolean,
    highDetail: boolean,
    force = false,
    visible = true,
  ) {
    if (!this.actions.has(clip))
      throw new Error(`Character clip missing: ${clip}`)
    if (this.clip !== clip) {
      this.previousWeights = new Map(
        [...this.actions].map(([name, action]) => [
          name,
          action.getEffectiveWeight(),
        ]),
      )
      // A completed safety removal must settle before a blocked actor stops updating.
      this.blendTime = this.clip && !paused ? 0 : BLEND_SECONDS
      this.clip = clip
      force = true
    }
    const sampleVisible = visible || highDetail
    if (sampleVisible && this.offscreen) {
      // Hidden clip changes have no evaluated outgoing pose to blend from.
      this.blendTime = BLEND_SECONDS
      force = true
    }
    this.offscreen = !sampleVisible
    const previousBlendTime = this.blendTime
    if (!paused)
      this.blendTime = Math.min(BLEND_SECONDS, this.blendTime + delta)
    const finishedBlend =
      previousBlendTime < BLEND_SECONDS && this.blendTime === BLEND_SECONDS
    const blend = this.blendTime / BLEND_SECONDS
    this.elapsed += delta
    // Keep physical/clip timing current without evaluating offscreen skeletons.
    // Selection overrides culling; re-entry samples even a paused or idle pose.
    if (!sampleVisible) {
      this.needsSample = true
      return !paused && blend < 1
    }
    if (
      force ||
      this.needsSample ||
      finishedBlend ||
      (!paused &&
        (active || blend < 1) &&
        this.elapsed >= (highDetail ? 0 : UNSELECTED_INTERVAL))
    ) {
      for (const [name, action] of this.actions) {
        const previous = this.previousWeights.get(name) ?? 0
        action.setEffectiveWeight(
          previous * (1 - blend) + (name === clip ? blend : 0),
        )
        if (name === clip) {
          const duration = action.getClip().duration
          action.time =
            name === 'sit_down' ||
            name === 'stand_up' ||
            name === 'headband_on' ||
            name === 'headband_off'
              ? Math.min(time, duration)
              : time % duration
        }
      }
      this.mixer.update(0)
      this.elapsed = 0
      this.needsSample = false
    }
    return !paused && blend < 1
  }
}
