import type { RuntimeAgent, RuntimeJson } from '../runtime/runtimeTypes'
import { publicToolJson, toolId } from './toolValidation'
import {
  ToolFault,
  type Tool,
  type ToolContext,
  type ToolDescriptor,
  type ToolGrant,
  type ToolPermissionDecision,
} from './toolTypes'

export interface RegisteredTool extends ToolDescriptor {
  parseInput(value: unknown): RuntimeJson
  parseOutput(value: unknown): RuntimeJson
  summarizeInput(value: RuntimeJson): RuntimeJson
  execute(value: RuntimeJson, context: ToolContext): Promise<RuntimeJson>
}

/** One host-owned registry. Registration is trusted application code, never request data. */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>()

  register<I extends RuntimeJson, O extends RuntimeJson>(
    tool: Tool<I, O>,
  ): void {
    toolId(tool.id)
    if (this.tools.has(tool.id))
      throw new ToolFault('DUPLICATE_TOOL', 'Tool is already registered.')
    if (
      !Number.isSafeInteger(tool.timeoutMs) ||
      tool.timeoutMs < 1 ||
      tool.timeoutMs > 120_000
    )
      throw new ToolFault(
        'INVALID_TOOL',
        'Tool timeout must be between 1 and 120000 milliseconds.',
      )
    const { inputSchema, outputSchema } = tool
    const execute = tool.execute.bind(tool)
    const summarizeInput = tool.summarizeInput.bind(tool)
    this.tools.set(
      tool.id,
      Object.freeze({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: tool.category,
        capabilities: Object.freeze([...tool.capabilities]),
        permissions: Object.freeze([...tool.permissions]),
        allowedKinds: Object.freeze([...tool.allowedKinds]),
        timeoutMs: tool.timeoutMs,
        metadata: Object.freeze(
          publicToolJson(tool.metadata) as Record<string, RuntimeJson>,
        ),
        parseInput: (value: unknown) => inputSchema.parse(value),
        parseOutput: (value: unknown) => outputSchema.parse(value),
        summarizeInput: (value: RuntimeJson) => summarizeInput(value as I),
        execute: (value: RuntimeJson, context: ToolContext) =>
          execute(value as I, context),
      }),
    )
  }

  unregister(id: string): boolean {
    return this.tools.delete(id)
  }
  lookup(id: string): RegisteredTool | undefined {
    return this.tools.get(id)
  }
  list(): readonly ToolDescriptor[] {
    return [...this.tools.values()].map(
      ({
        parseInput: _input,
        parseOutput: _output,
        summarizeInput: _summary,
        execute: _execute,
        ...descriptor
      }) => descriptor,
    )
  }

  checkCapability(
    toolId: string,
    agent: Readonly<RuntimeAgent>,
    grant?: ToolGrant,
  ): ToolPermissionDecision {
    const tool = this.lookup(toolId)
    const decision = (
      allowed: boolean,
      code: string,
      reason: string,
    ): ToolPermissionDecision => ({
      allowed,
      code,
      reason,
      requiredPermissions: tool?.permissions ?? [],
    })
    if (!tool) return decision(false, 'UNKNOWN_TOOL', 'Tool is not registered.')
    if (!tool.allowedKinds.includes(agent.kind))
      return decision(
        false,
        'AGENT_KIND_DENIED',
        'This agent kind is not allowed to use this tool.',
      )
    if (
      !tool.capabilities.every((capability) =>
        agent.capabilities.includes(capability),
      )
    )
      return decision(
        false,
        'CAPABILITY_DENIED',
        'Agent lacks a required tool capability.',
      )
    if (
      !grant?.toolIds.includes(toolId) ||
      !tool.permissions.every((permission) =>
        grant.permissions.includes(permission),
      )
    )
      return decision(
        false,
        'PERMISSION_DENIED',
        'Host has not granted this tool and its required permissions.',
      )
    return decision(
      true,
      'ALLOWED',
      'Explicit host grant and agent capabilities verified.',
    )
  }
}
