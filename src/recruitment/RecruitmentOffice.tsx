import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'
import type { FormEvent } from 'react'
import { RuntimeOffice } from '../components/RuntimeOffice'
import type { AgentSpatialSnapshot } from '../office/officeState'
import { RecruitmentClient } from './recruitmentClient'
import type {
  RecruitmentHostStatus,
  RecruitmentAction,
} from './recruitmentClient'
import { createRecruitmentScene } from './recruitmentScene'
import { currentProposal } from './recruitmentTypes'
import { estimateRecruitmentCost } from './recruitmentCost'
import type {
  RecruitmentSpec,
  RecruitmentSkill,
  RecruitmentSession,
} from './recruitmentTypes'
import './RecruitmentOffice.css'

const lines = (text: string) => text.split('\n')
const words = (text: string) => text.split(',')
const cleanList = (items: readonly string[]) =>
  items.map((item) => item.trim()).filter(Boolean)
const submittedSpec = (spec: RecruitmentSpec): RecruitmentSpec => ({
  ...spec,
  responsibilities: cleanList(spec.responsibilities),
  toolIds: cleanList(spec.toolIds),
  memoryScopes: cleanList(spec.memoryScopes),
  knowledgeIds: cleanList(spec.knowledgeIds),
  collaboratorIds: cleanList(spec.collaboratorIds),
  skills: spec.skills.map((skill) => ({
    ...skill,
    expectedIncludes: cleanList(skill.expectedIncludes),
  })),
})
const newSkill = (index = 1): RecruitmentSkill => ({
  id: `criterion-${index}`,
  description: '',
  mandatory: true,
  prompt: '',
  expectedIncludes: [],
})
const initialSpec = (): RecruitmentSpec => ({
  name: '',
  role: '',
  departmentId: 'engineering',
  mission: '',
  responsibilities: [],
  skills: [newSkill()],
  instructions: '',
  personality: 'Professional and evidence-driven',
  providerId: 'openai',
  modelId: 'gpt-6-astra',
  toolIds: ['provider.invoke'],
  memoryScopes: ['agent'],
  knowledgeIds: [],
  collaboratorIds: [],
  managerId: 'recruitment-manager',
  budgetMicros: 50_000,
  maxOutputUnits: 512,
  adapterMode: 'mock-success',
})
const stateLabel = (state: string) => state.replaceAll('_', ' ')

