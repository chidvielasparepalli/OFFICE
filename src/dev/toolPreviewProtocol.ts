import type { RuntimeCommand, RuntimeState } from '../runtime/runtimeTypes'
import type { ProviderBudgetPolicy } from '../providers/providerTypes'

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
export const PROVIDER_PREVIEW_SCENARIOS = [
  'success',
  'denied',
  'budget',
  'unavailable',
  'fallback',
  'all-unavailable',
  'failed',
  'unsafe-response',
  'missing-credential',
  'unknown-provider',
] as const
export type ProviderPreviewScenario =
  (typeof PROVIDER_PREVIEW_SCENARIOS)[number]
export type ToolPreviewMode = 'tools' | 'providers'
export type ToolPreviewAction =
  | { action: 'prepare'; scenario: ToolPreviewScenario }
  | { action: 'execute'; operation: ToolPreviewOperation }
  | { action: 'complete' | 'resume' | 'cancel' | 'disconnect' | 'reconnect' }
  | { action: 'provider-prepare'; scenario: ProviderPreviewScenario }
  | { action: 'provider-execute' | 'provider-artifact' | 'provider-memory' }
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
  provider?: {
    scenario: ProviderPreviewScenario | null
    budget: ProviderBudgetPolicy
    configuration: readonly {
      id: string
      label: string
      available: boolean
      credentialConfigured: boolean
    }[]
  }
}
export type ToolPreviewMessage =
  | { type: 'snapshot'; snapshot: ToolPreviewSnapshot }
  | { type: 'result'; ok: boolean; message: string }
  | { type: 'error'; code: string; message: string }
