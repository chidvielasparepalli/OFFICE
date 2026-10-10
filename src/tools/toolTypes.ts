import type { RuntimeAgent, RuntimeJson } from '../runtime/runtimeTypes'

export type ToolCategory =
  'filesystem' | 'terminal' | 'git' | 'research' | 'data' | 'validation'
export type ToolPermission = 'read' | 'write' | 'execute' | 'network' | 'git'
export type ToolExecutionStatus =
  'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ToolErrorData {
  readonly code: string
  readonly message: string
}

export interface ToolSchema<T> {
  readonly description: string
  /** Pure parsing/validation. Throw ToolFault on invalid input; never perform side effects. */
  parse(value: unknown): T
}

export class ToolFault extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface ToolDescriptor {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly category: ToolCategory
  readonly capabilities: readonly string[]
  readonly permissions: readonly ToolPermission[]
  readonly allowedKinds: readonly RuntimeAgent['kind'][]
  readonly timeoutMs: number
  readonly metadata: Readonly<Record<string, RuntimeJson>>
}

export interface ToolContext {
  readonly executionId: string
  readonly agentId: string
  readonly taskId: string
  readonly signal: AbortSignal
}

export interface Tool<
  I extends RuntimeJson = RuntimeJson,
  O extends RuntimeJson = RuntimeJson,
> extends ToolDescriptor {
  readonly inputSchema: ToolSchema<I>
  readonly outputSchema: ToolSchema<O>
  /** Explicitly safe audit summary; never include file bodies, credentials or environment. */
  summarizeInput(input: I): RuntimeJson
  execute(input: I, context: ToolContext): Promise<O>
}

/** Configured by the host, never accepted from browser request data. Default is no grant. */
export interface ToolGrant {
  readonly toolIds: readonly string[]
  readonly permissions: readonly ToolPermission[]
}

export interface ToolPermissionDecision {
  readonly allowed: boolean
  readonly code: string
  readonly reason: string
  readonly requiredPermissions: readonly ToolPermission[]
}

export interface ToolRequest {
  readonly executionId: string
  readonly agentId: string
  readonly taskId: string
  readonly toolId: string
  readonly input: unknown
}

export interface ToolExecutionResult {
  readonly executionId: string
  readonly agentId: string
  readonly taskId: string
  readonly toolId: string
  readonly status: ToolExecutionStatus
  readonly requestedAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
  readonly inputSummary: RuntimeJson
  readonly permission: Readonly<ToolPermissionDecision>
  /** Validated bounded public output. Implementations must not return host secrets. */
  readonly output: RuntimeJson
  readonly error: Readonly<ToolErrorData> | null
  readonly metadata: Readonly<Record<string, RuntimeJson>>
}

export type ToolRuntimeCommand =
  | {
      readonly type: 'requestToolExecution'
      readonly executionId: string
      readonly agentId: string
      readonly taskId: string
      readonly toolId: string
      readonly inputSummary: RuntimeJson
      readonly permission: ToolPermissionDecision
      readonly metadata?: Readonly<Record<string, RuntimeJson>>
    }
  | { readonly type: 'startToolExecution'; readonly executionId: string }
  | {
      readonly type: 'completeToolExecution'
      readonly executionId: string
      readonly output: RuntimeJson
    }
  | {
      readonly type: 'failToolExecution'
      readonly executionId: string
      readonly error: ToolErrorData
    }
  | {
      readonly type: 'cancelToolExecution'
      readonly executionId: string
      readonly reason: string
    }
