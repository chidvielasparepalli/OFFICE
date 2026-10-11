/// <reference types="node" />
import { webcrypto } from 'node:crypto'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ArtifactPreview from './ArtifactPreview'
import {
  createArtifactPreviewSession,
  ARTIFACT_PREVIEW as ids,
} from './artifactFixtures'
import {
  AgentArtifactContext,
  TaskArtifactContext,
} from '../components/ArtifactContextPanel'
import { hashArtifactBytes } from '../artifacts/ArtifactStorage'

vi.mock('../components/RuntimeOffice', () => ({
  RuntimeOffice: () => (
    <div data-testid="office-preserved">Existing runtime office</div>
  ),
}))
beforeEach(() => vi.stubGlobal('crypto', webcrypto))
afterEach(cleanup)

async function started(
  mode: Parameters<typeof createArtifactPreviewSession>[0] = 'repair',
  dispatch = true,
) {
  const session = createArtifactPreviewSession(mode)
  session.connect()
  await session.begin()
  if (dispatch) session.start()
  return session
}
async function produce(
  session: ReturnType<typeof createArtifactPreviewSession>,
  passing = true,
) {
  await session.write(passing)
  return session.createOutput()
}

describe('explicit development artifact workflows', () => {
  it('begins empty and registers the existing separate worker and Manager models only on connection', () => {
    const session = createArtifactPreviewSession()
    try {
      expect(session.runtime.getSnapshot().artifacts).toEqual({})
      expect(session.runtime.getSnapshot().connection).toBe('disconnected')
      expect(session.runtime.getSnapshot().events).toHaveLength(0)
      session.connect()
      const state = session.runtime.getSnapshot()
      expect(state.agents[ids.workerA].kind).toBe('standard-worker')
      expect(state.agents[ids.manager].kind).toBe('manager')
      expect(state.selectedAgentId).toBeNull()
      expect(state.tasks).toEqual({})
      expect(state.artifacts).toEqual({})
    } finally {
      session.dispose()
    }
  })

  it('does not turn tool output into an artifact until explicitly registered', async () => {
    const session = await started('simple')
    try {
      const receipt = await session.write(true)
      expect(session.runtime.getSnapshot().artifacts).toEqual({})
      const item = session.createOutput()
      expect(item.source.executionId).toBe(receipt.executionId)
      expect(item.source.taskId).toBe(ids.task)
      expect(item.agentId).toBe(ids.workerA)
      expect(item.role).toBe('output')
      expect(item.content.sha256).toBe(
        await hashArtifactBytes(await session.artifacts.read(item.artifactId)),
      )
      session.finish()
      expect(session.latest()?.status).toBe('completed')
      expect(session.latest()?.verifiedByQA).toBeNull()
      expect(
        session.runtime.getSnapshot().tasks[ids.task].outputArtifactIds,
      ).toEqual([item.artifactId])
    } finally {
      session.dispose()
    }
  })

  it('verifies immutable output from real tool reads and gates the Manager result', async () => {
    const session = await started('pass')
    try {
      const item = await produce(session)
      session.requestQA()
      session.finish()
      expect(session.manager.getContext(ids.request).plan?.status).not.toBe(
        'completed',
      )
      const qa = await session.runQA()
      expect(qa.status).toBe('passed')
      expect(qa.artifactBinding).toEqual({
        artifactId: item.artifactId,
        version: 1,
        sha256: item.content.sha256,
      })
      const state = session.runtime.getSnapshot()
      expect(state.artifacts[item.artifactId].status).toBe('verified')
      expect(state.artifacts[item.artifactId].verifiedByQA).toBe(qa.qaId)
      expect(session.manager.getContext(ids.request).plan?.status).toBe(
        'completed',
      )
      expect(
        session.manager.getContext(ids.request).result?.artifacts,
      ).toHaveLength(1)
      const evidence = qa.result!.evidence[0]
      expect(state.toolExecutions[evidence.executionId].output).toMatchObject({
        artifact: qa.artifactBinding,
        content: expect.stringContaining('## Acceptance'),
      })
      expect(state.memories).toEqual({})
    } finally {
      session.dispose()
    }
  })

  it('preserves v1 bytes/failure while canonical repair produces v2 and independent QA pass', async () => {
    const session = await started()
    try {
      const first = await produce(session, false)
      const bytes = await session.artifacts.read(first.artifactId)
      session.requestQA()
      session.finish()
      const failed = await session.runQA()
      expect(failed.status).toBe('failed')
      session.assignRepair()
      const repair = session.repair()!
      const second = await produce(session, true)
      expect(second.version).toBe(2)
      expect(second.supersedesArtifactId).toBe(first.artifactId)
      expect(second.source.taskId).toBe(repair.taskId)
      expect(second.taskId).toBe(ids.task)
      session.finish()
      session.recheck()
      const passed = await session.runQA()
      const state = session.runtime.getSnapshot()
      expect(passed.status).toBe('passed')
      expect(passed.previousQaId).toBe(failed.qaId)
      expect(passed.artifactId).toBe(second.artifactId)
      expect(state.qaRequests[failed.qaId]).toEqual(failed)
      expect(state.artifacts[first.artifactId].status).toBe('superseded')
      expect(state.artifacts[second.artifactId].status).toBe('verified')
      expect(await session.artifacts.read(first.artifactId)).toEqual(bytes)
      expect(second.content.sha256).not.toBe(first.content.sha256)
    } finally {
      session.dispose()
    }
  })

  it('requires two independent output verifications before Manager completion', async () => {
    const session = await started('multiple')
    try {
      const first = await produce(session)
      session.requestQA()
      const second = await produce(session)
      session.requestQA()
      expect(second.lineageId).not.toBe(first.lineageId)
      session.finish()
      await session.runQA()
      expect(session.manager.getContext(ids.request).plan?.status).not.toBe(
        'completed',
      )
      await session.runQA()
      const state = session.runtime.getSnapshot()
      expect(state.artifacts[first.artifactId].status).toBe('verified')
      expect(state.artifacts[second.artifactId].status).toBe('verified')
      expect(Object.values(state.qaRequests)).toHaveLength(2)
      expect(session.manager.getContext(ids.request).plan?.status).toBe(
        'completed',
      )
      expect(
        session.manager.getContext(ids.request).result?.artifacts,
      ).toHaveLength(2)
    } finally {
      session.dispose()
    }
  })

  it('detects missing expected output without inventing an artifact or verification', async () => {
    const session = await started('missing')
    try {
      session.finish()
      const context = session.manager.getContext(ids.request)
      expect(session.runtime.getSnapshot().artifacts).toEqual({})
      expect(session.runtime.getSnapshot().qaRequests).toEqual({})
      expect(context.plan?.status).toBe('needs_attention')
      expect(
        context.plan?.issues.some((item) => item.code.includes('OUTPUT')),
      ).toBe(true)
      expect(context.result?.artifacts).toEqual([])
    } finally {
      session.dispose()
    }
  })

  it('links imported input without claiming worker production and rejects unrelated private reads', async () => {
    const session = await started('access', false)
    try {
      const input = await session.importInput()
      session.start()
      const output = await produce(session)
      expect(input.role).toBe('input')
      expect(input.source.kind).toBe('user')
      expect(input.agentId).toBeNull()
      expect(
        session.runtime.getSnapshot().tasks[ids.task].inputArtifactIds,
      ).toEqual([input.artifactId])
      expect(
        session.runtime.getSnapshot().tasks[ids.task].outputArtifactIds,
      ).toEqual([output.artifactId])
      const before = session.runtime.getSnapshot()
      expect(() => session.deniedRead()).toThrow()
      expect(session.runtime.getSnapshot()).toBe(before)
      expect(session.author.canRead(output.artifactId)).toBe(true)
    } finally {
      session.dispose()
    }
  })

  it('shows bounded metadata, actual provenance and truthful restricted context without content', async () => {
    const session = await started('access')
    try {
      const item = await produce(session)
      session.issue({ type: 'selectAgent', agentId: ids.workerA })
      const state = session.runtime.getSnapshot()
      render(
        <>
          <TaskArtifactContext
            state={state}
            taskId={ids.task}
            canRead={(id) => session.author.canRead(id)}
          />
          <AgentArtifactContext
            state={state}
            canRead={(id) => session.author.canRead(id)}
          />
        </>,
      )
      expect(screen.getByTestId('artifact-task-context').textContent).toContain(
        item.content.sha256,
      )
      expect(
        screen.getByTestId('artifact-agent-context').textContent,
      ).toContain(item.source.executionId)
      expect(
        screen.getByTestId('artifact-task-context').textContent,
      ).not.toContain('Explicit immutable output for local validation.')
      cleanup()
      render(
        <TaskArtifactContext
          state={state}
          taskId={ids.task}
          canRead={() => false}
        />,
      )
      expect(screen.getByTestId('artifact-task-context').textContent).toContain(
        'No artifacts accessible',
      )
      expect(
        screen.getByTestId('artifact-task-context').textContent,
      ).not.toContain(item.content.sha256)
    } finally {
      session.dispose()
    }
  })

  it('exposes explicit controls and clears the old session on reset', async () => {
    render(<ArtifactPreview />)
    const click = async (id: string) => {
      fireEvent.click(screen.getByTestId(`artifact-${id}`))
      await waitFor(() =>
        expect(
          (screen.getByTestId('artifact-reset') as HTMLButtonElement).disabled,
        ).toBe(false),
      )
      expect(screen.getByTestId('artifact-notice').textContent).not.toMatch(
        /^[A-Z_]+:/,
      )
    }
    expect(screen.getByTestId('artifact-summary').textContent).toContain(
      '0 artifact versions',
    )
    await click('connect')
    await click('begin')
    await click('start')
    await click('write-passing')
    await click('create')
    await click('request-qa')
    await click('complete')
    await click('run')
    expect(screen.getByTestId('artifact-output-status').textContent).toBe(
      'v1: verified',
    )
    expect(screen.getByTestId('artifact-manager-status').textContent).toBe(
      'completed',
    )
    expect(screen.getByTestId('office-preserved')).toBeDefined()
    await click('reset')
    expect(screen.getByTestId('artifact-summary').textContent).toContain(
      '0 artifact versions',
    )
    expect(screen.getByTestId('artifact-result').textContent).toBe(
      'No operation result exposed.',
    )
  })

  it('keeps the latest output visible when a task has more than twenty historical versions', async () => {
    const session = await started('simple')
    try {
      for (let version = 1; version <= 21; version++) await produce(session)
      const state = session.runtime.getSnapshot()
      render(
        <TaskArtifactContext
          state={state}
          taskId={ids.task}
          canRead={(id) => session.author.canRead(id)}
        />,
      )
      expect(
        screen.queryByTestId('artifact-detail-phase10-document-v1'),
      ).toBeNull()
      expect(
        screen.getByTestId('artifact-detail-phase10-document-v21'),
      ).toBeDefined()
      expect(
        screen.getByTestId('artifact-task-context').querySelectorAll('details'),
      ).toHaveLength(20)
    } finally {
      session.dispose()
    }
  })
})
