import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { RuntimeOffice } from '../components/RuntimeOffice'
import { RealtimePreviewClient } from './realtimePreviewClient'
import type { RealtimePreviewOperation } from './realtimePreviewProtocol'
import './ManagerOrchestrationPreview.css'

/** Explicit local operator controls. Business records always arrive from the host projection. */
export default function RealtimePreview() {
  const [client] = useState(() => new RealtimePreviewClient())
  const state = useSyncExternalStore(
    client.subscribe,
    client.getSnapshot,
    client.getSnapshot,
  )
  const view = useSyncExternalStore(
    client.subscribe,
    client.getView,
    client.getView,
  )
  const connection = useSyncExternalStore(
    client.subscribe,
    client.getConnection,
    client.getConnection,
  )
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(
    'Disconnected. Connect explicitly to the guarded local host.',
  )
  const [metrics, setMetrics] = useState<object | null>(null)
  // disconnect is reusable during React StrictMode's development effect rehearsal.
  useEffect(() => () => client.disconnect(), [client])
  useEffect(() => {
    const resume = () => {
      const connection = client.getConnection()
      if (connection.status !== 'disconnected' && connection.revision !== null)
        void client.resume()
    }
    const visible = () => {
      if (document.visibilityState === 'visible') resume()
    }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('online', resume)
    return () => {
      document.removeEventListener('visibilitychange', visible)
      window.removeEventListener('online', resume)
    }
  }, [client])
  const tasks = useMemo(() => Object.values(state.tasks), [state.tasks])
  const artifacts = useMemo(
    () => Object.values(state.artifacts),
    [state.artifacts],
  )
  const task = state.tasks['phase10-document-task']
  const worker = state.agents['phase5-worker-a']
  const qa = useMemo(
    () => Object.values(state.qaRequests).at(-1),
    [state.qaRequests],
  )
  const hasSession = Object.keys(state.agents).length > 0
  const active = task?.status === 'in_progress'
  const run = async (
    operation: () => unknown | Promise<unknown>,
    message?: string,
  ) => {
    setBusy(true)
    try {
      const result = await operation()
      setNotice(
        typeof result === 'string'
          ? result
          : (message ?? 'Realtime connection action completed.'),
      )
    } catch {
      setNotice(
        'The named local operation was rejected or unavailable. No optimistic business state was applied.',
      )
    } finally {
      setBusy(false)
    }
  }
  const button = (
    action: RealtimePreviewOperation,
    label: string,
    disabled = false,
  ) => (
    <button
      type="button"
      data-testid={`realtime-${action}`}
      disabled={busy || !hasSession || disabled}
      onClick={() => void run(() => client.action({ action }))}
    >
      {label}
    </button>
  )
  return (
    <>
      <section
        className="manager-preview-controls"
        aria-label="Development realtime controls"
        data-testid="realtime-preview-controls"
      >
        <h2>Realtime development preview</h2>
        <p>
          A local host owns this disposable runtime. One guarded stream
          publishes a filtered snapshot and ordered transactions. The browser
          projects them into the existing office. No external realtime service,
          provider call or production data is connected.
        </p>
        <div className="manager-preview-actions">
          <button
            type="button"
            data-testid="realtime-connect"
            disabled={busy}
            onClick={() =>
              void run(
                () => client.reset(),
                'Connected to a new disposable host runtime.',
              )
            }
          >
            Connect / reset host session
          </button>
          <button
            type="button"
            data-testid="realtime-disconnect"
            disabled={connection.status === 'disconnected'}
            onClick={() => {
              client.disconnect()
              setNotice(
                'Stream disconnected. Last known state is retained; the host remains authoritative.',
              )
            }}
          >
            Disconnect stream
          </button>
          <button
            type="button"
            data-testid="realtime-reconnect"
            disabled={busy || !hasSession}
            onClick={() =>
              void run(
                () => client.reconnect(),
                'Requested a fresh snapshot and retained host subscription.',
              )
            }
          >
            Reconnect / resynchronize
          </button>
        </div>
        <p role="status" data-testid="realtime-notice">
          {notice}
        </p>
        <p data-testid="realtime-connection">
          Connection: {connection.status} · revision:{' '}
          {connection.revision ?? 'none'} · error: {connection.error ?? 'none'}
        </p>
        <p>
          Authority: fixed development Manager. Selecting a worker does not
          change the publication audience. Last-known records are visible during
          disconnection and are not presented as current.
        </p>
        <div className="manager-preview-actions">
          {button('prepare', 'Manager: create request and plan', !!task)}
          {button(
            'start',
            'Manager: dispatch worker',
            !task || active || task.status === 'completed',
          )}
          {button('progress', 'Host: record explicit progress', !active)}
          {button(
            'write',
            'Worker: execute document tool',
            !active || !!worker?.destination,
          )}
          {button('artifact', 'Explicitly register output artifact', !active)}
          {button(
            'qa-request',
            'Manager: request artifact QA',
            artifacts.length === 0 || !!qa,
          )}
          {button('complete', 'Worker: report completion', !active)}
          {button(
            'qa-run',
            'Run approved QA check',
            task?.status !== 'completed' || qa?.status !== 'queued',
          )}
          {button('block', 'Host: block task', !active)}
          {button('resume', 'Host: resume task', task?.status !== 'blocked')}
          {button(
            'handoff',
            'Manager: link output to next task',
            artifacts.length === 0 || view.handoffs.length > 0,
          )}
        </div>
        <p data-testid="realtime-task-state">
          Task: {task?.status ?? 'none'} · progress:{' '}
          {task?.progressPercent ?? 0}% · worker: {worker?.status ?? 'none'} ·
          QA: {qa?.status ?? 'not available'}
        </p>
        <p>
          Progress and completion are explicit development commands. Tool output
          is actual in-memory content; artifact registration and QA remain
          separate operations. Disconnecting does not fabricate completion.
        </p>
        <fieldset>
          <legend>Explicit delivery faults</legend>
          <p>
            Replay duplicates/stale envelopes, skip one accepted transaction, or
            close the stream. These faults affect delivery only.
          </p>
          <div className="manager-preview-actions">
            {button('duplicate', 'Replay duplicate')}
            {button('stale', 'Replay older envelope')}
            {button('gap', 'Skip one transaction')}
            {button('drop', 'Drop stream; bounded reconnect')}
          </div>
        </fieldset>
        <button
          type="button"
          data-testid="realtime-counters"
          onClick={() => setMetrics(client.getMetrics())}
        >
          Sample transport counters
        </button>
        {metrics && (
          <pre data-testid="realtime-metrics">
            {JSON.stringify(metrics, null, 2)}
          </pre>
        )}
        <h3>Host records</h3>
        <p data-testid="realtime-record-counts">
          Agents: {Object.keys(state.agents).length} · tasks: {tasks.length} ·
          artifacts: {artifacts.length} · events: {state.events.length} ·
          activities: {state.activities.length}
        </p>
        <ul data-testid="realtime-artifacts">
          {artifacts.slice(-20).map((artifact) => (
            <li key={artifact.artifactId}>
              {artifact.name} · {artifact.artifactId} · v{artifact.version} ·{' '}
              {artifact.status} · task {artifact.taskId ?? 'input'} · agent{' '}
              {artifact.agentId ?? 'user'} · QA{' '}
              {artifact.verifiedByQA ?? 'not verified'}
            </li>
          ))}
        </ul>
        <h3>Accepted-event notifications</h3>
        <ul data-testid="realtime-notifications">
          {view.notifications.slice(-20).map((notification) => (
            <li key={notification.id}>
              {notification.severity}: {notification.text} · event{' '}
              {notification.eventId}
            </li>
          ))}
        </ul>
        {!view.notifications.length && (
          <p>No accepted notification event has been published.</p>
        )}
        <h3>Artifact handoffs</h3>
        <ul data-testid="realtime-handoffs">
          {view.handoffs.slice(-20).map((handoff) => (
            <li key={handoff.id}>
              {handoff.artifactId} · {handoff.fromTaskId ?? 'input'} →{' '}
              {handoff.toTaskId}
            </li>
          ))}
        </ul>
        <p data-testid="realtime-costs">
          Credit summary: charged {view.costs.chargedMicros} · reserved{' '}
          {view.costs.reservedMicros}. This document scenario performs no
          provider call.
        </p>
      </section>
      <RuntimeOffice
        runtime={client}
        diagnostics
        executionNotice={`Host realtime ${connection.status}. Development commands only; no autonomous execution.`}
      />
    </>
  )
}
