import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { RuntimeOffice } from '../components/RuntimeOffice'
import { ToolPreviewClient } from './toolPreviewClient'
import { providerCostSummary } from '../providers/costPolicy'
import {
  PROVIDER_PREVIEW_SCENARIOS,
  type ProviderPreviewScenario,
  type ToolPreviewAction,
} from './toolPreviewProtocol'
import './ManagerOrchestrationPreview.css'

const labels: Record<ProviderPreviewScenario, string> = {
  success: 'Successful deterministic provider call',
  denied: 'Provider permission denied',
  budget: 'Insufficient request budget',
  unavailable: 'Unavailable provider; fallback disabled',
  fallback: 'Explicit approved fallback',
  'all-unavailable': 'All approved providers unavailable',
  failed: 'Provider failure with unknown billing',
  'unsafe-response': 'Credential-like response rejected',
  'missing-credential': 'Missing host credential',
  'unknown-provider': 'Unknown provider rejected',
}

export default function ProviderCostPreview() {
  const [client] = useState(() => new ToolPreviewClient(fetch, 'providers'))
  const state = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  )
  const preview = useSyncExternalStore(
    client.subscribe,
    client.getPreview,
    client.getPreview,
  )
  const [scenario, setScenario] = useState<ProviderPreviewScenario>('success')
  const [notice, setNotice] = useState(
    'Disconnected. Connect explicitly to create a host-only deterministic provider session.',
  )
  const [pending, setPending] = useState(0)
  useEffect(() => () => client.dispose(), [client])
  const run = async (action?: ToolPreviewAction) => {
    setPending((count) => count + 1)
    try {
      setNotice(await (action ? client.action(action) : client.connect()))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Host action failed.')
    } finally {
      setPending((count) => count - 1)
    }
  }
  const connected = state.connection === 'local'
  const busy = pending > 0
  const task = preview?.taskId ? state.tasks[preview.taskId] : null
  const agent = task?.assignedAgentId
    ? state.agents[task.assignedAgentId]
    : null
  const ready =
    task?.status === 'in_progress' &&
    agent?.status === 'working' &&
    !agent.destination
  const execution = preview?.executionId
    ? state.toolExecutions[preview.executionId]
    : null
  const request = preview?.requestId ? state.requests[preview.requestId] : null
  const plan = request?.planId ? state.plans[request.planId] : null
  const records = useMemo(
    () => Object.values(state.providerRequests),
    [state.providerRequests],
  )
  const costs = useMemo(
    () => providerCostSummary(state.providerRequests),
    [state.providerRequests],
  )
  const budget = preview?.provider?.budget
  const remaining = budget
    ? BigInt(budget.globalLimitMicros) -
      BigInt(costs.chargedMicros) -
      BigInt(costs.reservedMicros)
    : null
  return (
    <>
      <section
        className="manager-preview-controls"
        data-testid="providers-preview-controls"
        aria-label="Development provider and credit controls"
      >
        <h2>Provider and credit development preview</h2>
        <p>
          Development only. Deterministic host adapters perform no network calls
          and spend no money. The existing ToolExecutor and host runtime enforce
          permissions and credit limits. Secrets remain on the host.
        </p>
        <div className="manager-preview-actions">
          <button
            data-testid="providers-connect"
            disabled={busy}
            onClick={() => void run()}
          >
            Connect / reset host session
          </button>
          <button
            data-testid="providers-disconnect"
            disabled={!connected}
            onClick={() => void run({ action: 'disconnect' })}
          >
            Disconnect
          </button>
          <button
            data-testid="providers-reconnect"
            disabled={connected || !preview || busy}
            onClick={() => void run({ action: 'reconnect' })}
          >
            Reconnect retained session
          </button>
        </div>
        <p role="status" data-testid="providers-notice">
          {notice}
        </p>
        <label>
          Explicit development scenario
          <select
            data-testid="providers-scenario"
            value={scenario}
            onChange={(event) =>
              setScenario(event.target.value as ProviderPreviewScenario)
            }
          >
            {PROVIDER_PREVIEW_SCENARIOS.map((value) => (
              <option key={value} value={value}>
                {labels[value]}
              </option>
            ))}
          </select>
        </label>
        <div className="manager-preview-actions">
          <button
            data-testid="providers-prepare"
            disabled={!connected || busy}
            onClick={() => void run({ action: 'provider-prepare', scenario })}
          >
            Manager: plan and dispatch
          </button>
          <button
            data-testid="providers-execute"
            disabled={!connected || busy || !ready}
            onClick={() => void run({ action: 'provider-execute' })}
          >
            Execute named provider request
          </button>
          <button
            data-testid="providers-artifact"
            disabled={!connected || busy || execution?.status !== 'completed'}
            onClick={() => void run({ action: 'provider-artifact' })}
          >
            Explicitly capture output artifact
          </button>
          <button
            data-testid="providers-memory"
            disabled={!connected || busy || execution?.status !== 'completed'}
            onClick={() => void run({ action: 'provider-memory' })}
          >
            Explicitly remember unverified finding
          </button>
          <button
            data-testid="providers-complete"
            disabled={!connected || busy || execution?.status !== 'completed'}
            onClick={() => void run({ action: 'complete' })}
          >
            Complete task explicitly
          </button>
          <button
            data-testid="providers-resume"
            disabled={!connected || busy || !task}
            onClick={() => void run({ action: 'resume' })}
          >
            Resume task explicitly
          </button>
          <button
            data-testid="providers-cancel"
            disabled={!connected || !task}
            onClick={() => void run({ action: 'cancel' })}
          >
            Cancel request
          </button>
        </div>
        <p>
          Provider success does not complete or verify a task. Artifact capture
          and memory writes are separate explicit commands. Memory remains
          unverified. Credit units are local accounting units, not a currency or
          a provider bill.
        </p>
        <p data-testid="providers-plan-status">
          Request: {request?.status ?? 'none'} · Plan: {plan?.status ?? 'none'}{' '}
          · Task: {task?.status ?? 'none'} · Worker: {agent?.status ?? 'none'}
        </p>
        <p data-testid="providers-budget">
          Budget: {budget?.globalLimitMicros ?? 'not connected'} · per request
          limit: {budget?.perRequestLimitMicros ?? 'not connected'} · charged:{' '}
          {costs.chargedMicros} · reserved: {costs.reservedMicros} · remaining:{' '}
          {remaining?.toString() ?? 'not connected'} {costs.unit} · unresolved
          requests: {costs.unresolvedRequests}
        </p>
        <div className="manager-preview-actions">
          {Object.values(state.agents).map((item) => (
            <button
              key={item.id}
              disabled={!connected}
              data-testid={`providers-focus-${item.id}`}
              onClick={() =>
                void client.dispatch({ type: 'selectAgent', agentId: item.id })
              }
            >
              Focus {item.name}
            </button>
          ))}
        </div>
        <details>
          <summary>Sanitized host configuration</summary>
          <ul data-testid="providers-configuration">
            {preview?.provider?.configuration.map((item) => (
              <li key={item.id}>
                {item.label}: {item.available ? 'available' : 'unavailable'};
                credential{' '}
                {item.credentialConfigured ? 'configured' : 'not configured'}
              </li>
            ))}
          </ul>
        </details>
        <details open>
          <summary>Provider request audit ({records.length})</summary>
          <div data-testid="providers-requests">
            {records.slice(-20).map((item) => (
              <article key={item.requestId}>
                <h3>
                  {item.selectedProviderId} / {item.selectedModelId} —{' '}
                  {item.status}
                </h3>
                <dl>
                  <dt>Agent / task</dt>
                  <dd>
                    {item.agentId} / {item.taskId}
                  </dd>
                  <dt>Estimate</dt>
                  <dd>
                    {item.estimateMicros} {item.unit}
                  </dd>
                  <dt>Actual recorded cost</dt>
                  <dd>
                    {item.actualMicros === null
                      ? 'Unknown / not recorded'
                      : `${item.actualMicros} ${item.unit}`}
                  </dd>
                  <dt>Charge state</dt>
                  <dd>{item.disposition}</dd>
                  <dt>Outcome</dt>
                  <dd>{item.errorCode ?? 'No error'}</dd>
                  <dt>Fallback reasons</dt>
                  <dd>{item.fallbackReasons.join(', ') || 'None'}</dd>
                </dl>
              </article>
            ))}
          </div>
        </details>
        <details>
          <summary>Credit ledger ({state.creditLedger.length})</summary>
          <div data-testid="providers-ledger">
            {state.creditLedger.slice(-30).map((item) => (
              <p key={item.ledgerId}>
                {item.kind}: {item.requestId} · reserved {item.reservedMicros} ·
                charged {item.chargedMicros} {item.unit}
              </p>
            ))}
          </div>
        </details>
        <details>
          <summary>Explicit artifacts and memories</summary>
          <ul data-testid="providers-captures">
            {Object.values(state.artifacts).map((item) => (
              <li key={item.artifactId}>
                Artifact: {item.name} · {item.status} · v{item.version} ·{' '}
                {item.content.sha256}
              </li>
            ))}
            {Object.values(state.memories).map((item) => (
              <li key={item.id}>
                Memory: {item.content} · {item.trust}
              </li>
            ))}
          </ul>
        </details>
        <details>
          <summary>Actual runtime activity</summary>
          <ol data-testid="providers-activity">
            {state.activities.slice(-30).map((item) => (
              <li key={item.id}>{item.summary}</li>
            ))}
          </ol>
        </details>
      </section>
      <RuntimeOffice
        runtime={client}
        diagnostics
        executionNotice="Host runtime connected — deterministic provider fixtures only. No external provider call or real spending is enabled."
      />
    </>
  )
}
