import { describe, expect, it } from 'vitest'
import type {
  AgentMotion,
  OfficeAgentStatus,
  WorldPosition,
} from './officeState'
import type { AgentPlacement } from './workerPresentation'
import {
  createCharacterMotion,
  HEADBAND_TRANSITION_SECONDS,
  POSTURE_TRANSITION_SECONDS,
  seatedWorkstationAnchor,
  standingWorkstationAnchor,
} from './characterMotion'

const desk = { position: [0, 0, 0] as WorldPosition, headingRadians: 0 }
const standing = standingWorkstationAnchor(desk)
const seated = seatedWorkstationAnchor(desk)
const destination: WorldPosition = [standing[0] - 2, 0, standing[2]]
const worker: AgentPlacement = {
  id: 'worker-1',
  kind: 'standard-worker',
  label: 'Worker asset test',
  position: seated,
  headingRadians: 0,
  workstation: desk,
  status: 'working',
}
const manager: AgentPlacement = {
  ...worker,
  id: 'manager-1',
  kind: 'manager',
  label: 'Manager asset test',
}
const outbound: AgentMotion = {
  id: 'outbound-1',
  points: [standing, destination],
  speedMetersPerSecond: 1,
}
const returning: AgentMotion = {
  id: 'return-1',
  points: [destination, standing],
  speedMetersPerSecond: 1,
}
const quarterTurnSeconds = 0.25