function ProposalFile({ session }: { session: RecruitmentSession }) {
  const { version, spec } = currentProposal(session)
  const estimate = useMemo(() => estimateRecruitmentCost(spec), [spec])
  return (
    <section aria-label="Recruitment file" className="recruitment-file">
      <h3>
        {spec.name} · {spec.role}
      </h3>
      <p>
        Proposal version {version} · approved version{' '}
        {session.approvedVersion ?? 'none'} · candidate {session.candidateId}
      </p>
      <p className="recruitment-mode">
        {spec.adapterMode === 'openai'
          ? 'Live provider assessment requested. Activation requires actual successful checks.'
          : `SIMULATION: ${spec.adapterMode}. This cannot prove real AI employee capability.`}
      </p>
      <dl>
        <dt>Department</dt>
        <dd>{spec.departmentId}</dd>
        <dt>Mission</dt>
        <dd>{spec.mission}</dd>
        <dt>Responsibilities</dt>
        <dd>{spec.responsibilities.join('; ') || 'None specified'}</dd>
        <dt>Instructions</dt>
        <dd>{spec.instructions || 'Not exposed in this view'}</dd>
        <dt>Personality</dt>
        <dd>{spec.personality}</dd>
        <dt>Model</dt>
        <dd>
          {spec.providerId} / {spec.modelId}
        </dd>
        <dt>Tools</dt>
        <dd>{spec.toolIds.join(', ') || 'No tools requested'}</dd>
        <dt>Memory boundaries</dt>
        <dd>{spec.memoryScopes.join(', ') || 'No memory requested'}</dd>
        <dt>Knowledge sources</dt>
        <dd>{spec.knowledgeIds.join(', ') || 'None'}</dd>
        <dt>Reports to</dt>
        <dd>{spec.managerId}</dd>
        <dt>Collaborators</dt>
        <dd>{spec.collaboratorIds.join(', ') || 'None'}</dd>
        <dt>Lifetime employee and onboarding budget</dt>
        <dd>
          {spec.budgetMicros} micro-USD · max {spec.maxOutputUnits} output
          units. This is a limit, not a quote or actual spend. The current cost
          policy estimates 13 input / 50 output microcredits per unit; it is not
          an invoice.
        </dd>
        <dt>Conservative onboarding estimate</dt>
        <dd>
          {estimate === null
            ? 'Unavailable; revise the resource limits before proceeding'
            : `${estimate} micro-USD${spec.adapterMode === 'openai' ? ' conservative upper estimate' : ' — simulated, no provider spending'}`}
          . Actual usage is recorded by the broker ledger; this calculation
          makes no provider call.
          {estimate !== null &&
            estimate > spec.budgetMicros &&
            ' Risk: the onboarding estimate exceeds the proposed budget.'}
        </dd>
        <dt>Workstation</dt>
        <dd>
          {session.workstationId ??
            'Not assigned; activation requires a free workstation'}
        </dd>
      </dl>
      <h4>Interview and assessment criteria</h4>
      <p>
        The host executes these explicit criteria. No conversational Manager
        reasoning or invented candidate answers are displayed.
      </p>
      <ul>
        {spec.skills.map((skill) => (
          <li key={skill.id}>
            <strong>{skill.description}</strong> (
            {skill.mandatory ? 'required' : 'optional'})
            <p>Question: {skill.prompt}</p>
            <p>
              Expected evidence:{' '}
              {skill.expectedIncludes.join(', ') || 'No criterion provided'}
            </p>
          </li>
        ))}
      </ul>
      <h4>Recorded assessments</h4>
      {!session.assessments.length ? (
        <p>No completed assessment is available.</p>
      ) : (
        <ul>
          {session.assessments.map((item) => (
            <li key={item.assessmentId}>
              {item.testId}: <strong>{item.status}</strong> · {item.mode} ·
              attempt {item.attempt}
              <ul>
                {item.evidence.map((evidence, index) => (
                  <li key={index}>{evidence}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <h4>Technical failures</h4>
      {!session.failures.length ? (
        <p>No technical failure recorded.</p>
      ) : (
        <ul>
          {session.failures.map((failure, index) => (
            <li key={index}>
              {failure.code} · {stateLabel(failure.stage)} ·{' '}
              {failure.retryable
                ? 'Retry permitted'
                : 'Manual intervention required'}
              . This is not evidence of insufficient skills.
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary>Approval and configuration history</summary>
        <ul>
          {session.approvals.map((approval, index) => (
            <li key={index}>
              v{approval.version}: {approval.decision} · {approval.actorId} ·{' '}
              {approval.reason} · {approval.occurredAt}
            </li>
          ))}
        </ul>
        <ul>
          {session.proposals.map((proposal) => (
            <li key={proposal.version}>
              Version {proposal.version} · {proposal.spec.name} /{' '}
              {proposal.spec.role} · {proposal.spec.adapterMode} ·{' '}
              {proposal.createdAt}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}

export default function RecruitmentOffice() {
  const [client] = useState(() => new RecruitmentClient())
  const state = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  )
  const connection = useSyncExternalStore(
    client.subscribe,
    client.getConnection,
    client.getConnection,
  )
  const [host, setHost] = useState<RecruitmentHostStatus | null>(null)
  const [notice, setNotice] = useState('Checking the local recruitment host.')
  const [busy, setBusy] = useState(false)
  const [spec, setSpec] = useState(initialSpec)
  const [editing, setEditing] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [workRequest, setWorkRequest] = useState('')
  const [focus, setFocus] = useState<{ id: string; version: number }>()
  const [spatialViews] = useState(() => ({
    current: new Map<string, AgentSpatialSnapshot>(),
  }))
  const [projectScene] = useState(createRecruitmentScene)
  const sceneViews = spatialViews.current
  const visitors = useMemo(
    () => projectScene(state, sceneViews),
    [projectScene, sceneViews, state],
  )
  const sessions = Object.values(state.recruitments)
  const session = (selected && state.recruitments[selected]) || sessions.at(-1)
  const employees = Object.values(state.employees)
  useEffect(() => {
    let active = true
    void Promise.resolve()
      .then(async () => {
        if (!active) return
        const status = await client.status()
        if (!active) return
        setHost(status)
        setNotice(
          status.configured
            ? 'Recruitment host available. CEO authentication is required.'
            : 'Host setup is incomplete. Configure CEO authentication on the host; do not enter provider secrets here.',
        )
        if (status.authenticated) await client.connect()
      })
      .catch(() => {
        if (active)
          setNotice(
            'Recruitment host unavailable. Start the configured local host; no employee has been created.',
          )
      })
    const resume = () => {
      if (client.getConnection().status !== 'disconnected') void client.resume()
    }
    const visible = () => {
      if (document.visibilityState === 'visible') resume()
    }
    window.addEventListener('online', resume)
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      client.disconnect()
      window.removeEventListener('online', resume)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [client])
  const run = async (
    operation: () => unknown | Promise<unknown>,
    success: string,
  ) => {
    setBusy(true)
    try {
      await operation()
      setNotice(success)
    } catch {
      setNotice(
        'The authenticated host rejected or could not complete this operation. No successful business outcome has been inferred. Inspect the recorded status and reconnect if needed.',
      )
    } finally {
      setBusy(false)
    }
  }
  const action = (input: RecruitmentAction) =>
    run(
      () => client.action(input),
      'Command accepted by the host. The office updates only from authoritative events.',
    )
  const update = <K extends keyof RecruitmentSpec>(
    key: K,
    value: RecruitmentSpec[K],
  ) => setSpec((current) => ({ ...current, [key]: value }))
  const selectVisitor = useCallback(
    (id: string) => {
      const recruitment = Object.values(client.getSnapshot().recruitments).find(
        (item) => item.candidateId === id,
      )
      if (recruitment) setSelected(recruitment.recruitmentId)
    },
    [client],
  )
  const visitorEvent = useCallback(
    (view: AgentSpatialSnapshot) => {
      const recruitment = Object.values(client.getSnapshot().recruitments).find(
        (item) => item.candidateId === view.agentId,
      )
      if (
        recruitment?.scene &&
        !recruitment.scene.arrived &&
        view.completedMotionId === recruitment.scene.intentId &&
        !view.diagnostic
      )
        void client.arrival(
          recruitment.recruitmentId,
          recruitment.scene.intentId,
        )
    },
    [client],
  )
  const login = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget,
      password = String(new FormData(form).get('password') ?? '')
    form.reset()
    void run(async () => {
      const status = await client.login(password)
      setHost(status)
      if (status.authenticated) await client.connect()
    }, 'CEO session authenticated. Current persisted office state was requested.')
  }
  if (!host?.authenticated)
    return (
      <section
        className="recruitment-panel"
        aria-labelledby="recruitment-heading"
      >
        <h2 id="recruitment-heading">CEO recruitment</h2>
        <p role="status">{notice}</p>
        <p>
          Recruitment is host-controlled. The browser cannot approve, hire or
          grant permissions without an authenticated CEO session.
        </p>
        {host?.configured && (
          <form onSubmit={login}>
            <label>
              CEO password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                maxLength={256}
              />
            </label>
            <button disabled={busy} type="submit">
              Sign in as CEO
            </button>
          </form>
        )}
        {!host?.configured && (
          <p>
            Configure the host as documented in the recruitment setup guide.
            Provider credentials belong only in the host environment.
          </p>
        )}
      </section>
    )
  return (
    <>
      <section
        className="recruitment-panel"
        aria-labelledby="recruitment-heading"
      >
        <div className="recruitment-title">
          <div>
            <h2 id="recruitment-heading">CEO recruitment</h2>
            <p>
              Signed in as {host.ceoId} · connection:{' '}
              <span data-testid="recruitment-connection">
                {connection.status}
              </span>
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await client.logout()
                setHost(await client.status())
              }, 'Signed out; the private office cache was cleared.')
            }
          >
            Sign out
          </button>
        </div>
        <p role="status" data-testid="recruitment-notice">
          {notice}
        </p>
        <p>
          Provider: {host.modelId} ·{' '}
          {host.openaiAvailable
            ? 'host configured; live calls may consume the approved budget'
            : 'not configured; live attempts remain a technical failure, never a skills rejection'}
          . Repository scanning, external integrations and unrestricted
          execution are not provisioned.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(
              () => client.connect(),
              'Requested authoritative synchronization.',
            )
          }
        >
          Reconnect office
        </button>
        <details
          open={editing !== null || !sessions.length}
          className="recruitment-request"
        >
          <summary>
            {editing
              ? 'Revise proposal — renewed approval required'
              : 'Request a new employee'}
          </summary>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void action(
                editing
                  ? {
                      action: 'revise',
                      recruitmentId: editing,
                      spec: submittedSpec(spec),
                    }
                  : { action: 'request', spec: submittedSpec(spec) },
              )
            }}
          >
            <div className="recruitment-fields">
              <label>
                Employee name
                <input
                  required
                  value={spec.name}
                  maxLength={100}
                  onChange={(event) => update('name', event.target.value)}
                />
              </label>
              <label>
                Job title
                <input
                  required
                  value={spec.role}
                  maxLength={160}
                  onChange={(event) => update('role', event.target.value)}
                />
              </label>
              <label>
                Department
                <select
                  aria-label="Department"
                  value={spec.departmentId}
                  onChange={(event) =>
                    update('departmentId', event.target.value)
                  }
                >
                  {Object.values(state.departments).map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Assessment adapter
                <select
                  aria-label="Assessment adapter"
                  value={spec.adapterMode}
                  onChange={(event) =>
                    update(
                      'adapterMode',
                      event.target.value as RecruitmentSpec['adapterMode'],
                    )
                  }
                >
                  <option value="mock-success">
                    SIMULATION · successful fixture
                  </option>
                  <option value="mock-capability-failure">
                    SIMULATION · capability failure fixture
                  </option>
                  <option value="mock-technical-failure">
                    SIMULATION · technical failure fixture
                  </option>
                  <option value="openai">
                    Live OpenAI · approved paid assessment
                  </option>
                </select>
              </label>
              <label>
                Mission
                <textarea
                  aria-label="Mission"
                  required
                  value={spec.mission}
                  maxLength={2000}
                  onChange={(event) => update('mission', event.target.value)}
                />
              </label>
              <label>
                Responsibilities (one per line)
                <textarea
                  aria-label="Responsibilities (one per line)"
                  required
                  value={spec.responsibilities.join('\n')}
                  onChange={(event) =>
                    update('responsibilities', lines(event.target.value))
                  }
                />
              </label>
              <label>
                Behavioral instructions
                <textarea
                  aria-label="Behavioral instructions"
                  required
                  value={spec.instructions}
                  maxLength={4000}
                  onChange={(event) =>
                    update('instructions', event.target.value)
                  }
                />
              </label>
              <label>
                Personality
                <input
                  value={spec.personality}
                  onChange={(event) =>
                    update('personality', event.target.value)
                  }
                />
              </label>
              <label>
                Provider/model
                <input
                  readOnly
                  value={`${spec.providerId} / ${spec.modelId}`}
                />
              </label>
              <label>
                Budget ceiling (micro-USD)
                <input
                  required
                  type="number"
                  min={1}
                  max={100000000}
                  step={1}
                  value={spec.budgetMicros}
                  onChange={(event) =>
                    update('budgetMicros', Number(event.target.value))
                  }
                />
              </label>
              <label>
                Maximum output units
                <input
                  required
                  type="number"
                  min={1}
                  max={16000}
                  step={1}
                  value={spec.maxOutputUnits}
                  onChange={(event) =>
                    update('maxOutputUnits', Number(event.target.value))
                  }
                />
              </label>
              <label>
                Requested tool IDs (comma-separated)
                <input
                  value={spec.toolIds.join(',')}
                  onChange={(event) =>
                    update('toolIds', words(event.target.value))
                  }
                />
              </label>
              <label>
                Memory scopes
                <input
                  value={spec.memoryScopes.join(',')}
                  onChange={(event) =>
                    update('memoryScopes', words(event.target.value))
                  }
                />
              </label>
              <label>
                Knowledge source IDs
                <input
                  value={spec.knowledgeIds.join(',')}
                  onChange={(event) =>
                    update('knowledgeIds', words(event.target.value))
                  }
                />
              </label>
              <label>
                Collaborator IDs
                <input
                  value={spec.collaboratorIds.join(',')}
                  onChange={(event) =>
                    update('collaboratorIds', words(event.target.value))
                  }
                />
              </label>
              <label>
                Reporting Manager
                <input readOnly value={spec.managerId} />
              </label>
            </div>
            <p>
              Currently supported: provider.invoke with broker permission
              checks; private agent memory; no external knowledge source.
              Unsupported requests are recorded and block activation rather than
              silently granting access.
            </p>
            {spec.skills.map((skill, index) => (
              <fieldset key={skill.id}>
                <legend>Capability criterion {index + 1}</legend>
                <label>
                  Skill requirement
                  <input
                    required
                    value={skill.description}
                    onChange={(event) =>
                      update(
                        'skills',
                        spec.skills.map((item, n) =>
                          n === index
                            ? { ...item, description: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Assessment question
                  <textarea
                    aria-label="Assessment question"
                    required
                    value={skill.prompt}
                    onChange={(event) =>
                      update(
                        'skills',
                        spec.skills.map((item, n) =>
                          n === index
                            ? { ...item, prompt: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Required response phrases (comma-separated)
                  <input
                    required
                    value={skill.expectedIncludes.join(',')}
                    onChange={(event) =>
                      update(
                        'skills',
                        spec.skills.map((item, n) =>
                          n === index
                            ? {
                                ...item,
                                expectedIncludes: words(event.target.value),
                              }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <label className="recruitment-checkbox">
                  <input
                    type="checkbox"
                    checked={skill.mandatory}
                    onChange={(event) =>
                      update(
                        'skills',
                        spec.skills.map((item, n) =>
                          n === index
                            ? { ...item, mandatory: event.target.checked }
                            : item,
                        ),
                      )
                    }
                  />
                  Mandatory criterion
                </label>
              </fieldset>
            ))}
            <div className="recruitment-actions">
              <button
                type="button"
                disabled={spec.skills.length >= 10}
                onClick={() =>
                  update('skills', [
                    ...spec.skills,
                    newSkill(spec.skills.length + 1),
                  ])
                }
              >
                Add criterion
              </button>
              <button type="submit" disabled={busy}>
                {editing
                  ? 'Submit revised proposal'
                  : 'Prepare recruitment proposal'}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(null)
                    setSpec(initialSpec())
                  }}
                >
                  Cancel editing
                </button>
              )}
            </div>
          </form>
        </details>
        <div className="recruitment-layout">
          <section aria-label="Recruitment history">
            <h3>Recruitment history</h3>
            {!sessions.length && <p>No recruitment requests yet.</p>}
            <ul>
              {sessions.map((item) => (
                <li key={item.recruitmentId}>
                  <button
                    type="button"
                    aria-pressed={session?.recruitmentId === item.recruitmentId}
                    onClick={() => {
                      setSelected(item.recruitmentId)
                      if (
                        visitors.some(
                          (visitor) => visitor.id === item.candidateId,
                        )
                      )
                        setFocus((previous) => ({
                          id: item.candidateId,
                          version: (previous?.version ?? 0) + 1,
                        }))
                    }}
                  >
                    {currentProposal(item).spec.name} · {stateLabel(item.state)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
          {session && (
            <section
              aria-label="Selected recruitment"
              data-testid="recruitment-selected"
            >
              <h3>Status: {stateLabel(session.state)}</h3>
              <p>
                Session {session.recruitmentId} · attempt {session.attempt}/
                {session.maxAttempts} · scene{' '}
                {session.scene?.phase ?? 'not started'}
              </p>
              <ProposalFile session={session} />
              <label>
                CEO decision / termination reason
                <textarea
                  aria-label="CEO decision / termination reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={1000}
                />
              </label>
              <div className="recruitment-actions">
                {session.state === 'pending_ceo_approval' && (
                  <>
                    {(['approve', 'changes', 'reject'] as const).map(
                      (decision) => (
                        <button
                          type="button"
                          key={decision}
                          disabled={busy || !reason.trim()}
                          onClick={() =>
                            void action({
                              action: 'decide',
                              recruitmentId: session.recruitmentId,
                              version: currentProposal(session).version,
                              decision,
                              reason,
                            })
                          }
                        >
                          {decision === 'approve'
                            ? 'Approve hire'
                            : decision === 'changes'
                              ? 'Request changes'
                              : 'Reject proposal'}{' '}
                          v{currentProposal(session).version}
                        </button>
                      ),
                    )}
                  </>
                )}
                {[
                  'pending_ceo_approval',
                  'changes_requested',
                  'approved',
                ].includes(session.state) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditing(session.recruitmentId)
                      setSpec(currentProposal(session).spec)
                    }}
                  >
                    Edit proposal
                  </button>
                )}
                {session.state === 'approved' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action({
                        action: 'start',
                        recruitmentId: session.recruitmentId,
                      })
                    }
                  >
                    Start approved interview
                  </button>
                )}
                {session.state === 'technical_failure' &&
                  session.failures.at(-1)?.retryable === true &&
                  session.attempt < session.maxAttempts && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void action({
                          action: 'retry',
                          recruitmentId: session.recruitmentId,
                        })
                      }
                    >
                      Retry technical failure
                    </button>
                  )}
                {!['hired', 'rejected', 'cancelled'].includes(
                  session.state,
                ) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void action({
                        action: 'cancel',
                        recruitmentId: session.recruitmentId,
                      })
                    }
                  >
                    Cancel recruitment
                  </button>
                )}
              </div>
            </section>
          )}
        </div>
        <section aria-label="Employee roster">
          <h3>Employee roster</h3>
          <p>
            Candidates are excluded until the host activates their approved
            configuration. Simulation entries are explicitly labeled.
          </p>
          {!employees.length && (
            <p>No recruited employees have been activated.</p>
          )}
          {employees.some(
            (employee) =>
              employee.status === 'active' && employee.mode === 'live',
          ) && (
            <label>
              Authorized employee work request
              <textarea
                maxLength={4000}
                value={workRequest}
                onChange={(event) => setWorkRequest(event.target.value)}
              />
            </label>
          )}
          <ul>
            {employees.map((employee) => (
              <li key={employee.employeeId}>
                <strong>{employee.versions.at(-1)?.spec.name}</strong> ·{' '}
                {employee.status} ·{' '}
                {employee.mode === 'simulation'
                  ? 'SIMULATION ONLY'
                  : 'live runtime'}{' '}
                · {employee.employeeId}
                {employee.status === 'active' && employee.mode === 'live' && (
                  <button
                    type="button"
                    disabled={busy || !workRequest.trim()}
                    onClick={() =>
                      void action({
                        action: 'employee-task',
                        employeeId: employee.employeeId,
                        prompt: workRequest,
                      })
                    }
                  >
                    Run approved employee request
                  </button>
                )}
                {employee.status === 'active' && (
                  <button
                    type="button"
                    onClick={() =>
                      void client.dispatch({
                        type: 'selectAgent',
                        agentId: employee.agentId,
                      })
                    }
                  >
                    Inspect employee
                  </button>
                )}
                {employee.status === 'active' && (
                  <button
                    type="button"
                    disabled={busy || !reason.trim()}
                    onClick={() =>
                      void action({
                        action: 'terminate',
                        employeeId: employee.employeeId,
                        reason,
                      })
                    }
                  >
                    Terminate with recorded reason
                  </button>
                )}
                {state.agents[employee.agentId]?.currentTaskId && (
                  <p>
                    Current task:{' '}
                    {
                      state.tasks[state.agents[employee.agentId].currentTaskId!]
                        ?.title
                    }{' '}
                    ·{' '}
                    {
                      state.tasks[state.agents[employee.agentId].currentTaskId!]
                        ?.status
                    }
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      </section>
      <RuntimeOffice
        runtime={client}
        visitors={visitors}
        spatialViews={spatialViews}
        onVisitorSelection={selectVisitor}
        onVisitorSpatialEvent={visitorEvent}
        visitorFocusRequest={focus}
        executionNotice={`Recruitment host ${connection.status}. Candidate presentation cannot authorize hiring; all decisions and assessments are persisted by the host.`}
      />
    </>
  )
}
