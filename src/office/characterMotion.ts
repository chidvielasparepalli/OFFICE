import type { AgentMotion, WorldPosition } from './officeState'
import { validGroundPose, type AgentPlacement } from './workerPresentation'
import { reverseAcceptedWorkstationRoute } from './workstationReturn'

export const WORKSTATION_ANCHORS = {
  seat: [0, 0, -0.73] as WorldPosition,
  standing: [0.65, 0, -1.35] as WorldPosition,
}
export const POSTURE_TRANSITION_SECONDS = 2.6
export const HEADBAND_TRANSITION_SECONDS = 3.6
const CHAIR_ROLLBACK_SECONDS = 0.6
const CHAIR_ROLLBACK_METERS = 0.4
const TURN_SPEED_RADIANS_PER_SECOND = Math.PI * 2

type Workstation = NonNullable<AgentPlacement['workstation']>
export type CharacterClip =
  | 'seated_work'
  | 'seated_work_hard'
  | 'headband_on'
  | 'headband_off'
  | 'seated_idle'
  | 'seated_sleep'
  | 'stand_idle'
  | 'walk'
  | 'sit_down'
  | 'stand_up'

export interface CharacterMotionFrame {
  /** Presentation feedback only; arriving never changes the supplied business status. */
  motionId: string | null
  completedMotionId: string | null
  pathProgress: number | null
  position: WorldPosition
  headingRadians: number
  chairOffsetZ: number
  headbandProgress: number
  headbandVisible: boolean
  workingHard: boolean
  walkingSpeedMetersPerSecond: number
  clip: CharacterClip
  clipTimeSeconds: number
  phase:
    | 'seated'
    | 'standing'
    | 'turning'
    | 'walking'
    | 'sitting'
    | 'standing-up'
    | 'equipping'
    | 'removing'
  transitionProgress: number | null
  paused: boolean
  moving: boolean
  active: boolean
  diagnostic: string | null
}

export function workstationAnchor(
  workstation: Workstation,
  local: WorldPosition,
) {
  const cosine = Math.cos(workstation.headingRadians)
  const sine = Math.sin(workstation.headingRadians)
  return [
    workstation.position[0] + local[0] * cosine + local[2] * sine,
    0,
    workstation.position[2] - local[0] * sine + local[2] * cosine,
  ] as WorldPosition
}

export const seatedWorkstationAnchor = (workstation: Workstation) =>
  workstationAnchor(workstation, WORKSTATION_ANCHORS.seat)
export const standingWorkstationAnchor = (workstation: Workstation) =>
  workstationAnchor(workstation, WORKSTATION_ANCHORS.standing)

const distance = (a: WorldPosition, b: WorldPosition) =>
  Math.hypot(a[0] - b[0], a[2] - b[2])
const angleDelta = (from: number, to: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from))
const sameStation = (a: Workstation, b: Workstation) =>
  distance(a.position, b.position) < 0.001 &&
  Math.abs(angleDelta(a.headingRadians, b.headingRadians)) < 0.001
const seatedStatus = (status: AgentPlacement['status']) =>
  status === 'working' || status === 'waiting' || status === 'sleeping'
const smoothStep = (value: number) => {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped * clamped * (3 - 2 * clamped)
}
const chairOffset = (standingAmount: number) =>
  -CHAIR_ROLLBACK_METERS *
  smoothStep(
    (standingAmount * POSTURE_TRANSITION_SECONDS) / CHAIR_ROLLBACK_SECONDS,
  )

interface Route {
  points: readonly WorldPosition[]
  next: number
  speed: number
  cumulative: readonly number[]
  length: number
}

function validMotion(motion: Readonly<AgentMotion>) {
  return (
    typeof motion.id === 'string' &&
    motion.id.length > 0 &&
    Number.isFinite(motion.speedMetersPerSecond) &&
    motion.speedMetersPerSecond > 0 &&
    motion.speedMetersPerSecond <= 3 &&
    Array.isArray(motion.points) &&
    motion.points.length >= 2 &&
    motion.points.length <= 1024 &&
    motion.points.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 3 &&
        point.every(Number.isFinite) &&
        point[1] === 0,
    )
  )
}