describe('deterministic character motion', () => {
  it('stops a previously accepted command when a changed layout rejects the same ID', () => {
    const controller = createCharacterMotion(worker)
    controller.update({ ...worker, status: 'walking', motion: outbound })
    const position = [
      ...controller.advance(POSTURE_TRANSITION_SECONDS + 0.5).position,
    ]
    controller.update({
      ...worker,
      status: 'walking',
      motion: { ...outbound, points: [] },
      navigationDiagnostic: 'Furniture now blocks this route.',
    })
    const stopped = controller.advance(10)
    expect(stopped.position).toEqual(position)
    expect(stopped.completedMotionId).toBeNull()
    expect(stopped.pathProgress).toBeNull()
    expect(stopped.diagnostic).toBe('Furniture now blocks this route.')
    controller.update({
      ...worker,
      status: 'walking',
      motion: { ...outbound, id: 'replanned' },
    })
    expect(controller.advance(2).completedMotionId).toBe('replanned')
  })
  it('reports spatial arrival and progress without changing status or inventing work', () => {
    const controller = createCharacterMotion(worker)
    const input = { ...worker, status: 'walking' as const, motion: outbound }
    controller.update(input)
    expect(controller.advance(0).pathProgress).toBe(0)
    expect(
      controller.advance(POSTURE_TRANSITION_SECONDS + 1).pathProgress,
    ).toBeCloseTo(0.5)
    expect(controller.advance(0).completedMotionId).toBeNull()
    const arrived = controller.advance(1)
    expect(arrived.pathProgress).toBe(1)
    expect(arrived.motionId).toBe(outbound.id)
    expect(arrived.completedMotionId).toBe(outbound.id)
    expect(input.status).toBe('walking')
    expect(arrived.position).toEqual(destination)
    controller.update({ ...worker, status: 'collaborating' })
    expect(controller.advance(0).completedMotionId).toBe(outbound.id)
    controller.update({ ...worker, motion: returning })
    expect(controller.advance(0).completedMotionId).toBeNull()
    expect(controller.advance(0).pathProgress).toBe(0)
  })

  it('never reports arrival for a rejected or canceled path', () => {
    const controller = createCharacterMotion(worker)
    controller.update({
      ...worker,
      status: 'walking',
      motion: { ...outbound, points: [destination, [9, 0, 9]] },
    })
    expect(controller.advance(20).completedMotionId).toBeNull()
    expect(controller.advance(0).pathProgress).toBeNull()
    controller.update({
      ...worker,
      status: 'walking',
      motion: { ...outbound, id: 'valid' },
    })
    controller.advance(0.5)
    controller.update({ ...worker, status: 'collaborating' })
    expect(controller.advance(20).completedMotionId).toBeNull()
    expect(controller.advance(0).motionId).toBeNull()
  })
  it.each([
    ['standard-worker', 'headband_on'],
    ['manager', 'seated_work'],
  ] as const)(
    'uses the %s working presentation without changing identity',
    (kind, expectedClip) => {
      const input = { ...worker, kind }
      const controller = createCharacterMotion(input)
      const initial = controller.advance(0)
      expect(initial.position).toEqual(seated)
      expect(initial.clip).toBe(expectedClip)
      expect(initial.active).toBe(true)
      expect(controller.advance(0.4).clipTimeSeconds).toBeCloseTo(0.4)
      expect(input.status).toBe('working')
      expect(input.position).toEqual(seated)
      expect(input.kind).toBe(kind)
    },
  )

  it.each([
    ['working', 'seated_work'],
    ['waiting', 'seated_idle'],
    ['sleeping', 'seated_sleep'],
    ['queued', 'seated_idle'],
    ['completed', 'seated_idle'],
    ['walking', 'stand_up'],
    ['collaborating', 'stand_up'],
    ['blocked', 'seated_work'],
    ['repair', 'seated_work'],
  ] as const)(
    'keeps Manager %s free of accessory and hard-work behavior',
    (status, firstClip) => {
      const controller = createCharacterMotion(manager)
      expect(controller.advance(0.8).clipTimeSeconds).toBeCloseTo(0.8)
      const input = {
        ...manager,
        status,
        motion: status === 'walking' ? outbound : undefined,
      }
      controller.update(input)
      expect(controller.advance(0).clip).toBe(firstClip)
      for (const delta of [0, 0.1, POSTURE_TRANSITION_SECONDS, 1, 2]) {
        const frame = controller.advance(delta)
        expect(frame.clip.startsWith('headband_')).toBe(false)
        expect(frame.clip).not.toBe('seated_work_hard')
        expect(frame.headbandProgress).toBe(0)
        expect(frame.headbandVisible).toBe(false)
        expect(frame.workingHard).toBe(false)
        if (status === 'blocked' || status === 'repair') {
          expect(frame.paused).toBe(true)
          expect(frame.clipTimeSeconds).toBeCloseTo(0.8)
        }
      }
      expect(input.status).toBe(status)
      expect(input.kind).toBe('manager')
    },
  )

  it('lets the Manager depart immediately and return to calm work without an accessory delay', () => {
    const controller = createCharacterMotion(manager)
    const calm = controller.advance(4.2)
    expect(calm.clip).toBe('seated_work')
    expect(calm.active).toBe(true)
    expect(calm.clipTimeSeconds).toBeCloseTo(4.2)
    controller.update({ ...manager, status: 'walking', motion: outbound })
    expect(controller.advance(0).clip).toBe('stand_up')
    const walking = controller.advance(POSTURE_TRANSITION_SECONDS + 0.75)
    expect(walking.clip).toBe('walk')
    expect(walking.position[0]).toBeCloseTo(standing[0] - 0.75)
    const current = [...walking.position]
    controller.update(manager)
    expect(controller.advance(0).position).toEqual(current)
    expect(controller.advance(0).clip).toBe('walk')
    const returned = controller.advance(
      0.75 + quarterTurnSeconds + POSTURE_TRANSITION_SECONDS + 0.5,
    )
    expect(returned.position).toEqual(seated)
    expect(returned.clip).toBe('seated_work')
    expect(returned.clipTimeSeconds).toBeCloseTo(0.5)
    expect(returned.completedMotionId).toMatch(/^office-return:manager-1:/)
    expect(returned.headbandProgress).toBe(0)
    expect(returned.headbandVisible).toBe(false)
    expect(returned.workingHard).toBe(false)
  })

  it.each(['working', 'waiting', 'blocked', 'repair'] as const)(
    'discards worker accessory state immediately if an existing controller becomes a %s Manager',
    (status) => {
      for (const progress of [0, 0.4, 1, 1.2]) {
        const controller = createCharacterMotion(worker)
        controller.advance(HEADBAND_TRANSITION_SECONDS * progress)
        if (progress > 1) {
          controller.update({ ...worker, status: 'completed' })
          controller.advance(0.2)
          expect(controller.advance(0).clip).toBe('headband_off')
        }
        controller.update({ ...manager, status })
        for (const delta of [0, 10]) {
          const frame = controller.advance(delta)
          expect(frame.clip).toBe(
            status === 'working' ? 'seated_work' : 'seated_idle',
          )
          expect(frame.headbandProgress).toBe(0)
          expect(frame.headbandVisible).toBe(false)
          expect(frame.workingHard).toBe(false)
          expect(frame.position).toEqual(seated)
          expect(frame.paused).toBe(status === 'blocked' || status === 'repair')
        }
      }
    },
  )

  it('stands, traverses only a supplied route, returns, and sits with remaining frame time', () => {
    const controller = createCharacterMotion(worker)
    controller.update({ ...worker, status: 'walking', motion: outbound })
    expect(controller.advance(0).clip).toBe('stand_up')
    const halfway = controller.advance(POSTURE_TRANSITION_SECONDS / 2)
    expect(halfway.phase).toBe('standing-up')
    expect(halfway.position[0]).toBeCloseTo(seated[0])
    expect(halfway.position[2]).toBeGreaterThan(standing[2])
    expect(halfway.position[2]).toBeLessThan(seated[2])
    expect(halfway.chairOffsetZ).toBe(-0.4)
    expect(halfway.position[1]).toBe(0)
    expect(controller.advance(POSTURE_TRANSITION_SECONDS / 2).clip).toBe('walk')
    expect(controller.advance(2).position).toEqual(destination)
    expect(controller.advance(0).clip).toBe('stand_idle')
    controller.update({ ...worker, motion: returning })
    const arrived = controller.advance(
      2 +
        quarterTurnSeconds +
        POSTURE_TRANSITION_SECONDS +
        HEADBAND_TRANSITION_SECONDS +
        0.5,
    )
    expect(arrived.position).toEqual(seated)
    expect(arrived.clip).toBe('seated_work_hard')
    expect(arrived.clipTimeSeconds).toBeCloseTo(0.5)
    expect(arrived.diagnostic).toBeNull()
  })

  it('matches small frame updates across corners, repeated points, and posture transitions', () => {
    const motion: AgentMotion = {
      ...outbound,
      points: [
        standing,
        standing,
        [standing[0] - 1, 0, standing[2]],
        [standing[0] - 1, 0, standing[2] - 1],
      ],
    }
    const one = createCharacterMotion(worker)
    const many = createCharacterMotion(worker)
    one.update({ ...worker, status: 'walking', motion })
    many.update({ ...worker, status: 'walking', motion })
    const duration = POSTURE_TRANSITION_SECONDS + 1.8
    const single = one.advance(duration)
    for (let index = 0; index < Math.round(duration * 100); index++)
      many.advance(0.01)
    const divided = many.advance(0)
    for (let axis = 0; axis < 3; axis++)
      expect(divided.position[axis]).toBeCloseTo(single.position[axis], 8)
    expect(divided.headingRadians).toBeCloseTo(single.headingRadians, 8)
    expect(divided.clip).toBe(single.clip)
    expect(divided.clipTimeSeconds).toBeCloseTo(single.clipTimeSeconds, 8)
  })

  it('reverses mid-route and mid-posture without teleporting or restarting repeated commands', () => {
    const controller = createCharacterMotion(worker)
    controller.update({ ...worker, status: 'walking', motion: outbound })
    controller.advance(POSTURE_TRANSITION_SECONDS + 0.75)
    const before = [...controller.advance(0).position]
    controller.update({ ...worker, motion: returning })
    expect(controller.advance(0).position).toEqual(before)
    controller.advance(0.25)
    controller.update({ ...worker, motion: { ...returning } })
    expect(controller.advance(0).position[0]).toBeCloseTo(standing[0] - 0.5)
    controller.advance(
      0.5 + quarterTurnSeconds + POSTURE_TRANSITION_SECONDS / 2,
    )
    expect(controller.advance(0).clip).toBe('sit_down')
    const midSeat = [...controller.advance(0).position]
    controller.update({
      ...worker,
      status: 'walking',
      motion: { ...outbound, id: 'outbound-2' },
    })
    expect(controller.advance(0).position).toEqual(midSeat)
    expect(controller.advance(0).clipTimeSeconds).toBeCloseTo(
      POSTURE_TRANSITION_SECONDS / 2,
    )
    expect(controller.advance(POSTURE_TRANSITION_SECONDS / 2).position).toEqual(
      standing,
    )
    expect(controller.advance(0.25).position[0]).toBeCloseTo(standing[0] - 0.25)
  })

  it.each(['blocked', 'repair'] as const)(
    '%s freezes the exact pose and route time, then continues on a real status update',
    (status) => {
      const controller = createCharacterMotion(worker)
      controller.update({ ...worker, status: 'walking', motion: outbound })
      controller.advance(0.4)
      const before = structuredClone(controller.advance(0))
      controller.update({ ...worker, status, motion: outbound })
      const frozen = controller.advance(60)
      expect(frozen.position).toEqual(before.position)
      expect(frozen.chairOffsetZ).toBe(before.chairOffsetZ)
      expect(frozen.clip).toBe(before.clip)
      expect(frozen.clipTimeSeconds).toBe(before.clipTimeSeconds)
      expect(frozen.paused).toBe(true)
      expect(frozen.active).toBe(false)
      controller.update({ ...worker, status: 'walking', motion: outbound })
      expect(
        controller.advance(POSTURE_TRANSITION_SECONDS - 0.4).position,
      ).toEqual(standing)
      expect(controller.advance(0.5).position[0]).toBeCloseTo(standing[0] - 0.5)
    },
  )

  it('holds a replacement route while blocked and applies it only when unblocked', () => {
    const controller = createCharacterMotion(worker)
    controller.update({ ...worker, status: 'walking', motion: outbound })
    controller.advance(POSTURE_TRANSITION_SECONDS + 1)
    controller.update({ ...worker, status: 'blocked', motion: returning })
    expect(controller.advance(10).position[0]).toBeCloseTo(standing[0] - 1)
    controller.update({ ...worker, motion: returning })
    expect(
      controller.advance(1 + quarterTurnSeconds + POSTURE_TRANSITION_SECONDS)
        .position,
    ).toEqual(seated)
  })

  it('does not infer a route or teleport to a distant desk when state or position changes', () => {
    const controller = createCharacterMotion({
      ...worker,
      position: destination,
      status: 'queued',
    })
    controller.update({ ...worker, position: [100, 0, 100] })
    expect(controller.advance(100).position).toEqual(destination)
    expect(controller.advance(0).clip).toBe('stand_idle')
    expect(controller.advance(0).diagnostic).toContain('return path')
    controller.update({ ...worker, status: 'walking' })
    expect(controller.advance(0).active).toBe(false)
    expect(controller.advance(0).diagnostic).toContain('explicit path')
  })

  it('does not move with malformed, ungrounded, excessive-speed, or off-route commands', () => {
    const invalid: AgentMotion[] = [
      { ...outbound, points: [[NaN, 0, 0], destination] },
      { ...outbound, points: [[0, 1, 0], destination] },
      { ...outbound, points: [standing] },
      { ...outbound, speedMetersPerSecond: 0 },
      { ...outbound, speedMetersPerSecond: 4 },
      { ...outbound, speedMetersPerSecond: Infinity },
      {
        ...outbound,
        points: [
          [10, 0, 10],
          [20, 0, 10],
        ],
      },
    ]
    for (const motion of invalid) {
      const controller = createCharacterMotion({
        ...worker,
        position: standing,
        status: 'queued',
      })
      controller.update({ ...worker, status: 'walking', motion })
      const frame = controller.advance(100)
      expect(frame.position).toEqual(standing)
      expect(frame.clip).toBe('stand_idle')
      expect(frame.diagnostic).not.toBeNull()
    }
    expect(() =>
      createCharacterMotion({ ...worker, position: [0, 1, 0] }),
    ).toThrow()
    const controller = createCharacterMotion(worker)
    for (const delta of [-1, NaN, Infinity])
      expect(() => controller.advance(delta)).toThrow()
  })

  it('keeps idle and sleeping employees seated and cheap; collaboration stands without random walking', () => {
    const controller = createCharacterMotion(worker)
    const idle: OfficeAgentStatus[] = [
      'waiting',
      'sleeping',
      'queued',
      'completed',
    ]
    for (const status of idle) {
      controller.update({ ...worker, status })
      const frame = controller.advance(100)
      expect(frame.phase).toBe('seated')
      expect(frame.active).toBe(false)
      expect(frame.position).toEqual(seated)
    }
    controller.update({ ...worker, status: 'collaborating' })
    expect(controller.advance(POSTURE_TRANSITION_SECONDS).position).toEqual(
      standing,
    )
    expect(controller.advance(100).clip).toBe('stand_idle')
  })

  it('can explicitly return to a seated sleep or waiting state', () => {
    for (const status of ['sleeping', 'waiting'] as const) {
      const controller = createCharacterMotion({
        ...worker,
        position: destination,
        status: 'queued',
      })
      controller.update({ ...worker, status, motion: returning })
      const frame = controller.advance(
        2 + quarterTurnSeconds + POSTURE_TRANSITION_SECONDS,
      )
      expect(frame.position).toEqual(seated)
      expect(frame.clip).toBe(
        status === 'sleeping' ? 'seated_sleep' : 'seated_idle',
      )
      expect(frame.active).toBe(false)
    }
  })

  it('cancels a removed motion command at the current point and does not replay a consumed ID', () => {
    const controller = createCharacterMotion({
      ...worker,
      position: standing,
      status: 'queued',
    })
    controller.update({ ...worker, status: 'walking', motion: outbound })
    controller.advance(1)
    controller.update({ ...worker, status: 'walking' })
    expect(controller.advance(100).position[0]).toBeCloseTo(standing[0] - 1)
    controller.update({ ...worker, status: 'walking', motion: outbound })
    expect(controller.advance(100).position[0]).toBeCloseTo(standing[0] - 1)
  })

  it('rotates reusable seated and standing anchors with the workstation', () => {
    const rotated = {
      position: [5, 0, 8] as WorldPosition,
      headingRadians: Math.PI / 2,
    }
    const seat = seatedWorkstationAnchor(rotated)
    const stand = standingWorkstationAnchor(rotated)
    expect(seat[0]).toBeCloseTo(5 + seated[2])
    expect(seat[2]).toBeCloseTo(8)
    expect(stand[0]).toBeCloseTo(5 + standing[2])
    expect(stand[2]).toBeCloseTo(8 - standing[0])
    const controller = createCharacterMotion({
      ...worker,
      position: seat,
      workstation: rotated,
    })
    expect(controller.advance(0).position).toEqual(seat)
    expect(controller.advance(0).headingRadians).toBe(rotated.headingRadians)
  })

  it('turns to the workstation while standing before starting any seated hip bend', () => {
    const controller = createCharacterMotion({
      ...worker,
      position: destination,
      status: 'queued',
    })
    controller.update({ ...worker, motion: returning })
    const arrived = controller.advance(2)
    expect(arrived.position).toEqual(standing)
    expect(arrived.phase).toBe('turning')
    expect(arrived.clip).toBe('stand_idle')
    expect(arrived.transitionProgress).toBeNull()
    expect(arrived.headingRadians).toBeCloseTo(Math.PI / 2)
    const midTurn = controller.advance(quarterTurnSeconds / 2)
    expect(midTurn.position).toEqual(standing)
    expect(midTurn.clip).toBe('stand_idle')
    expect(midTurn.headingRadians).toBeCloseTo(Math.PI / 4)
    const aligned = controller.advance(quarterTurnSeconds / 2)
    expect(aligned.position).toEqual(standing)
    expect(aligned.headingRadians).toBeCloseTo(desk.headingRadians)
    expect(aligned.clip).toBe('sit_down')
    expect(aligned.transitionProgress).toBe(0)
    const sitting = controller.advance(0.1)
    expect(sitting.headingRadians).toBeCloseTo(desk.headingRadians)
    expect(sitting.transitionProgress).toBeGreaterThan(0)
  })

  it('honors changed heading commands with continuous shortest-angle turns and no path', () => {
    const input = {
      ...worker,
      status: 'queued' as const,
      position: standing,
      headingRadians: Math.PI - 0.1,
    }
    const controller = createCharacterMotion(input)
    controller.update({ ...input, headingRadians: -Math.PI + 0.1 })
    const initial = controller.advance(0)
    expect(initial.headingRadians).toBe(input.headingRadians)
    expect(initial.phase).toBe('turning')
    expect(initial.active).toBe(true)
    expect(initial.moving).toBe(false)
    const halfway = controller.advance(0.1 / (Math.PI * 2))
    expect(halfway.headingRadians).toBeCloseTo(Math.PI)
    expect(halfway.position).toEqual(standing)
    const completed = controller.advance(0.1 / (Math.PI * 2))
    expect(completed.headingRadians).toBeCloseTo(Math.PI + 0.1)
    expect(completed.active).toBe(false)
    expect(completed.phase).toBe('standing')
  })

  it('freezes a turn while blocked and resumes or redirects without changing position', () => {
    const input = { ...worker, position: standing, status: 'queued' as const }
    const controller = createCharacterMotion(input)
    controller.update({ ...input, headingRadians: Math.PI / 2 })
    const heading = controller.advance(0.1).headingRadians
    controller.update({
      ...input,
      status: 'blocked',
      headingRadians: Math.PI / 2,
    })
    expect(controller.advance(10).headingRadians).toBe(heading)
    expect(controller.advance(0).active).toBe(false)
    controller.update({ ...input, headingRadians: -Math.PI / 2 })
    expect(controller.advance(0).headingRadians).toBe(heading)
    const redirected = controller.advance(0.05)
    expect(redirected.headingRadians).toBeLessThan(heading)
    expect(redirected.position).toEqual(standing)
    expect(controller.advance(2).headingRadians).toBeCloseTo(-Math.PI / 2)
  })

  it('clears the chair forward before stepping sideways and reverses the same seated route', () => {
    const controller = createCharacterMotion(worker)
    controller.update({ ...worker, status: 'collaborating' })
    const riseSeconds = POSTURE_TRANSITION_SECONDS - 0.6
    const forward = controller.advance(0.6 + riseSeconds * 0.4)
    expect(forward.position[0]).toBeCloseTo(seated[0])
    expect(forward.position[2]).toBeCloseTo(seated[2] - 0.4 + 0.22)
    expect(forward.chairOffsetZ).toBe(-0.4)
    const side = [...controller.advance(riseSeconds * 0.4).position]
    expect(side[0]).toBeGreaterThan(standing[0] - 0.01)
    expect(side[2]).toBeCloseTo(seated[2] - 0.4 + 0.22)
    expect(controller.advance(riseSeconds * 0.2).position).toEqual(standing)
    controller.update(worker)
    const reversed = controller.advance(riseSeconds * 0.2)
    for (let axis = 0; axis < 3; axis++)
      expect(reversed.position[axis]).toBeCloseTo(side[axis])
    expect(controller.advance(0.6 + riseSeconds * 0.8).position).toEqual(seated)
    expect(controller.advance(0).chairOffsetZ).toBeCloseTo(0)
  })

  it('rolls chair and seated character together before rising, freezes both, and keeps chair back while walking', () => {
    const controller = createCharacterMotion(worker)
    expect(controller.advance(0).chairOffsetZ).toBeCloseTo(0)
    controller.update({ ...worker, status: 'walking', motion: outbound })
    const scooting = controller.advance(0.3)
    expect(scooting.chairOffsetZ).toBeCloseTo(-0.2)
    expect(scooting.position[0]).toBeCloseTo(seated[0])
    expect(scooting.position[2]).toBeCloseTo(seated[2] - 0.2)
    const before = structuredClone(scooting)
    controller.update({ ...worker, status: 'blocked', motion: outbound })
    const frozen = controller.advance(10)
    expect(frozen.position).toEqual(before.position)
    expect(frozen.chairOffsetZ).toBe(before.chairOffsetZ)
    controller.update({ ...worker, status: 'walking', motion: outbound })
    const rolled = controller.advance(0.3)
    expect(rolled.position[2]).toBeCloseTo(seated[2] - 0.4)
    expect(rolled.position[0]).toBeCloseTo(seated[0])
    expect(rolled.chairOffsetZ).toBe(-0.4)
    expect(
      controller.advance(POSTURE_TRANSITION_SECONDS - 0.6).position,
    ).toEqual(standing)
    expect(controller.advance(0).chairOffsetZ).toBe(-0.4)
    const walking = controller.advance(0.5)
    expect(walking.clip).toBe('walk')
    expect(walking.chairOffsetZ).toBe(-0.4)
  })

  it('equips once, loops working-hard, then removes the band before completed idle', () => {
    const controller = createCharacterMotion(worker)
    const initial = controller.advance(0)
    expect(initial.phase).toBe('equipping')
    expect(initial.headbandProgress).toBe(0)
    expect(initial.headbandVisible).toBe(false)
    expect(initial.workingHard).toBe(false)
    expect(
      controller.advance(HEADBAND_TRANSITION_SECONDS * 0.1).headbandVisible,
    ).toBe(false)
    controller.update({ ...worker })
    const visible = controller.advance(HEADBAND_TRANSITION_SECONDS * 0.03)
    expect(visible.headbandProgress).toBeCloseTo(0.13)
    expect(visible.headbandVisible).toBe(true)
    expect(visible.position).toEqual(seated)
    const working = controller.advance(HEADBAND_TRANSITION_SECONDS * 0.87 + 0.5)
    expect(working.clip).toBe('seated_work_hard')
    expect(working.headbandProgress).toBe(1)
    expect(working.workingHard).toBe(true)
    expect(working.clipTimeSeconds).toBeCloseTo(0.5)
    controller.update({ ...worker, status: 'completed' })
    const removing = controller.advance(HEADBAND_TRANSITION_SECONDS / 2)
    expect(removing.phase).toBe('removing')
    expect(removing.clip).toBe('headband_off')
    expect(removing.headbandProgress).toBeCloseTo(0.5)
    expect(removing.workingHard).toBe(false)
    expect(removing.position).toEqual(seated)
    const done = controller.advance(HEADBAND_TRANSITION_SECONDS / 2)
    expect(done.clip).toBe('seated_idle')
    expect(done.headbandVisible).toBe(false)
    expect(done.headbandProgress).toBe(0)
    expect(done.active).toBe(false)
    expect(done.chairOffsetZ).toBeCloseTo(0)
    expect(worker.status).toBe('working')
  })

  it('reverses partial equip and removal at unchanged physical progress without popping', () => {
    const controller = createCharacterMotion(worker)
    controller.advance(HEADBAND_TRANSITION_SECONDS * 0.4)
    controller.update({ ...worker, status: 'waiting' })
    let frame = controller.advance(0)
    expect(frame.clip).toBe('headband_off')
    expect(frame.headbandProgress).toBeCloseTo(0.4)
    expect(frame.clipTimeSeconds).toBeCloseTo(HEADBAND_TRANSITION_SECONDS * 0.6)
    controller.advance(HEADBAND_TRANSITION_SECONDS * 0.1)
    controller.update(worker)
    frame = controller.advance(0)
    expect(frame.clip).toBe('headband_on')
    expect(frame.headbandProgress).toBeCloseTo(0.3)
    expect(frame.clipTimeSeconds).toBeCloseTo(HEADBAND_TRANSITION_SECONDS * 0.3)
    expect(frame.position).toEqual(seated)
    expect(
      controller.advance(HEADBAND_TRANSITION_SECONDS * 0.7).workingHard,
    ).toBe(true)
  })

  it('removes an equipped band before standing or walking and can cancel that departure', () => {
    const controller = createCharacterMotion(worker)
    controller.advance(HEADBAND_TRANSITION_SECONDS)
    controller.update({ ...worker, status: 'walking', motion: outbound })
    const leaving = controller.advance(HEADBAND_TRANSITION_SECONDS * 0.25)
    expect(leaving.phase).toBe('removing')
    expect(leaving.position).toEqual(seated)
    expect(leaving.chairOffsetZ).toBeCloseTo(0)
    expect(leaving.headbandProgress).toBeCloseTo(0.75)
    controller.update(worker)
    expect(controller.advance(0).headbandProgress).toBeCloseTo(0.75)
    expect(
      controller.advance(HEADBAND_TRANSITION_SECONDS * 0.25).workingHard,
    ).toBe(true)
    controller.update({
      ...worker,
      status: 'walking',
      motion: { ...outbound, id: 'outbound-after-cancel' },
    })
    const standingUp = controller.advance(HEADBAND_TRANSITION_SECONDS)
    expect(standingUp.clip).toBe('stand_up')
    expect(standingUp.headbandVisible).toBe(false)
    expect(standingUp.position).toEqual(seated)
    const walking = controller.advance(POSTURE_TRANSITION_SECONDS + 0.2)
    expect(walking.clip).toBe('walk')
    expect(walking.headbandProgress).toBe(0)
    expect(walking.position[0]).toBeCloseTo(standing[0] - 0.2)
  })

  it.each(['blocked', 'repair'] as const)(
    '%s finishes band removal before pausing in a safe seated pose',
    (status) => {
      const controller = createCharacterMotion(worker)
      controller.advance(HEADBAND_TRANSITION_SECONDS * 0.7)
      controller.update({ ...worker, status })
      const removing = controller.advance(HEADBAND_TRANSITION_SECONDS * 0.2)
      expect(removing.clip).toBe('headband_off')
      expect(removing.headbandProgress).toBeCloseTo(0.5)
      expect(removing.paused).toBe(false)
      expect(removing.active).toBe(true)
      expect(removing.position).toEqual(seated)
      const safe = controller.advance(HEADBAND_TRANSITION_SECONDS * 0.5)
      expect(safe.clip).toBe('seated_idle')
      expect(safe.headbandProgress).toBe(0)
      expect(safe.headbandVisible).toBe(false)
      expect(safe.paused).toBe(true)
      expect(safe.active).toBe(false)
      expect(safe.position).toEqual(seated)
      expect(safe.chairOffsetZ).toBeCloseTo(0)
      controller.update(worker)
      expect(controller.advance(0).clip).toBe('headband_on')
      expect(controller.advance(HEADBAND_TRANSITION_SECONDS).workingHard).toBe(
        true,
      )
    },
  )

  it('returns on the last accepted route when working resumes without a new navigation command', () => {
    const controller = createCharacterMotion({ ...worker, status: 'waiting' })
    controller.update({ ...worker, status: 'walking', motion: outbound })
    controller.advance(POSTURE_TRANSITION_SECONDS + 1.2)
    const before = [...controller.advance(0).position]
    controller.update(worker)
    expect(controller.advance(0).position).toEqual(before)
    expect(controller.advance(0).clip).toBe('walk')
    controller.advance(0.4)
    controller.update({ ...worker })
    const seatedAgain = controller.advance(
      0.8 + quarterTurnSeconds + POSTURE_TRANSITION_SECONDS,
    )
    expect(seatedAgain.position).toEqual(seated)
    expect(seatedAgain.phase).toBe('equipping')
    expect(controller.advance(HEADBAND_TRANSITION_SECONDS).workingHard).toBe(
      true,
    )
  })

  it('does not use another workstation route or teleport an initial off-desk working employee', () => {
    const remote = createCharacterMotion({ ...worker, position: destination })
    expect(remote.advance(100).position).toEqual(destination)
    expect(remote.advance(0).diagnostic).toContain('return path')
    expect(remote.advance(0).headbandVisible).toBe(false)
    const standingStart = createCharacterMotion({
      ...worker,
      position: standing,
    })
    expect(standingStart.advance(0).clip).toBe('sit_down')
    expect(standingStart.advance(0).position).toEqual(standing)
    expect(standingStart.advance(POSTURE_TRANSITION_SECONDS).clip).toBe(
      'headband_on',
    )
    const explicit = createCharacterMotion({
      ...worker,
      position: destination,
      motion: returning,
    })
    expect(explicit.advance(0).position).toEqual(destination)
    expect(explicit.advance(0).clip).toBe('walk')
    const controller = createCharacterMotion({ ...worker, status: 'waiting' })
    controller.update({ ...worker, status: 'walking', motion: outbound })
    controller.advance(POSTURE_TRANSITION_SECONDS + 2)
    controller.update({
      ...worker,
      workstation: { ...desk, position: [20, 0, 20] },
    })
    expect(controller.advance(100).position).toEqual(destination)
    expect(controller.advance(0).diagnostic).toContain('return path')
  })

  it('keeps accessory progress and state independent across 30 simultaneous controllers', () => {
    const controllers = Array.from({ length: 30 }, (_, index) =>
      createCharacterMotion({ ...worker, id: `test-worker-${index}` }),
    )
    controllers.forEach((controller, index) =>
      controller.advance((HEADBAND_TRANSITION_SECONDS * (index + 1)) / 31),
    )
    const before = controllers.map(
      (controller) => controller.advance(0).headbandProgress,
    )
    controllers[0].update({
      ...worker,
      id: 'test-worker-0',
      status: 'completed',
    })
    controllers[0].advance(HEADBAND_TRANSITION_SECONDS)
    controllers[1].update({ ...worker, id: 'test-worker-1', status: 'blocked' })
    controllers[1].advance(HEADBAND_TRANSITION_SECONDS)
    for (let index = 2; index < controllers.length; index++) {
      expect(controllers[index].advance(0).headbandProgress).toBe(before[index])
      expect(
        controllers[index].advance(HEADBAND_TRANSITION_SECONDS).workingHard,
      ).toBe(true)
    }
    expect(controllers[0].advance(0).clip).toBe('seated_idle')
    expect(controllers[1].advance(0).paused).toBe(true)
    expect(controllers[0].advance(0)).not.toBe(controllers[1].advance(0))
  })

  it('preserves frame remainder across removal, chair exit and a path segment', () => {
    const one = createCharacterMotion(worker)
    const many = createCharacterMotion(worker)
    for (const controller of [one, many]) {
      controller.advance(HEADBAND_TRANSITION_SECONDS)
      controller.update({ ...worker, status: 'walking', motion: outbound })
    }
    const duration =
      HEADBAND_TRANSITION_SECONDS + POSTURE_TRANSITION_SECONDS + 1.4
    const single = one.advance(duration)
    for (let index = 0; index < Math.round(duration * 100); index++)
      many.advance(0.01)
    const divided = many.advance(0)
    for (let axis = 0; axis < 3; axis++)
      expect(divided.position[axis]).toBeCloseTo(single.position[axis], 8)
    expect(divided.clip).toBe('walk')
    expect(divided.clipTimeSeconds).toBeCloseTo(single.clipTimeSeconds, 8)
    expect(divided.headbandProgress).toBe(0)
    expect(divided.headbandVisible).toBe(false)
    expect(divided.chairOffsetZ).toBe(-0.4)
  })

  it('preserves accepted gait speed on automatic return and while a walking pose is paused', () => {
    const controller = createCharacterMotion({ ...worker, status: 'waiting' })
    controller.update({
      ...worker,
      status: 'walking',
      motion: { ...outbound, speedMetersPerSecond: 0.85 },
    })
    expect(
      controller.advance(POSTURE_TRANSITION_SECONDS + 1)
        .walkingSpeedMetersPerSecond,
    ).toBe(0.85)
    controller.update(worker)
    const returningFrame = controller.advance(0.2)
    expect(returningFrame.clip).toBe('walk')
    expect(returningFrame.walkingSpeedMetersPerSecond).toBe(0.85)
    const time = returningFrame.clipTimeSeconds
    controller.update({ ...worker, status: 'blocked' })
    expect(controller.advance(1).walkingSpeedMetersPerSecond).toBe(0.85)
    expect(controller.advance(0).clipTimeSeconds).toBe(time)
  })
})
