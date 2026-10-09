import { useCallback, useRef, useState } from 'react'
import { OfficeWorld } from '../components/3d/OfficeWorld'
import { standingWorkstationAnchor } from '../office/characterMotion'
import { createOfficeNavigation } from '../office/officeNavigation'
import type {
  AgentSpatialSnapshot,
  OfficeAgentStatus,
  OfficeSelection,
  WorldPosition,
} from '../office/officeState'
import type { AgentPlacement } from '../office/workerPresentation'
import {
  createNavigationSamples,
  DEFAULT_SCENARIO_AGENT_ID,
  SCENARIO_HUB_POSITION,
  SCENARIO_MANAGER_ID,
} from './officeNavigationFixtures'

const states: OfficeAgentStatus[] = [
  'sleeping',
  'queued',
  'working',
  'walking',
  'collaborating',
  'waiting',
  'completed',
  'blocked',
  'repair',
]
const seatedPhases = new Set([
  'seated',
  'sitting',
  'standing-up',
  'equipping',
  'removing',
])
const clearOfHub = (position: WorldPosition) =>
  Math.hypot(
    position[0] - SCENARIO_HUB_POSITION[0],
    position[2] - SCENARIO_HUB_POSITION[2],
  ) > 1.2

export default function OfficeNavigationPreview() {
  const [samples, setSamples] = useState(createNavigationSamples)
  const [navigation] = useState(() =>
    createOfficeNavigation(
      samples.map((sample) => ({ id: sample.id, ...sample.workstation! })),
    ),
  )
  const spatialViews = useRef(new Map<string, AgentSpatialSnapshot>())
  const pending = useRef(
    new Map<string, { id: string; arrivalStatus: OfficeAgentStatus }>(),
  )
  const hubReservation = useRef<{ agentId: string; leaving: boolean } | null>(
    null,
  )
  const version = useRef(0)
  const [agentId, setAgentId] = useState(DEFAULT_SCENARIO_AGENT_ID)
  const [events, setEvents] = useState(new Map<string, AgentSpatialSnapshot>())
  const [diagnostic, setDiagnostic] = useState<string | null>(null)
  const [selectionRequest, setSelectionRequest] = useState<{
    version: number
    selection: OfficeSelection
  }>()
  const selected = samples.find((sample) => sample.id === agentId)!
  const event = events.get(agentId)

  const onSpatialEvent = useCallback((snapshot: AgentSpatialSnapshot) => {
    setEvents((current) => new Map(current).set(snapshot.agentId, snapshot))
    if (
      hubReservation.current?.agentId === snapshot.agentId &&
      hubReservation.current.leaving &&
      clearOfHub(snapshot.position)
    )
      hubReservation.current = null
    const command = pending.current.get(snapshot.agentId)
    if (!command || snapshot.completedMotionId !== command.id) return
    pending.current.delete(snapshot.agentId)
    setSamples((current) =>
      current.map((sample) =>
        sample.id === snapshot.agentId &&
        sample.motion?.id === command.id &&
        sample.status === 'walking'
          ? { ...sample, status: command.arrivalStatus, motion: undefined }
          : sample,
      ),
    )
  }, [])

  function releaseClearedHub() {
    const reservation = hubReservation.current
    const position = reservation
      ? spatialViews.current.get(reservation.agentId)?.position
      : undefined
    if (reservation?.leaving && position && clearOfHub(position))
      hubReservation.current = null
  }

  function startPosition(sample: AgentPlacement): WorldPosition {
    const snapshot = spatialViews.current.get(sample.id)
    // The motion controller finishes/reverses its calibrated chair exit first.
    return !snapshot || seatedPhases.has(snapshot.phase)
      ? standingWorkstationAnchor(sample.workstation!)
      : snapshot.position
  }

  function setState(status: OfficeAgentStatus) {
    setDiagnostic(null)
    const retainRoute = status === 'blocked' || status === 'repair'
    if (!retainRoute) {
      pending.current.delete(agentId)
      if (hubReservation.current?.agentId === agentId)
        hubReservation.current.leaving = true
      releaseClearedHub()
    }
    setSamples((current) =>
      current.map((sample) =>
        sample.id === agentId
          ? {
              ...sample,
              status,
              motion: retainRoute ? sample.motion : undefined,
            }
          : sample,
      ),
    )
  }

  function navigate(destinationId: string, arrivalStatus: OfficeAgentStatus) {
    if (!spatialViews.current.has(agentId)) {
      setDiagnostic(
        'Wait for this character to finish loading before requesting navigation.',
      )
      return
    }
    releaseClearedHub()
    if (
      destinationId === 'hub:central' &&
      hubReservation.current &&
      hubReservation.current.agentId !== agentId
    ) {
      const owner = samples.find(
        (sample) => sample.id === hubReservation.current!.agentId,
      )!
      setDiagnostic(
        `Central hub is reserved by ${owner.label}. Return that character first and let it clear the hub.`,
      )
      return
    }
    const route = navigation.planNavigation(
      startPosition(selected),
      destinationId,
    )
    if (!route.ok) {
      setDiagnostic(route.diagnostic)
      return
    }
    setDiagnostic(null)
    if (destinationId === 'hub:central')
      hubReservation.current = { agentId, leaving: false }
    else if (hubReservation.current?.agentId === agentId)
      hubReservation.current.leaving = true
    if (route.distanceMeters <= 0.01) {
      setState(arrivalStatus)
      return
    }
    const id = `scenario-motion-${++version.current}`
    pending.current.set(agentId, { id, arrivalStatus })
    setSamples((current) =>
      current.map((sample) =>
        sample.id === agentId
          ? {
              ...sample,
              status: 'walking',
              motion: {
                id,
                points: route.points,
                speedMetersPerSecond: 0.85,
                destination: route.destination,
              },
            }
          : sample,
      ),
    )
  }

  function changeState(status: OfficeAgentStatus) {
    if (status === 'working' || status === 'waiting' || status === 'sleeping')
      navigate(`workstation:${agentId}`, status)
    else if (status === 'walking') navigate('hub:central', 'collaborating')
    else setState(status)
  }

  function focus(id: string) {
    setAgentId(id)
    setDiagnostic(null)
    setSelectionRequest({
      version: ++version.current,
      selection: { kind: 'agent', id },
    })
  }

  const onSelectionChange = useCallback((selection: OfficeSelection) => {
    if (selection.kind === 'agent') {
      setAgentId(selection.id)
      setDiagnostic(null)
    }
  }, [])

  return (
    <>
      <p className="asset-preview-notice">
        Deterministic spatial scenarios · 30 standard worker samples, one
        dedicated Manager and their shared workstations. Every change below is
        an explicit development test input. No tasks or business activity are
        simulated.
      </p>
      <fieldset className="animation-preview-controls">
        <legend>Spatial scenario controls</legend>
        <label>
          Scenario character
          <select
            data-testid="scenario-character"
            value={agentId}
            onChange={(event) => {
              setAgentId(event.currentTarget.value)
              setDiagnostic(null)
            }}
          >
            {samples.map((sample) => (
              <option key={sample.id} value={sample.id}>
                {sample.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scenario state
          <select
            data-testid="scenario-state"
            value={selected.status ?? 'waiting'}
            onChange={(event) => {
              const state = states.find(
                (status) => status === event.currentTarget.value,
              )
              if (state) changeState(state)
            }}
          >
            {states.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="reset-view"
          data-testid="scenario-work"
          onClick={() => navigate(`workstation:${agentId}`, 'working')}
        >
          Work at desk
        </button>
        <button
          type="button"
          className="reset-view"
          data-testid="scenario-hub"
          onClick={() => navigate('hub:central', 'collaborating')}
        >
          Walk to central hub
        </button>
        <button
          type="button"
          className="reset-view"
          data-testid="scenario-return"
          onClick={() => navigate(`workstation:${agentId}`, 'working')}
        >
          Return to desk and work
        </button>
        <button
          type="button"
          className="reset-view"
          data-testid="scenario-focus"
          onClick={() => focus(agentId)}
        >
          Focus character
        </button>
        <button
          type="button"
          className="reset-view"
          data-testid="scenario-manager"
          onClick={() => focus(SCENARIO_MANAGER_ID)}
        >
          Focus Manager
        </button>
        <p>
          Walk requests finish in a standing collaboration pose at the hub.
          Work, waiting and sleeping requests return to the assigned desk. Other
          states apply at the current location. Worker 13 starts nearest the
          central corridor. The hub admits one scenario character at a time.
        </p>
        <output data-testid="scenario-feedback" aria-live="polite">
          {diagnostic ??
            event?.diagnostic ??
            (event
              ? `Last spatial transition: ${event.phase} · ${event.movementState}`
              : 'Ready for an explicit scenario request.')}
        </output>
      </fieldset>
      <OfficeWorld
        inspectionSamples={samples}
        spatialViews={spatialViews}
        onSpatialEvent={onSpatialEvent}
        onSelectionChange={onSelectionChange}
        selectionRequest={selectionRequest}
      />
    </>
  )
}