/** A replacement route may reverse a segment already occupied, without inventing a connector. */
function routeFrom(position: WorldPosition, motion: Readonly<AgentMotion>) {
  for (let index = 0; index < motion.points.length - 1; index++) {
    const from = motion.points[index]
    const to = motion.points[index + 1]
    const dx = to[0] - from[0]
    const dz = to[2] - from[2]
    const lengthSquared = dx * dx + dz * dz
    const progress = lengthSquared
      ? ((position[0] - from[0]) * dx + (position[2] - from[2]) * dz) /
        lengthSquared
      : 0
    const clamped = Math.max(0, Math.min(1, progress))
    const nearest: WorldPosition = [
      from[0] + dx * clamped,
      0,
      from[2] + dz * clamped,
    ]
    if (distance(position, nearest) <= 0.01) {
      const cumulative = [0]
      for (let step = 1; step < motion.points.length; step++)
        cumulative.push(
          cumulative[step - 1] +
            distance(motion.points[step - 1], motion.points[step]),
        )
      return {
        points: motion.points.map((point) => [...point] as WorldPosition),
        next: index + 1,
        speed: motion.speedMetersPerSecond,
        cumulative,
        length: cumulative[cumulative.length - 1],
      }
    }
  }
  return null
}

class CharacterMotionController {
  private input: AgentPlacement
  private readonly frame: CharacterMotionFrame
  private route: Route | null = null
  private lastMotionId: string | null = null
  private acceptedMotion: Readonly<AgentMotion> | undefined
  private automaticReturn = false
  private returnSequence = 0
  private seatedAmount = 0
  private headbandAmount = 0
  private seatedStation: Workstation | null = null
  private standingPosition: WorldPosition
  private standingHeading: number
  private routeDiagnostic: string | null = null
  private requestedHeading: number | null = null
  private turnTarget: number | null = null

  constructor(input: AgentPlacement) {
    if (!validGroundPose(input))
      throw new Error('Invalid character ground pose')
    this.input = input
    this.standingPosition = [...input.position]
    this.standingHeading = input.headingRadians
    this.frame = {
      motionId: null,
      completedMotionId: null,
      pathProgress: null,
      position: [...input.position],
      headingRadians: input.headingRadians,
      chairOffsetZ: -CHAIR_ROLLBACK_METERS,
      headbandProgress: 0,
      headbandVisible: false,
      workingHard: false,
      walkingSpeedMetersPerSecond: 0,
      clip: 'stand_idle',
      clipTimeSeconds: 0,
      phase: 'standing',
      transitionProgress: null,
      paused: false,
      moving: false,
      active: false,
      diagnostic: null,
    }
    // Mounting a seated employee establishes their initial pose, not a movement command.
    if (
      seatedStatus(input.status) &&
      input.workstation &&
      validGroundPose(input.workstation) &&
      !input.motion &&
      distance(input.position, seatedWorkstationAnchor(input.workstation)) <=
        0.01
    ) {
      this.seatedStation = input.workstation
      this.standingPosition = standingWorkstationAnchor(input.workstation)
      this.standingHeading = input.workstation.headingRadians
      this.seatedAmount = 1
      this.frame.position = seatedWorkstationAnchor(input.workstation)
      this.frame.headingRadians = input.workstation.headingRadians
    }
    this.update(input)
  }

  update(input: AgentPlacement) {
    const enteringWorking =
      input.status === 'working' && this.input.status !== 'working'
    if (
      Number.isFinite(input.headingRadians) &&
      Math.abs(angleDelta(this.input.headingRadians, input.headingRadians)) >
        0.00001
    )
      this.requestedHeading = input.headingRadians
    this.input = input
    if (input.navigationDiagnostic) {
      // A changed layout can invalidate a consumed command ID; stop before the replay guard.
      this.route = null
      this.acceptedMotion = undefined
      this.automaticReturn = false
      this.lastMotionId = input.motion?.id ?? this.lastMotionId
      this.frame.motionId = input.motion?.id ?? null
      this.frame.completedMotionId = null
      this.frame.pathProgress = null
      this.routeDiagnostic = input.navigationDiagnostic
    } else if (input.status !== 'blocked' && input.status !== 'repair')
      this.acceptMotion(enteringWorking)
    this.reconcile()
  }

