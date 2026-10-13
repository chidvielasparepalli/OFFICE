import { randomUUID } from 'node:crypto'
import { RealtimePublisher } from '../../src/realtime/RealtimePublisher'
import type { RealtimeEnvelope } from '../../src/realtime/realtimeTypes'
import { createRealtimeProjection } from '../realtime/publication'
import {
  ARTIFACT_PREVIEW as ids,
  createArtifactPreviewSession,
} from '../../src/dev/artifactFixtures'
import type { RealtimePreviewAction } from '../../src/dev/realtimePreviewProtocol'
import { InMemoryArtifactRepository } from '../../src/artifacts/InMemoryArtifactRepository'
import { ToolFault } from '../../src/tools/toolTypes'
import { isObsoletePreviewFeedback, validatePreviewFeedback } from './feedback'

/** The existing artifact fixture runs on the host. Transport faults never rewrite business records. */
export function createRealtimePreviewSession() {
  const fixture = createArtifactPreviewSession('pass')
  fixture.connect()
  const sessionId = randomUUID()
  const streamId = randomUUID()
  const runtime = fixture.runtime
  const publisher = new RealtimePublisher({
    runtime,
    streamId,
    project: createRealtimeProjection({
      principalAgentId: ids.manager,
      memoryPolicy: { grants: [] },
      artifactPolicy: { grants: [] },
    }),
  })
  const listeners = new Set<{
    message: (envelope: RealtimeEnvelope) => void
    closed: () => void
  }>()
  let last: RealtimeEnvelope = publisher.snapshot()
  let previous: RealtimeEnvelope | null = null
  let skipNext = false
  let disposed = false
  let busy = false
  let actions = 0
  const unsubscribe = publisher.subscribe(
    (envelope) => {
      previous = last
      last = envelope
      if (skipNext) {
        skipNext = false
        return
      }
      for (const listener of listeners) listener.message(envelope)
    },
    () => closeStreams(),
  )
  const closeStreams = () => {
    for (const listener of [...listeners]) listener.closed()
    listeners.clear()
  }
  const action = async (input: RealtimePreviewAction) => {
    if (disposed)
      throw new ToolFault('SESSION_CLOSED', 'The development session ended.')
    if (input.action === 'feedback') {
      if (isObsoletePreviewFeedback(runtime, input.command))
        return 'Ignored obsolete spatial feedback; the host intent already changed.'
      validatePreviewFeedback(runtime, input.command)
      fixture.issue(input.command)
      return 'Host accepted discrete selection or spatial feedback.'
    }
    if (busy)
      throw new ToolFault('BUSY', 'Wait for the current explicit operation.')
    if (++actions > 100)
      throw new ToolFault(
        'ACTION_LIMIT',
        'Reset the bounded development session.',
      )
    busy = true
    try {
      switch (input.action) {
        case 'prepare':
          await fixture.begin()
          break
        case 'start':
          fixture.start()
          break
        case 'progress': {
          const task = runtime.getSnapshot().tasks[ids.task]
          if (!task)
            throw new ToolFault(
              'TASK_REQUIRED',
              'Create the development task first.',
            )
          fixture.issue({
            type: 'updateProgress',
            taskId: ids.task,
            progressPercent: Math.min(95, task.progressPercent + 10),
          })
          break
        }
        case 'write':
          await fixture.write(true)
          break
        case 'artifact':
          fixture.createOutput()
          break
        case 'complete':
          fixture.finish()
          break
        case 'qa-request':
          fixture.requestQA()
          break
        case 'qa-run':
          await fixture.runQA()
          break
        case 'block':
          fixture.issue({
            type: 'blockTask',
            taskId: ids.task,
            reason:
              'Explicit development interruption for realtime delivery validation.',
          })
          break
        case 'resume':
          fixture.issue({ type: 'startTask', taskId: ids.task })
          break
        case 'handoff': {
          const artifact = fixture.latest()
          if (!artifact)
            throw new ToolFault(
              'ARTIFACT_REQUIRED',
              'Create an actual output first.',
            )
          const target = 'phase12-handoff-task'
          if (!runtime.getSnapshot().tasks[target]) {
            fixture.issue({
              type: 'createTask',
              task: {
                id: target,
                title: 'Inspect the explicitly handed-off development output',
                description:
                  'No task outcome or work is simulated. This record proves an accepted artifact input link.',
              },
            })
            fixture.issue({
              type: 'assignTask',
              taskId: target,
              agentId: ids.workerB,
            })
          }
          new InMemoryArtifactRepository(runtime, ids.manager).linkInput(
            target,
            artifact.artifactId,
          )
          break
        }
        case 'duplicate':
          for (const listener of listeners) {
            listener.message(last)
            listener.message(last)
          }
          break
        case 'stale':
          if (previous)
            for (const listener of listeners) listener.message(previous)
          break
        case 'gap': {
          // Skip one real committed selection transaction, then publish the next.
          const first =
            runtime.getSnapshot().selectedAgentId === ids.workerB
              ? ids.workerA
              : ids.workerB
          const second = first === ids.workerA ? ids.workerB : ids.workerA
          skipNext = true
          fixture.issue({ type: 'selectAgent', agentId: first })
          fixture.issue({ type: 'selectAgent', agentId: second })
          break
        }
        case 'drop':
          closeStreams()
          break
      }
      return `Explicit ${input.action} operation accepted by the host. No browser business reducer ran.`
    } finally {
      busy = false
    }
  }
  return {
    sessionId,
    streamId,
    runtime,
    action,
    snapshot: () => publisher.snapshot(),
    subscribe(
      message: (envelope: RealtimeEnvelope) => void,
      closed: () => void,
    ) {
      if (disposed)
        throw new ToolFault('SESSION_CLOSED', 'The development session ended.')
      const listener = { message, closed }
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getMetrics: () => ({
      streams: listeners.size,
      publisher: publisher.getMetrics(),
    }),
    async dispose() {
      disposed = true
      closeStreams()
      unsubscribe()
      publisher.dispose()
      fixture.dispose()
    },
  }
}
export type RealtimePreviewSession = ReturnType<
  typeof createRealtimePreviewSession
>
