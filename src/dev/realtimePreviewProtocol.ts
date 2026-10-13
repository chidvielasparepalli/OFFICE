import type { RuntimeCommand } from '../runtime/runtimeTypes'

export const REALTIME_PREVIEW_ACTIONS = [
  'prepare',
  'start',
  'progress',
  'write',
  'artifact',
  'complete',
  'qa-request',
  'qa-run',
  'block',
  'resume',
  'handoff',
  'duplicate',
  'stale',
  'gap',
  'drop',
] as const
export type RealtimePreviewOperation = (typeof REALTIME_PREVIEW_ACTIONS)[number]
export type RealtimePreviewAction =
  | { action: RealtimePreviewOperation }
  | {
      action: 'feedback'
      command: Extract<
        RuntimeCommand,
        { type: 'selectAgent' | 'selectTask' | 'arrive' | 'rejectMovement' }
      >
    }
export interface RealtimePreviewHello {
  type: 'realtime-ready'
  sessionId: string
  streamId: string
}