  private acceptMotion(enteringWorking: boolean) {
    let motion = this.input.motion
    if (!motion) {
      if (this.automaticReturn && this.input.status === 'working') return
      const station = this.input.workstation
      const departure =
        this.seatedAmount > 0 ? this.standingPosition : this.frame.position
      motion =
        enteringWorking && station && validGroundPose(station)
          ? (reverseAcceptedWorkstationRoute(
              departure,
              standingWorkstationAnchor(station),
              this.acceptedMotion,
              `office-return:${this.input.id}:${++this.returnSequence}`,
            ) ?? undefined)
          : undefined
      this.automaticReturn = motion !== undefined
      if (!motion) {
        if (this.route) {
          this.frame.motionId = null
          this.frame.completedMotionId = null
          this.frame.pathProgress = null
        }
        this.route = null
        this.routeDiagnostic = null
        return
      }
    } else {
      this.automaticReturn = false
    }
    if (motion.id === this.lastMotionId) return
    this.lastMotionId = motion.id
    this.frame.motionId = motion.id
    this.frame.completedMotionId = null
    this.frame.pathProgress = null
    this.route = null
    this.routeDiagnostic = null
    if (!validMotion(motion)) {
      this.routeDiagnostic = 'Invalid movement path or speed (maximum 3 m/s).'
      return
    }
    const departure =
      this.seatedAmount > 0 ? this.standingPosition : this.frame.position
    this.route = routeFrom(departure, motion)
    if (!this.route) {
      this.routeDiagnostic =
        'Movement path does not contain the current position.'
    } else {
      this.acceptedMotion = { ...motion, points: this.route.points }
    }
    this.skipReachedPoints()
  }

  private skipReachedPoints() {
    if (!this.route) return
    const position =
      this.seatedAmount > 0 ? this.standingPosition : this.frame.position
    while (
      this.route.next < this.route.points.length &&
      distance(position, this.route.points[this.route.next]) < 0.000001
    )
      this.route.next++
    if (this.route.next === this.route.points.length) {
      this.frame.completedMotionId = this.frame.motionId
      this.frame.pathProgress = 1
      this.route = null
    }
  }

  private setClip(clip: CharacterClip) {
    if (this.frame.clip !== clip) {
      this.frame.clip = clip
      this.frame.clipTimeSeconds = 0
    }
    if (clip === 'sit_down')
      this.frame.clipTimeSeconds =
        this.seatedAmount * POSTURE_TRANSITION_SECONDS
    if (clip === 'stand_up')
      this.frame.clipTimeSeconds =
        (1 - this.seatedAmount) * POSTURE_TRANSITION_SECONDS
    if (clip === 'headband_on')
      this.frame.clipTimeSeconds =
        this.headbandAmount * HEADBAND_TRANSITION_SECONDS
    if (clip === 'headband_off')
      this.frame.clipTimeSeconds =
        (1 - this.headbandAmount) * HEADBAND_TRANSITION_SECONDS
  }

