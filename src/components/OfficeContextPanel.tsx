import type {
  AgentContext,
  AgentRuntimeWorkstation,
  AgentSpatialDestination,
  AgentSpatialSnapshot,
  OfficeRuntimeSnapshot,
  OfficeSelection,
  OfficeSelectionHandler,
  WorldPosition,
} from '../office/officeState'
import { safeArtifactUrl } from '../office/officeState'
import type { AgentPlacement } from '../office/workerPresentation'

const DISCONNECTED = 'Unavailable — runtime disconnected'
const listValue = (
  items: readonly string[] | null | undefined,
  unavailable: string,
) => (items == null ? unavailable : items.join(', ') || 'None')
const percentValue = (
  value: number | null | undefined,
  unavailable: string,
  scale = 100,
) =>
  value != null && Number.isFinite(value) && value >= 0 && value <= scale
    ? String(Math.round((value / scale) * 1000) / 10) + '%'
    : unavailable
const positionValue = (position: WorldPosition | null | undefined) =>
  position?.length === 3 && position.every(Number.isFinite)
    ? '(' +
      position
        .map((value) => (Math.abs(value) < 0.005 ? 0 : value).toFixed(2))
        .join(', ') +
      ') m'
    : 'Not reported'

function BusinessDetails({ agent }: { agent?: AgentContext }) {
  const unavailable = agent ? 'Not reported' : DISCONNECTED
  return (
    <>
      <dl>
        <dt>Current task</dt>
        <dd>
          {agent ? (agent.task?.title ?? 'No task reported') : unavailable}
        </dd>
        <dt>Description</dt>
        <dd>{agent?.task?.description ?? unavailable}</dd>
        <dt>Progress</dt>
        <dd>{percentValue(agent?.task?.progressPercent, unavailable)}</dd>
        <dt>Manager</dt>
        <dd>{agent?.manager ?? unavailable}</dd>
        <dt>Dependencies</dt>
        <dd>
          {listValue(
            agent?.dependencies?.map((dependency) =>
              typeof dependency === 'string'
                ? dependency
                : dependency.title
                  ? dependency.title + ' (' + dependency.id + ')'
                  : dependency.id,
            ),
            unavailable,
          )}
        </dd>
        <dt>Collaborator</dt>
        <dd>{agent?.collaborator ?? unavailable}</dd>
        <dt>Next action</dt>
        <dd>{agent?.nextAction ?? unavailable}</dd>
        <dt>Blockers</dt>
        <dd>{listValue(agent?.blockers, unavailable)}</dd>
        <dt>Cost</dt>
        <dd>
          {agent?.cost &&
          Number.isFinite(agent.cost.amount) &&
          agent.cost.amount >= 0
            ? agent.cost.amount + ' ' + agent.cost.currency
            : unavailable}
        </dd>
      </dl>
      <h4>Recent activity</h4>
      {agent?.activity?.length ? (
        <ul>
          {agent.activity.map((item) => (
            <li key={item.id}>
              <time dateTime={item.occurredAt}>{item.occurredAt}</time>{' '}
              {item.summary}
            </li>
          ))}
        </ul>
      ) : (
        <p>{agent?.activity ? 'None' : unavailable}</p>
      )}
      <h4>Artifacts</h4>
      {agent?.artifacts?.length ? (
        <ul>
          {agent.artifacts.map((item) => {
            const href = safeArtifactUrl(item.url)
            return (
              <li key={item.id}>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {item.title}
                  </a>
                ) : (
                  item.title
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p>{agent?.artifacts ? 'None' : unavailable}</p>
      )}
      <h4>API / provider usage</h4>
      {agent?.providerUsage?.length ? (
        <ul>
          {agent.providerUsage.map((item, index) => (
            <li key={item.provider + '-' + item.model + '-' + index}>
              {item.provider} / {item.model}: {item.requests ?? 'unreported'}{' '}
              requests; {item.tokens ?? 'unreported'} tokens
            </li>
          ))}
        </ul>
      ) : (
        <p>{agent?.providerUsage ? 'None' : unavailable}</p>
      )}
    </>
  )
}

function SpatialDetails({
  agentId,
  position,
  headingRadians,
  workstation,
  destination,
  spatial,
  onFocusAgent,
  onInspectWorkstation,
  onRefreshSpatial,
}: {
  agentId: string
  position?: WorldPosition
  headingRadians?: number
  workstation?: Readonly<AgentRuntimeWorkstation> | null
  destination?: Readonly<AgentSpatialDestination> | null
  spatial?: AgentSpatialSnapshot
  onFocusAgent?: (agentId: string) => void
  onInspectWorkstation?: (agentId: string) => void
  onRefreshSpatial?: (agentId: string) => void
}) {
  const currentPosition = spatial ? spatial.position : position
  const heading = spatial ? spatial.headingRadians : headingRadians
  const desk = spatial ? spatial.workstation : workstation
  const target = spatial ? spatial.destination : destination
  const speed = spatial?.speedMetersPerSecond
  return (
    <>
      <h4>Spatial context</h4>
      <dl>
        <dt>Current position</dt>
        <dd>{positionValue(currentPosition)}</dd>
        <dt>Heading</dt>
        <dd>
          {heading != null && Number.isFinite(heading)
            ? heading.toFixed(2) + ' rad'
            : 'Not reported'}
        </dd>
        <dt>Workstation</dt>
        <dd>
          {desk
            ? (desk.id ?? 'Assigned workstation; ID not supplied')
            : 'No workstation supplied'}
        </dd>
        <dt>Workstation position</dt>
        <dd>{positionValue(desk?.position)}</dd>
        <dt>Destination</dt>
        <dd>
          {target
            ? (target.id ?? 'Route endpoint; ID not supplied')
            : spatial
              ? 'No active destination'
              : 'Not reported'}
        </dd>
        <dt>Destination position</dt>
        <dd>{positionValue(target?.position)}</dd>
        <dt>Movement</dt>
        <dd>{spatial?.movementState ?? 'Not reported'}</dd>
        <dt>Posture / transition</dt>
        <dd>{spatial?.phase.replaceAll('-', ' ') ?? 'Not reported'}</dd>
        <dt>Speed</dt>
        <dd>
          {speed != null && Number.isFinite(speed) && speed >= 0
            ? speed.toFixed(2) + ' m/s'
            : 'Not reported'}
        </dd>
        <dt>Path progress</dt>
        <dd>{percentValue(spatial?.pathProgress, 'Not reported', 1)}</dd>
        <dt>Collaboration target</dt>
        <dd>{spatial?.collaborationTargetId ?? 'Not reported'}</dd>
      </dl>
      {spatial?.diagnostic && <p role="status">{spatial.diagnostic}</p>}
      <p className="context-note">
        Spatial values are snapshots in meters, with Y pointing up. They update
        on selection and movement changes
        {onRefreshSpatial ? ', or when refreshed' : ''}. Movement progress is
        separate from task progress.
      </p>
      {onFocusAgent && (
        <button
          type="button"
          className="reset-view"
          onClick={() => onFocusAgent(agentId)}
        >
          Focus agent
        </button>
      )}
      {onInspectWorkstation && (
        <button
          type="button"
          className="reset-view"
          disabled={!desk}
          onClick={() => onInspectWorkstation(agentId)}
        >
          Inspect workstation
        </button>
      )}
      {onRefreshSpatial && (
        <button
          type="button"
          className="reset-view"
          onClick={() => onRefreshSpatial(agentId)}
        >
          Refresh position
        </button>
      )}
    </>
  )
}

type InspectionSample = Pick<AgentPlacement, 'label' | 'kind' | 'status'> &
  Partial<Omit<AgentPlacement, 'label' | 'kind' | 'status'>>

export interface OfficeContextPanelProps {
  selection: OfficeSelection
  runtime: OfficeRuntimeSnapshot | null
  departmentName?: string
  inspectionSample?: InspectionSample
  spatial?: AgentSpatialSnapshot
  onSelect: OfficeSelectionHandler
  onInspect: () => void
  onFocusAgent?: (agentId: string) => void
  onInspectWorkstation?: (agentId: string) => void
  onRefreshSpatial?: (agentId: string) => void
}

export function OfficeContextPanel({
  selection,
  runtime,
  departmentName,
  inspectionSample,
  spatial,
  onSelect,
  onInspect,
  onFocusAgent,
  onInspectWorkstation,
  onRefreshSpatial,
}: OfficeContextPanelProps) {
  const suppliedAgent =
    selection.kind === 'agent' ? runtime?.agents[selection.id] : undefined
  const agent =
    suppliedAgent?.id === (selection.kind === 'agent' ? selection.id : null)
      ? suppliedAgent
      : undefined
  const sample =
    runtime === null &&
    selection.kind === 'agent' &&
    (inspectionSample?.id === undefined || inspectionSample.id === selection.id)
      ? inspectionSample
      : undefined
  const selectedSpatial =
    selection.kind === 'agent' && spatial?.agentId === selection.id
      ? spatial
      : undefined
  const department =
    selection.kind === 'department'
      ? runtime?.departments[selection.id]
      : undefined
  return (
    <aside className="office-context" aria-label="Office context">
      {selection.kind === 'agent' ? (
        agent || sample ? (
          <>
            <h3>{agent?.name ?? sample?.label}</h3>
            {agent ? (
              <p>{agent.role}</p>
            ) : (
              <p>
                <strong>Runtime disconnected.</strong> This is a visual scenario
                input. Its ID identifies the inspected sample; no runtime agent
                record, task or business activity is supplied.
              </p>
            )}
            <dl>
              <dt>Agent ID</dt>
              <dd>{selection.id}</dd>
              <dt>Character</dt>
              <dd>
                {(agent?.kind ?? sample?.kind) === 'manager'
                  ? 'Dedicated Manager model'
                  : 'Canonical stickman worker'}
              </dd>
              {agent ? (
                <>
                  <dt>Status</dt>
                  <dd>{agent.status}</dd>
                </>
              ) : (
                <>
                  <dt>Visual scenario input</dt>
                  <dd>{sample?.status ?? 'No state supplied'}</dd>
                  <dt>Runtime status</dt>
                  <dd>{DISCONNECTED}</dd>
                </>
              )}
              <dt>Role</dt>
              <dd>{agent?.role ?? DISCONNECTED}</dd>
              <dt>Department</dt>
              <dd>{agent?.departmentId ?? DISCONNECTED}</dd>
              {sample && (
                <>
                  <dt>Height</dt>
                  <dd>{sample.kind === 'manager' ? '1.80 m' : '1.75 m'}</dd>
                </>
              )}
            </dl>
            {sample && (
              <p>
                {sample.kind === 'manager'
                  ? 'Dedicated supplied Manager model in the executive workspace.'
                  : 'Canonical stickman with the shared standard workstation.'}{' '}
                Seated work, rest and deterministic walking use the supplied
                model.
              </p>
            )}
            <SpatialDetails
              agentId={selection.id}
              position={agent?.position ?? sample?.position}
              headingRadians={agent?.headingRadians ?? sample?.headingRadians}
              workstation={agent?.workstation ?? sample?.workstation}
              destination={
                agent?.motion?.destination ?? sample?.motion?.destination
              }
              spatial={selectedSpatial}
              onFocusAgent={onFocusAgent}
              onInspectWorkstation={onInspectWorkstation}
              onRefreshSpatial={onRefreshSpatial}
            />
            <BusinessDetails agent={agent} />
          </>
        ) : (
          <>
            <h3>Agent context</h3>
            <dl>
              <dt>Agent ID</dt>
              <dd>{selection.id}</dd>
            </dl>
            <p>
              Agent data unavailable. No runtime information has been supplied
              for this selection.
            </p>
          </>
        )
      ) : selection.kind === 'department' ? (
        <>
          <h3>{department?.name ?? departmentName ?? 'Department'}</h3>
          <p>
            {department?.description ??
              (department
                ? 'No department description reported.'
                : 'Open workspace reserved in the proposed layout.')}
          </p>
          {department ? (
            <>
              <p>Manager: {department.manager ?? 'Not reported'}</p>
              <ul>
                {department.agentIds.map(
                  (id) =>
                    runtime?.agents[id] && (
                      <li key={id}>
                        <button
                          type="button"
                          onClick={() => onSelect({ kind: 'agent', id })}
                        >
                          {runtime.agents[id].name}
                        </button>
                      </li>
                    ),
                )}
              </ul>
            </>
          ) : (
            <p>
              {runtime
                ? 'Department data unavailable in the supplied runtime snapshot.'
                : 'Runtime not connected. Agent and task details are unavailable.'}
            </p>
          )}
          <button type="button" className="reset-view" onClick={onInspect}>
            Inspect workstation area
          </button>
          <p className="context-note">
            Spatial inspection only. Runtime information is shown only when
            supplied.
          </p>
        </>
      ) : (
        <>
          <h3>Company overview</h3>
          <p>
            Choose an open workspace to focus the camera and inspect its
            context.
          </p>
          <p>
            {runtime
              ? 'Agent context reflects the supplied runtime snapshot.'
              : 'Departments are spatial proposals. Runtime agent, task and activity details are unavailable.'}
          </p>
        </>
      )}
    </aside>
  )
}
