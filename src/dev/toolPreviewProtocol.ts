import type { RuntimeCommand, RuntimeState } from '../runtime/runtimeTypes'

export type ToolPreviewScenario =
  'research' | 'coding' | 'git' | 'denied' | 'timeout'
export type ToolPreviewOperation =
  | 'research'
  | 'read'
  | 'terminal'
  | 'git-status'
  | 'git-diff'
  | 'git-add'
  | 'git-commit'
  | 'denied'
  | 'timeout'
  | 'cancellable'
export type ToolPreviewAction =
  | { action: 'prepare'; scenario: ToolPreviewScenario }
  | { action: 'execute'; operation: ToolPreviewOperation }
  | { action: 'complete' | 'resume' | 'cancel' | 'disconnect' | 'reconnect' }
  | {
      action: 'feedback'
      command: Extract<
        RuntimeCommand,
        { type: 'selectAgent' | 'selectTask' | 'arrive' | 'rejectMovement' }
      >
    }
export interface ToolPreviewSnapshot {
  sessionId: string
  state: RuntimeState
  scenario: ToolPreviewScenario | null
  taskId: string | null
  requestId: string | null
  executionId: string | null
}
export type ToolPreviewMessage =
  | { type: 'snapshot'; snapshot: ToolPreviewSnapshot }
  | { type: 'result'; ok: boolean; message: string }
  | { type: 'error'; code: string; message: string }