  private reconcile() {
    const standardWorker = this.input.kind === 'standard-worker'
    if (!standardWorker) {
      // Fail closed if an existing controller is reclassified, including while paused.
      this.headbandAmount = 0
      if (
        this.frame.clip.startsWith('headband_') ||
        this.frame.clip === 'seated_work_hard'
      )
        this.setClip(this.seatedAmount > 0 ? 'seated_idle' : 'stand_idle')
    }
    if (this.route) {
      const position =
        this.seatedAmount > 0 ? this.standingPosition : this.frame.position
      this.frame.pathProgress = this.route.length
        ? Math.max(
            0,
            Math.min(
              1,
              (this.route.cumulative[this.route.next] -
                distance(position, this.route.points[this.route.next])) /
                this.route.length,
            ),
          )
        : 1
    }
    const halted =
      this.input.status === 'blocked' || this.input.status === 'repair'
    this.frame.paused = halted && this.headbandAmount === 0
    if (halted) {
      if (this.headbandAmount > 0) {
        this.turnTarget = null
        this.setClip('headband_off')
      } else if (
        this.frame.clip === 'headband_on' ||
        this.frame.clip === 'headband_off'
      ) {
        this.setClip('seated_idle')
      }
    } else {
      this.frame.chairOffsetZ = chairOffset(1 - this.seatedAmount)
      this.turnTarget = null
      const { status, workstation } = this.input
      const station =
        workstation && validGroundPose(workstation) ? workstation : null
      const keepSeated =
        this.seatedAmount > 0 && (status === 'queued' || status === 'completed')
      const wantsSeat = seatedStatus(status) || keepSeated
      const correctStation =
        station &&
        this.seatedStation &&
        sameStation(station, this.seatedStation)
      this.frame.diagnostic = this.routeDiagnostic
      const wantsWork =
        status === 'working' &&
        this.seatedAmount === 1 &&
        correctStation &&
        !this.route
      const wantsHardWork = standardWorker && wantsWork
      if (this.headbandAmount > 0 && !wantsHardWork) {
        this.setClip('headband_off')
      } else if (wantsHardWork) {
        this.setClip(
          this.headbandAmount < 1 ? 'headband_on' : 'seated_work_hard',
        )
      } else if (wantsWork) {
        this.setClip('seated_work')
      } else if (
        this.seatedAmount > 0 &&
        (this.route || !wantsSeat || !correctStation)
      ) {
        this.setClip('stand_up')
      } else if (this.route) {
        this.setClip('walk')
      } else if (wantsSeat) {
        if (!station) {
          this.setClip('stand_idle')
          this.frame.diagnostic ??=
            'A workstation is required for a seated pose.'
        } else if (this.seatedAmount === 0) {
          if (
            distance(this.frame.position, standingWorkstationAnchor(station)) <=
            0.01
          ) {
            this.requestedHeading = null
            if (
              Math.abs(
                angleDelta(this.frame.headingRadians, station.headingRadians),
              ) > 0.00001
            ) {
              this.setClip('stand_idle')
              this.turnTarget = station.headingRadians
            } else {
              this.standingPosition = [...this.frame.position]
              this.standingHeading = this.frame.headingRadians
              this.seatedStation = station
              this.setClip('sit_down')
            }
          } else {
            this.setClip('stand_idle')
            this.frame.diagnostic ??=
              'Provide a return path to the workstation standing anchor.'
          }
        } else if (this.seatedAmount < 1) {
          this.setClip('sit_down')
        } else {
          this.setClip(status === 'sleeping' ? 'seated_sleep' : 'seated_idle')
        }
      } else {
        this.setClip('stand_idle')
        if (
          status === 'walking' &&
          !this.frame.diagnostic &&
          (!this.input.motion ||
            this.frame.completedMotionId !== this.input.motion.id)
        )
          this.frame.diagnostic =
            'Walking requires an unfinished explicit path.'
      }
      if (
        this.frame.clip === 'stand_idle' &&
        this.turnTarget === null &&
        this.requestedHeading !== null
      ) {
        if (
          Math.abs(
            angleDelta(this.frame.headingRadians, this.requestedHeading),
          ) > 0.00001
        )
          this.turnTarget = this.requestedHeading
        else this.requestedHeading = null
      }
    }
    const clip = this.frame.clip
    this.frame.headbandProgress = this.headbandAmount
    this.frame.headbandVisible = this.headbandAmount >= 0.12
    this.frame.workingHard = clip === 'seated_work_hard'
    this.frame.walkingSpeedMetersPerSecond =
      clip === 'walk' ? (this.route?.speed ?? 0) : 0
    this.frame.transitionProgress =
      clip === 'sit_down'
        ? this.seatedAmount
        : clip === 'stand_up'
          ? 1 - this.seatedAmount
          : clip === 'headband_on'
            ? this.headbandAmount
            : clip === 'headband_off'
              ? 1 - this.headbandAmount
              : null
    this.frame.phase =
      clip === 'headband_on'
        ? 'equipping'
        : clip === 'headband_off'
          ? 'removing'
          : this.turnTarget !== null
            ? 'turning'
            : clip === 'sit_down'
              ? 'sitting'
              : clip === 'stand_up'
                ? 'standing-up'
                : clip === 'walk'
                  ? 'walking'
                  : clip.startsWith('seated_')
                    ? 'seated'
                    : 'standing'
    this.frame.active =
      !this.frame.paused &&
      (this.turnTarget !== null ||
        clip === 'seated_work' ||
        clip === 'seated_work_hard' ||
        clip === 'headband_on' ||
        clip === 'headband_off' ||
        clip === 'walk' ||
        clip === 'sit_down' ||
        clip === 'stand_up')
    this.frame.moving =
      this.frame.active &&
      (clip === 'walk' || clip === 'sit_down' || clip === 'stand_up')
  }

