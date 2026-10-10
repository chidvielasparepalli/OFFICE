import { useState, useSyncExternalStore } from 'react'
import { RuntimeOffice } from '../components/RuntimeOffice'
import {
  createMemoryPreviewSession,
  MEMORY_PREVIEW as ids,
} from './memoryFixtures'

export default function MemoryPreview() {
  const [session, setSession] = useState(createMemoryPreviewSession)
  const { runtime, repositories, services } = session
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const [notice, setNotice] = useState(
    'Connect explicitly. No tasks or memories are preloaded.',
  )
  const [result, setResult] = useState<{
    revision: number
    value: unknown
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [budget, setBudget] = useState('6000')
  const connected = state.connection === 'local'
  const earlier = state.tasks[ids.earlierTask],
    later = state.tasks[ids.laterTask]
  const workerTask = state.agents[ids.workerA]?.currentTaskId
  const decision = state.memories[ids.decision]
  async function perform(action: () => unknown | Promise<unknown>) {
    setResult(null)
    setBusy(true)
    try {
      const value = await action()
      setResult({
        revision: runtime.getSnapshot().revision,
        value: value ?? null,
      })
      setNotice(
        'Explicit operation applied. Memory does not change task progress or agent status.',
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
        data-testid={`memory-${id}`}
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
        Memory development preview. Fixed examples only; no real research,
        provider, automatic learning or persistent database. The local operator
        controls principal selection; this is not production authentication.
      </p>
      <fieldset className="animation-preview-controls">
        <legend>Local memory connection</legend>
        <button
          type="button"
          data-testid="memory-connect"
          disabled={connected || busy}
          onClick={() => void perform(session.connect)}
        >
          Connect local memory runtime
        </button>
        {button('disconnect', 'Disconnect', () => {
          session.issue({ type: 'disconnect' })
          return { connection: 'disconnected' }
        })}
        <button
          type="button"
          data-testid="memory-reset"
          disabled={busy}
          onClick={() => {
            setSession(createMemoryPreviewSession())
            setResult(null)
            setNotice('Reset to an empty disconnected development session.')
          }}
        >
          Reset session
        </button>
      </fieldset>
      <p role="status" data-testid="memory-notice">
        {notice}
      </p>
      <fieldset className="animation-preview-controls">
        <legend>A / B — Preference and task history → later context</legend>
        {button(
          'preference',
          'Remember project preference',
          () =>
            session.write(ids.manager, {
              id: ids.preference,
              type: 'preference',
              reason: 'preference',
              content:
                'Development preference: preserve explicit task completion.',
              source: { kind: 'user', id: 'development-operator' },
              importance: 'high',
            }),
          !!state.memories[ids.preference],
        )}
        {button(
          'earlier',
          'Create and start earlier task',
          () => {
            session.begin(ids.earlierTask)
            return { taskId: ids.earlierTask }
          },
          !!earlier,
        )}
        {button(
          'complete',
          'Complete earlier task explicitly',
          () => {
            session.issue({ type: 'completeTask', taskId: ids.earlierTask })
            return { taskId: ids.earlierTask, status: 'completed' }
          },
          earlier?.status !== 'in_progress',
        )}
        {button(
          'lesson',
          'Remember completed-task lesson',
          () =>
            session.write(ids.workerA, {
              id: ids.lesson,
              type: 'episodic',
              reason: 'outcome',
              source: { kind: 'task', id: ids.earlierTask },
              content:
                'Development lesson: validate structured input before dispatch.',
            }),
          earlier?.status !== 'completed' || !!state.memories[ids.lesson],
        )}
        {button(
          'later',
          'Create and start later task',
          () => {
            session.begin(ids.laterTask)
            return { taskId: ids.laterTask }
          },
          earlier?.status !== 'completed' || !!later,
        )}
        <label>
          Context query{' '}
          <input
            data-testid="memory-query"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            maxLength={1000}
          />
        </label>
        <label>
          Character budget{' '}
          <input
            data-testid="memory-budget"
            type="number"
            min={2}
            max={16000}
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
          />
        </label>
        {button(
          'context',
          'Build later-task context',
          () =>
            services[ids.workerA].forTask({
              taskId: ids.laterTask,
              query,
              maxCharacters: Number(budget),
              limit: 8,
            }),
          !later,
        )}
      </fieldset>
      <fieldset className="animation-preview-controls">
        <legend>C — Worker-private memory and denied access</legend>
        {button(
          'private',
          'Remember Worker A private lesson',
          () =>
            session.write(ids.workerA, {
              id: ids.privateLesson,
              scope: { kind: 'agent', id: ids.workerA },
              type: 'semantic',
              reason: 'lesson',
              content:
                'Private development lesson: inspect the schema before assignment.',
            }),
          !!state.memories[ids.privateLesson],
        )}
        {button('recall-private', 'Worker A recalls its lesson', () =>
          repositories[ids.workerA].listByAgent(ids.workerA),
        )}
        {button(
          'deny-worker',
          'Worker B attempts private access',
          () => repositories[ids.workerB].get(ids.privateLesson),
          !state.memories[ids.privateLesson],
        )}
        {button(
          'deny-manager',
          'Manager attempts worker-private access',
          () => repositories[ids.manager].get(ids.privateLesson),
          !state.memories[ids.privateLesson],
        )}
      </fieldset>
      <fieldset className="animation-preview-controls">
        <legend>D / E — Manager decision and explicit supersession</legend>
        {button(
          'manager-task',
          'Start Manager review',
          () => {
            session.begin(ids.managerTask, ids.manager)
            return { taskId: ids.managerTask }
          },
          !!state.tasks[ids.managerTask],
        )}
        {button(
          'decision',
          'Remember Manager architecture decision',
          () =>
            session.write(ids.manager, {
              id: ids.decision,
              content:
                'Development decision: use the original naming convention.',
              importance: 'high',
            }),
          !!decision,
        )}
        {button(
          'manager-context',
          'Build Manager planning context',
          () => services[ids.manager].forTask({ taskId: ids.managerTask }),
          !state.tasks[ids.managerTask],
        )}
        {button(
          'supersede',
          'Supersede with revised convention',
          () =>
            repositories[ids.manager].supersede(
              ids.decision,
              decision.revision,
              {
                scope: decision.scope,
                type: 'project',
                source: { kind: 'manager', id: ids.manager },
                trust: 'observed',
                reason: 'decision',
                rationale:
                  'Explicit development replacement, preserving history.',
                content:
                  'Development decision: use the revised naming convention.',
                id: ids.revisedDecision,
                importance: 'high',
              },
            ),
          decision?.status !== 'active',
        )}
        {button('project', 'Retrieve active project memories', () =>
          repositories[ids.workerA].listByProject(ids.project, {
            maxCharacters: Number(budget),
          }),
        )}
      </fieldset>
      <fieldset className="animation-preview-controls">
        <legend>F — Tool evidence stays unverified</legend>
        {button(
          'research',
          'Run labelled research fixture',
          session.research,
          !workerTask ||
            state.tasks[workerTask]?.status !== 'in_progress' ||
            !!state.toolExecutions[ids.execution],
        )}
        {button(
          'finding',
          'Explicitly remember unverified finding',
          () =>
            session.write(ids.workerA, {
              id: ids.finding,
              type: 'semantic',
              reason: 'fact',
              trust: 'unverified',
              source: { kind: 'tool', id: ids.execution },
              content:
                'Development fixture only: no factual research was performed.',
            }),
          state.toolExecutions[ids.execution]?.status !== 'completed' ||
            !!state.memories[ids.finding],
        )}
        {button(
          'deny-verify',
          'Worker attempts unauthorized verification',
          () =>
            repositories[ids.workerA].update(
              ids.finding,
              state.memories[ids.finding].revision,
              {
                trust: 'verified',
                verificationEvidence: 'Unprivileged fixture assertion.',
              },
            ),
          !state.memories[ids.finding],
        )}
      </fieldset>
      <section aria-label="Memory operation result">
        <h2>Explicit operation result</h2>
        <p data-testid="memory-summary">
          {Object.keys(state.memories).length} memory records ·{' '}
          {Object.keys(state.tasks).length} tasks ·{' '}
          {
            state.events.filter((event) => event.type.startsWith('MEMORY_'))
              .length
          }{' '}
          memory events
        </p>
        {result && (
          <p>
            Captured at revision {result.revision}. Rebuild context after
            changes; this result is not a live query.
          </p>
        )}
        <pre
          data-testid="memory-result"
          style={{
            maxHeight: 320,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
          }}
        >
          {result
            ? JSON.stringify(result.value, null, 2)
            : 'No context exposed.'}
        </pre>
        <details>
          <summary>Recent memory audit (identifiers only)</summary>
          <pre
            data-testid="memory-audit"
            style={{ maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}
          >
            {JSON.stringify(
              state.events
                .filter((event) => event.type.startsWith('MEMORY_'))
                .slice(-12)
                .map((event) => ({
                  type: event.type,
                  agentId: event.agentId,
                  at: event.occurredAt,
                  payload: event.payload,
                })),
              null,
              2,
            )}
          </pre>
        </details>
      </section>
      <RuntimeOffice
        runtime={runtime}
        executionNotice="Local development memory runtime. Memory operations never drive character animation or invent work."
      />
    </>
  )
}
