import { useEffect, useState, useSyncExternalStore } from 'react'
import { RuntimeOffice } from '../components/RuntimeOffice'
import {
  createQAPreviewSession,
  QA_PREVIEW as ids,
  type QAPreviewMode,
} from './qaFixtures'

export default function QAPreview() {
  const [mode, setMode] = useState<QAPreviewMode>('repair')
  const [session, setSession] = useState(createQAPreviewSession)
  const { runtime } = session
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(
    'Connect explicitly. No tasks, QA results or repairs are preloaded.',
  )
  const [result, setResult] = useState<unknown>(null)
  useEffect(() => () => session.dispose(), [session])
  const connected = state.connection === 'local'
  const task = state.tasks[ids.task]
  const qa = session.latest()
  const repair = session.repair()
  const workerTask = state.tasks[state.agents[ids.workerA]?.currentTaskId ?? '']
  const manager = session.manager.getContext(ids.request)
  async function perform(action: () => unknown | Promise<unknown>) {
    setBusy(true)
    setResult(null)
    try {
      const value = await action()
      // Runtime snapshots are host state, not an agent context or document dump.
      setResult(
        value && typeof value === 'object' && 'events' in value
          ? { revision: runtime.getSnapshot().revision }
          : (value ?? null),
      )
      setNotice(
        'Explicit operation completed. QA outcomes come from registered tool evidence.',
      )
    } catch (error) {
      setNotice(
        error instanceof Error
          ? `${'code' in error ? error.code : 'REJECTED'}: ${error.message}`
          : 'Operation rejected.',
      )
    } finally {
      setBusy(false)
    }
  }
  function button(
    id: string,
    label: string,
    action: () => unknown,
    disabled = false,
  ) {
    return (
      <button
        type="button"
        data-testid={`qa-${id}`}
        disabled={!connected || busy || disabled}
        onClick={() => void perform(action)}
      >
        {label}
      </button>
    )
  }
  return (
    <>
      <p className="asset-preview-notice">
        QA development preview. The tools read and write a labelled in-memory
        document. The operator requests every execution and repair; no external
        work, autonomous repair or production fixtures.
      </p>
      <fieldset className="animation-preview-controls">
        <legend>Development session</legend>
        <label>
          Scenario{' '}
          <select
            data-testid="qa-mode"
            value={mode}
            disabled={busy}
            onChange={(event) => setMode(event.target.value as QAPreviewMode)}
          >
            <option value="repair">Fail → repair → recheck</option>
            <option value="pass">Pass</option>
            <option value="exhaustion">Retry exhaustion (one repair)</option>
            <option value="blocked">Blocked verifier permission</option>
          </select>
        </label>
        <button
          type="button"
          data-testid="qa-reset"
          disabled={busy}
          onClick={() => {
            setSession(createQAPreviewSession(mode))
            setResult(null)
            setNotice('Reset to an empty disconnected development session.')
          }}
        >
          Reset with selected scenario
        </button>
        <button
          type="button"
          data-testid="qa-connect"
          disabled={connected || busy}
          onClick={() => void perform(session.connect)}
        >
          Connect local QA runtime
        </button>
      </fieldset>
      <p role="status" data-testid="qa-notice">
        {notice}
      </p>
      <fieldset className="animation-preview-controls">
        <legend>1 — Manager request, worker output and completion</legend>
        {button('begin', 'Plan and start document task', session.begin, !!task)}
        {button(
          'write-failing',
          'Write document without required section',
          () => session.write(false),
          workerTask?.status !== 'in_progress',
        )}
        {button(
          'write-passing',
          'Write document with Acceptance section',
          () => session.write(true),
          workerTask?.status !== 'in_progress',
        )}
        {button(
          'complete',
          'Report worker task completed',
          session.finish,
          workerTask?.status !== 'in_progress',
        )}
        {button(
          'run',
          'Run explicit QA inspection',
          session.runQA,
          task?.status !== 'completed' || qa?.status !== 'queued',
        )}
      </fieldset>
      <fieldset className="animation-preview-controls">
        <legend>2 — Repair and independent recheck</legend>
        {button(
          'repair',
          'Assign and start capability-matched repair',
          session.assignRepair,
          repair?.status !== 'queued',
        )}
        {button(
          'recheck',
          'Request QA recheck',
          session.recheck,
          qa?.status !== 'failed' || repair?.status !== 'completed',
        )}
        {button(
          'lesson',
          'Explicitly remember repair lesson',
          session.lesson,
          qa?.status !== 'passed' ||
            repair?.status !== 'completed' ||
            !!state.memories[ids.lesson],
        )}
        {button(
          'context',
          'Retrieve lesson for later task',
          session.context,
          !state.memories[ids.lesson],
        )}
      </fieldset>
      <fieldset className="animation-preview-controls">
        <legend>Selection and inspection</legend>
        {button('worker', 'Focus author / repair worker', () =>
          session.issue({ type: 'selectAgent', agentId: ids.workerA }),
        )}
        {button('verifier', 'Focus verifier worker', () =>
          session.issue({ type: 'selectAgent', agentId: ids.workerB }),
        )}
        {button('manager', 'Focus Manager', () =>
          session.issue({ type: 'selectAgent', agentId: ids.manager }),
        )}
        {button(
          'task',
          'Inspect original task and QA history',
          () => session.issue({ type: 'selectTask', taskId: ids.task }),
          !task,
        )}
      </fieldset>
      <section aria-label="QA development status">
        <h2>Recorded workflow</h2>
        <p data-testid="qa-summary">
          {Object.keys(state.qaRequests).length} QA attempts ·{' '}
          {Object.keys(state.repairRequests).length} repairs ·{' '}
          {Object.keys(state.memories).length} memories
        </p>
        <dl>
          <dt>Worker task</dt>
          <dd data-testid="qa-source-status">
            {task?.status ?? 'Not created'}
          </dd>
          <dt>Verification</dt>
          <dd data-testid="qa-source-verification">
            {task?.verification?.status ?? 'Not available'}
          </dd>
          <dt>Latest QA</dt>
          <dd data-testid="qa-latest-status">
            {qa?.status ?? 'Not requested'}
          </dd>
          <dt>Repair</dt>
          <dd data-testid="qa-repair-status">
            {repair?.status ?? 'Not requested'}
          </dd>
          <dt>Manager plan</dt>
          <dd data-testid="qa-manager-status">
            {manager.plan?.status ?? 'Not planned'}
          </dd>
        </dl>
        <ol data-testid="qa-history">
          {Object.values(state.qaRequests).map((attempt) => (
            <li key={attempt.qaId}>
              {attempt.qaId}: {attempt.status} · attempt {attempt.attempt} ·
              previous {attempt.previousQaId ?? 'none'}
            </li>
          ))}
        </ol>
        <details>
          <summary>QA and repair event identifiers</summary>
          <pre
            data-testid="qa-events"
            style={{ maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap' }}
          >
            {JSON.stringify(
              state.events
                .filter(
                  (event) =>
                    event.type.startsWith('QA_') ||
                    event.type.startsWith('REPAIR_'),
                )
                .map((event) => ({
                  type: event.type,
                  taskId: event.taskId,
                  payload: event.payload,
                })),
              null,
              2,
            )}
          </pre>
        </details>
        <h3>Explicit operation result</h3>
        <pre
          data-testid="qa-result"
          style={{
            maxHeight: 300,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {result === null
            ? 'No operation result exposed.'
            : JSON.stringify(result, null, 2)}
        </pre>
      </section>
      <RuntimeOffice
        runtime={runtime}
        diagnostics
        executionNotice="Local QA development runtime. Characters visualize accepted runtime states; QA uses explicit tool evidence."
      />
    </>
  )
}
