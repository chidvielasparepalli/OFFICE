import { useRef, useState } from 'react'
import { OfficeWorld } from '../components/3d/OfficeWorld'
import { officeAssets } from '../assets/officeAssets'
import {
  seatedWorkstationAnchor,
  standingWorkstationAnchor,
  workstationAnchor,
} from '../office/characterMotion'
import type { OfficeAgentStatus, WorldPosition } from '../office/officeState'
import type { AgentPlacement } from '../office/workerPresentation'

// Development-only animation inputs, never an OfficeRuntimeSnapshot or business-state fixture.
const initialSamples: AgentPlacement[] =
  officeAssets.warehouse.layout.departments
    .filter((zone) => zone.id !== 'executive')
    .flatMap((zone, department) =>
      Array.from({ length: 5 }, (_, index) => {
        const x = zone.position[0] + [-2.5, 0, 2.5][index % 3]
        const z = zone.position[2] + (index < 3 ? -1.3 : 1.4)
        const number = department * 5 + index + 1
        const workstation = {
          position: [x, 0, z + 0.72] as WorldPosition,
          headingRadians: 0,
        }
        return {
          id: `asset-sample-${String(number).padStart(2, '0')}`,
          kind: 'standard-worker' as const,
          label: `Asset sample ${number}`,
          status: 'working' as const,
          position: seatedWorkstationAnchor(workstation),
          headingRadians: 0,
          workstation,
        }
      }),
    )
const managerWorkstation = {
  position: [0, 0, -10.18] as WorldPosition,
  headingRadians: 0,
}
initialSamples.push({
  id: 'asset-manager-primary',
  kind: 'manager',
  label: 'Manager asset sample',
  status: 'working',
  position: seatedWorkstationAnchor(managerWorkstation),
  headingRadians: 0,
  workstation: managerWorkstation,
})

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

export default function WorkerAssetPreview() {
  const [samples, setSamples] = useState(initialSamples)
  const [sampleId, setSampleId] = useState('asset-sample-01')
  const commandNumber = useRef(0)
  const routedSamples = useRef(new Set<string>())
  const selected = samples.find((sample) => sample.id === sampleId)!

  function route(sample: AgentPlacement, returning: boolean, command: number) {
    const standing = standingWorkstationAnchor(sample.workstation!)
    // Exit beside the chair, then use the aisle; the reverse retraces the same clearance.
    const points = [
      standing,
      workstationAnchor(sample.workstation!, [1.2, 0, -1.5]),
      workstationAnchor(sample.workstation!, [1.2, 0, -2.5]),
    ]
    return {
      id: `${sample.id}-animation-test-${command}`,
      points: returning ? points.reverse() : points,
      speedMetersPerSecond: 0.85,
    }
  }

  function changeState(
    status: OfficeAgentStatus,
    all = false,
    explicitReturn = false,
  ) {
    const command = ++commandNumber.current
    setSamples((current) =>
      current.map((sample) => {
        if (!all && sample.id !== sampleId) return sample
        const seated = ['working', 'waiting', 'sleeping'].includes(status)
        return {
          ...sample,
          status,
          motion:
            seated &&
            (status !== 'working' || explicitReturn) &&
            routedSamples.current.has(sample.id)
              ? route(sample, true, command)
              : status === 'blocked' || status === 'repair'
                ? sample.motion
                : undefined,
        }
      }),
    )
  }

  function walk() {
    const command = ++commandNumber.current
    routedSamples.current.add(sampleId)
    setSamples((current) =>
      current.map((sample) =>
        sample.id === sampleId
          ? {
              ...sample,
              status: 'walking',
              motion: route(sample, false, command),
            }
          : sample,
      ),
    )
  }

  return (
    <>
      <p className="asset-preview-notice">
        Animation inspection · 30 stickman samples, one dedicated Manager model,
        and 31 shared workstations. Controls supply animation test states only;
        no agents, tasks or business activity are running.
      </p>
      <fieldset className="animation-preview-controls">
        <legend>Animation test controls</legend>
        <label>
          Character
          <select
            data-testid="animation-character"
            value={sampleId}
            onChange={(event) => setSampleId(event.currentTarget.value)}
          >
            <option value="asset-sample-01">Worker 1</option>
            <option value="asset-manager-primary">Manager</option>
          </select>
        </label>
        <label>
          Test state
          <select
            data-testid="animation-state"
            value={selected.status ?? 'waiting'}
            onChange={(event) => {
              const status = states.find(
                (state) => state === event.currentTarget.value,
              )
              if (status) changeState(status)
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
          data-testid="animation-start-work"
          onClick={() => changeState('working')}
        >
          Work at assigned desk
        </button>
        <button
          type="button"
          className="reset-view"
          data-testid="animation-complete"
          onClick={() => changeState('completed')}
        >
          Complete test work
        </button>
        <button type="button" className="reset-view" onClick={walk}>
          Walk test route
        </button>
        <button
          type="button"
          className="reset-view"
          onClick={() => changeState('working', false, true)}
        >
          Return to workstation
        </button>
        <button
          type="button"
          className="reset-view"
          onClick={() => changeState('working', true)}
        >
          All working
        </button>
        <button
          type="button"
          className="reset-view"
          onClick={() => changeState('sleeping', true)}
        >
          All sleeping
        </button>
      </fieldset>
      <OfficeWorld inspectionSamples={samples} />
    </>
  )
}