  /** The returned frame is reused; copy it only when retaining a historical snapshot. */
  advance(deltaSeconds: number): CharacterMotionFrame {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0)
      throw new Error('Character delta must be finite and nonnegative')
    if (this.frame.paused || !this.frame.active) return this.frame
    let remaining = deltaSeconds
    while (remaining > 0.0000001 && this.frame.active) {
      const clip = this.frame.clip
      if (this.turnTarget !== null) {
        const turn = angleDelta(this.frame.headingRadians, this.turnTarget)
        const untilComplete = Math.abs(turn) / TURN_SPEED_RADIANS_PER_SECOND
        const step = Math.min(remaining, untilComplete)
        this.frame.headingRadians +=
          step === untilComplete
            ? turn
            : Math.sign(turn) * step * TURN_SPEED_RADIANS_PER_SECOND
        remaining -= step
        this.reconcile()
        continue
      }
      if (clip === 'headband_on' || clip === 'headband_off') {
        const direction = clip === 'headband_on' ? 1 : -1
        const untilComplete =
          (direction > 0 ? 1 - this.headbandAmount : this.headbandAmount) *
          HEADBAND_TRANSITION_SECONDS
        const step = Math.min(remaining, untilComplete)
        this.headbandAmount = Math.max(
          0,
          Math.min(
            1,
            this.headbandAmount +
              (direction * step) / HEADBAND_TRANSITION_SECONDS,
          ),
        )
        if (untilComplete - step < 0.00000001)
          this.headbandAmount = direction > 0 ? 1 : 0
        remaining -= step
        this.reconcile()
        continue
      }
      if (clip === 'seated_work' || clip === 'seated_work_hard') {
        this.frame.clipTimeSeconds += remaining
        break
      }
      if (clip === 'sit_down' || clip === 'stand_up') {
        const direction = clip === 'sit_down' ? 1 : -1
        const untilComplete =
          (direction > 0 ? 1 - this.seatedAmount : this.seatedAmount) *
          POSTURE_TRANSITION_SECONDS
        const step = Math.min(remaining, untilComplete)
        this.seatedAmount = Math.max(
          0,
          Math.min(
            1,
            this.seatedAmount + (direction * step) / POSTURE_TRANSITION_SECONDS,
          ),
        )
        if (untilComplete - step < 0.00000001)
          this.seatedAmount = direction > 0 ? 1 : 0
        const standingAmount = 1 - this.seatedAmount
        const riseProgress = Math.max(
          0,
          Math.min(
            1,
            (standingAmount * POSTURE_TRANSITION_SECONDS -
              CHAIR_ROLLBACK_SECONDS) /
              (POSTURE_TRANSITION_SECONDS - CHAIR_ROLLBACK_SECONDS),
          ),
        )
        const ease = smoothStep(this.seatedAmount)
        const seat = WORKSTATION_ANCHORS.seat
        const exit = WORKSTATION_ANCHORS.standing
        const clearance = seat[2] - exit[2] - CHAIR_ROLLBACK_METERS
        // Roll the chair back, rise forward of its armrest, then step into the aisle.
        const target = workstationAnchor(this.seatedStation!, [
          seat[0] +
            (exit[0] - seat[0]) * smoothStep((riseProgress - 0.42) / 0.4),
          0,
          seat[2] +
            chairOffset(standingAmount) +
            clearance * smoothStep(riseProgress / 0.4) -
            2 * clearance * smoothStep((riseProgress - 0.8) / 0.2),
        ])
        const nominalExit = standingWorkstationAnchor(this.seatedStation!)
        this.frame.position = [
          target[0] + (this.standingPosition[0] - nominalExit[0]) * (1 - ease),
          0,
          target[2] + (this.standingPosition[2] - nominalExit[2]) * (1 - ease),
        ]
        this.frame.headingRadians =
          this.standingHeading +
          angleDelta(this.standingHeading, this.seatedStation!.headingRadians) *
            ease
        remaining -= step
      } else if (clip === 'walk' && this.route) {
        const target = this.route.points[this.route.next]
        const from = this.frame.position
        const gap = distance(from, target)
        const step = Math.min(remaining, gap / this.route.speed)
        const fraction = gap ? (step * this.route.speed) / gap : 1
        this.frame.position =
          gap / this.route.speed - step < 0.00000001
            ? target
            : [
                from[0] + (target[0] - from[0]) * fraction,
                0,
                from[2] + (target[2] - from[2]) * fraction,
              ]
        const targetHeading = Math.atan2(
          target[0] - from[0],
          target[2] - from[2],
        )
        const turn = angleDelta(this.frame.headingRadians, targetHeading)
        this.frame.headingRadians +=
          Math.sign(turn) * Math.min(Math.abs(turn), step * Math.PI * 4)
        this.frame.clipTimeSeconds += step
        remaining -= step
        this.skipReachedPoints()
      } else break
      this.reconcile()
    }
    return this.frame
  }
}

/** Position seeds mounting; paths move it. Changed headings turn standing actors in place. */
export function createCharacterMotion(input: AgentPlacement) {
  return new CharacterMotionController(input)
}
