import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QAPreview from './QAPreview'
import { createQAPreviewSession, QA_PREVIEW as ids } from './qaFixtures'
import { AgentQAContext, TaskQAContext } from '../components/QAContextPanel'

vi.mock('../components/RuntimeOffice', () => ({
  RuntimeOffice: () => (
    <div data-testid="office-preserved">Existing runtime office</div>
  ),
}))
afterEach(cleanup)

async function prepared(
  mode: Parameters<typeof createQAPreviewSession>[0] = 'repair',
  passing = false,
) {
  const session = createQAPreviewSession(mode)
  session.connect()
  await session.begin()
  await session.write(passing)
  session.finish()
  return session
}
async function click(id: string) {
  fireEvent.click(screen.getByTestId(`qa-${id}`))
  await waitFor(() =>
    expect((screen.getByTestId('qa-reset') as HTMLButtonElement).disabled).toBe(
      false,
    ),
  )
}

describe('explicit development QA workflow', () => {
  it('starts empty and registers three distinct characters only after connection', () => {
    const session = createQAPreviewSession()
    try {
      expect(session.runtime.getSnapshot().connection).toBe('disconnected')
      expect(session.runtime.getSnapshot().events).toHaveLength(0)
      session.connect()
      const state = session.runtime.getSnapshot()
      expect(Object.keys(state.agents)).toHaveLength(3)
      expect(state.agents[ids.manager].kind).toBe('manager')
      expect(state.agents[ids.workerA].kind).toBe('standard-worker')
      expect(state.tasks).toEqual({})
      expect(state.selectedAgentId).toBeNull()
      expect(state.qaRequests).toEqual({})
      expect(state.memories).toEqual({})
    } finally {
      session.dispose()
    }
  })

  it('passes from an actual registered tool inspection and gates Manager completion', async () => {
    const session = await prepared('pass', true)
    try {
      expect(session.runtime.getSnapshot().selectedAgentId).toBeNull()
      expect(session.runtime.getSnapshot().tasks[ids.task].status).toBe(
        'completed',
      )
      expect(
        session.runtime.getSnapshot().tasks[ids.task].verification?.status,
      ).toBe('pending')
      expect(session.manager.getContext(ids.request).plan?.status).not.toBe(
        'completed',
      )
      const result = await session.runQA()
      const state = session.runtime.getSnapshot()
      expect(result.status).toBe('passed')
      expect(state.tasks[ids.task].verification?.status).toBe('verified')
      expect(session.manager.getContext(ids.request).plan?.status).toBe(
        'completed',
      )
      const evidence = result.result!.evidence[0]
      expect(state.toolExecutions[evidence.executionId].output).toMatchObject({
        artifactId: ids.artifact,
        content: expect.stringContaining('## Acceptance'),
      })
      expect(state.memories).toEqual({})
      const executions = Object.keys(state.toolExecutions).length
      await session.runQA()
      expect(
        Object.keys(session.runtime.getSnapshot().toolExecutions),
      ).toHaveLength(executions)
    } finally {
      session.dispose()
    }
  })

  it('retains failed history, repairs through a tool and writes only an explicit unverified lesson', async () => {
    const session = await prepared()
    try {
      await session.runQA()
      expect(session.latest()?.status).toBe('failed')
      expect(session.manager.getContext(ids.request).plan?.status).toBe(
        'needs_attention',
      )
      session.assignRepair()
      expect(session.repair()?.responsibleAgentId).toBe(ids.workerA)
      expect(session.runtime.getSnapshot().agents[ids.workerA].status).toBe(
        'repair',
      )
      await session.write(true)
      session.finish()
      session.recheck()
      await session.runQA()
      const state = session.runtime.getSnapshot()
      expect(Object.values(state.qaRequests).map((qa) => qa.status)).toEqual([
        'failed',
        'passed',
      ])
      expect(session.latest()?.previousQaId).toBe(ids.qa)
      expect(session.repair()?.status).toBe('completed')
      expect(state.memories).toEqual({})
      const lesson = session.lesson()
      expect(lesson.trust).toBe('unverified')
      expect(lesson.source.kind).toBe('tool')
      expect(lesson.verification).toBeNull()
      const context = session.context()
      expect(context.memories).toHaveLength(1)
      expect(context.memories[0].trust).toBe('unverified')
      expect(context.memories[0].source).toEqual(lesson.source)
    } finally {
      session.dispose()
    }
  })

  it('exhausts the one-repair scenario without another repair or misleading pass', async () => {
    const session = await prepared('exhaustion')
    try {
      await session.runQA()
      session.assignRepair()
      await session.write(false)
      session.finish()
      session.recheck()
      await session.runQA()
      const state = session.runtime.getSnapshot()
      expect(Object.keys(state.repairRequests)).toHaveLength(1)
      expect(state.tasks[ids.task].verification).toMatchObject({
        status: 'failed',
        needsAttention: true,
        repairAttempts: 1,
      })
      expect(session.manager.getContext(ids.request).plan?.status).toBe(
        'needs_attention',
      )
      expect(
        state.events.some((event) => event.type === 'REPAIR_EXHAUSTED'),
      ).toBe(true)
    } finally {
      session.dispose()
    }
  })

  it('blocks when the verifier lacks the explicit read grant and retains the denial as evidence', async () => {
    const session = await prepared('blocked', true)
    try {
      const result = await session.runQA()
      expect(result.status).toBe('blocked')
      expect(session.manager.getContext(ids.request).plan?.status).toBe(
        'needs_attention',
      )
      const state = session.runtime.getSnapshot()
      const verification = Object.values(state.toolExecutions).find(
        (item) => item.toolId === 'development.document.inspect',
      )!
      expect(verification.permission.allowed).toBe(false)
      expect(verification.output).toBeNull()
      expect(state.repairRequests).toEqual({})
    } finally {
      session.dispose()
    }
  })

  it('shows truthful task and agent context including factual execution references and retained attempts', async () => {
    const session = await prepared()
    try {
      await session.runQA()
      session.issue({ type: 'selectAgent', agentId: ids.manager })
      const select = vi.fn()
      render(
        <>
          <TaskQAContext
            state={session.runtime.getSnapshot()}
            taskId={ids.task}
          />
          <AgentQAContext
            state={session.runtime.getSnapshot()}
            onSelectTask={select}
          />
        </>,
      )
      expect(screen.getByTestId('qa-verification').textContent).toBe('failed')
      expect(screen.getByTestId('qa-task-context').textContent).toContain(
        'development.document.inspect',
      )
      expect(screen.getByTestId('qa-task-context').textContent).toContain(
        'Assertion did not match',
      )
      expect(screen.getByTestId('qa-agent-context').textContent).toContain(
        'Development Manager',
      )
      fireEvent.click(
        screen.getByRole('button', {
          name: 'Write the local QA development document',
        }),
      )
      expect(select).toHaveBeenCalledWith(ids.task)
      cleanup()
      render(
        <TaskQAContext
          state={session.runtime.getSnapshot()}
          taskId={session.repair()!.taskId}
        />,
      )
      expect(screen.getByTestId('qa-task-context').textContent).toContain(
        `Repair of original task: ${ids.task}`,
      )
      expect(screen.getByTestId('qa-verification').textContent).toBe('failed')
    } finally {
      session.dispose()
    }
  })

  it('uses visible explicit commands and clears old results on a new empty session', async () => {
    render(<QAPreview />)
    expect(screen.getByTestId('qa-summary').textContent).toContain(
      '0 QA attempts',
    )
    await click('connect')
    await click('begin')
    await click('write-passing')
    await click('complete')
    expect(screen.getByTestId('qa-source-verification').textContent).toBe(
      'pending',
    )
    await click('run')
    expect(screen.getByTestId('qa-source-verification').textContent).toBe(
      'verified',
    )
    expect(screen.getByTestId('qa-manager-status').textContent).toBe(
      'completed',
    )
    expect(screen.getByTestId('office-preserved')).toBeDefined()
    await click('reset')
    expect(screen.getByTestId('qa-summary').textContent).toContain(
      '0 QA attempts',
    )
    expect(screen.getByTestId('qa-result').textContent).toBe(
      'No operation result exposed.',
    )
  })
})
