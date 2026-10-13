import { randomUUID } from 'node:crypto'
import { createOfficeRuntime } from '../../src/runtime/officeRuntime'
import type { RuntimeResult } from '../../src/runtime/runtimeTypes'
import { ManagerOrchestrator } from '../../src/orchestration/ManagerOrchestrator'
import { DeterministicPlanner } from '../../src/orchestration/planner'
import { ToolRegistry } from '../../src/tools/ToolRegistry'
import { ToolExecutor } from '../../src/tools/ToolExecutor'
import { ToolFault, type ToolExecutionResult } from '../../src/tools/toolTypes'
import { InMemoryArtifactStorage } from '../../src/artifacts/ArtifactStorage'
import { InMemoryArtifactRepository } from '../../src/artifacts/InMemoryArtifactRepository'
import { ArtifactService } from '../../src/artifacts/ArtifactService'
import type { ProviderExecutionResult } from '../../src/providers/providerTypes'
import type {
  ProviderPreviewScenario,
  ToolPreviewAction,
  ToolPreviewSnapshot,
} from '../../src/dev/toolPreviewProtocol'
import { ProviderRegistry } from '../providers/ProviderRegistry'
import { ProviderBroker } from '../providers/ProviderBroker'
import { InMemorySecretStore } from '../providers/SecretStore'
import { IDS, registrations } from './fixtures'
import { validatePreviewFeedback } from './feedback'

function accepted(result: RuntimeResult) {
  if (!result.ok) throw new ToolFault(result.error.code, result.error.message)
}

/** Explicit host-only fixtures. No adapter performs network I/O or spends money. */
export async function createProviderPreviewSession() {
  const sessionId = randomUUID()
  const storage = new InMemoryArtifactStorage()
  const budget = {
    unit: 'credit-micros' as const,
    globalLimitMicros: 100000,
    perAgentLimitMicros: 50000,
    perTaskLimitMicros: 10000,
    perRequestLimitMicros: 5000,
    requestQuota: 100,
  }
  const runtime = createOfficeRuntime({
    artifactStorage: storage,
    providerBudgetPolicy: budget,
  })
  accepted(runtime.dispatch({ type: 'connect' }))
  for (const command of registrations()) {
    if (command.type === 'registerAgent' && command.agent.id === IDS.research)
      accepted(
        runtime.dispatch({
          ...command,
          agent: {
            ...command.agent,
            name: 'Development Provider Worker',
            role: 'Explicit deterministic provider fixture',
            capabilities: ['text'],
          },
        }),
      )
    else accepted(runtime.dispatch(command))
  }
  const secrets = new InMemorySecretStore({
    'preview-only': 'phase11-host-only-synthetic-value-4fa72b93',
  })
  const registry = new ProviderRegistry()
  const descriptors = [
    { id: 'fixture-primary', status: 'available', fallbacks: [] },
    { id: 'fixture-alternate', status: 'available', fallbacks: [] },
    { id: 'fixture-denied', status: 'available', fallbacks: [] },
    {
      id: 'fixture-unavailable',
      status: 'unavailable',
      fallbacks: [{ providerId: 'fixture-alternate', modelId: 'fixture-text' }],
    },
    {
      id: 'fixture-all-unavailable',
      status: 'unavailable',
      fallbacks: [
        { providerId: 'fixture-unavailable', modelId: 'fixture-text' },
      ],
    },
    { id: 'fixture-failed', status: 'available', fallbacks: [] },
    { id: 'fixture-unsafe', status: 'available', fallbacks: [] },
    { id: 'fixture-missing', status: 'available', fallbacks: [] },
  ] as const
  for (const item of descriptors)
    registry.register({
      descriptor: {
        ...item,
        displayName: item.id,
        enabled: true,
        capabilities: ['text'],
        models: [
          {
            id: 'fixture-text',
            capabilities: ['text'],
            pricing: { inputMicrosPerUnit: 2, outputMicrosPerUnit: 3 },
            maxInputUnits: 4096,
            maxOutputUnits: 512,
          },
        ],
      },
      secretReference:
        item.id === 'fixture-missing' ? 'not-configured' : 'preview-only',
      adapter: {
        execute: async ({ credential }) =>
          item.id === 'fixture-failed'
            ? { status: 'failed', output: null, usage: null }
            : {
                status: 'completed',
                output: {
                  text:
                    item.id === 'fixture-unsafe'
                      ? credential
                      : 'Explicit deterministic development output: preserve source and verify before relying on this finding.',
                },
                usage: { inputUnits: 10, outputUnits: 20 },
              },
      },
    })
  const broker = new ProviderBroker({
    runtime,
    registry,
    secrets,
    storage,
    grants: [
      {
        agentId: IDS.research,
        providerIds: descriptors
          .filter((item) => item.id !== 'fixture-denied')
          .map((item) => item.id),
        capabilities: ['text'],
      },
    ],
  })
  const tools = new ToolRegistry()
  tools.register(broker.createTool())
  const executor = new ToolExecutor({
    runtime,
    registry: tools,
    grants: {
      [IDS.research]: {
        toolIds: ['provider.invoke'],
        permissions: ['network'],
      },
    },
  })
  const manager = new ManagerOrchestrator({
    runtime,
    managerId: IDS.manager,
    planner: new DeterministicPlanner((request) => ({
      planId: `${request.requestId}:plan`,
      requestId: request.requestId,
      objective: request.title,
      constraints: [...request.constraints],
      expectedOutputs: [],
      tasks: [
        {
          id: `${request.requestId}:task`,
          title: 'Explicit provider development task',
          description:
            'Use one named host fixture through the ToolExecutor. Success is not verification.',
          requiredCapabilities: ['text'],
          dependencyIds: [],
          priority: 'normal',
          status: 'queued',
          preferredAgentId: IDS.research,
        },
      ],
    })),
  })
  manager.start()
  const artifacts = new ArtifactService(
    new InMemoryArtifactRepository(runtime, IDS.research),
    storage,
  )
  let scenario: ProviderPreviewScenario | null = null
  let requestId: string | null = null
  let taskId: string | null = null
  let executionId: string | null = null
  let pendingExecution: Promise<ToolExecutionResult> | null = null
  let preparing = false
  let disposed = false
  let counter = 0
  const snapshot = (): ToolPreviewSnapshot => ({
    sessionId,
    state: runtime.getSnapshot(),
    scenario: null,
    requestId,
    taskId,
    executionId,
    provider: {
      scenario,
      budget,
      configuration: registry.list().map((item) => ({
        id: item.id,
        label: item.displayName,
        available: item.enabled && item.status === 'available',
        credentialConfigured: secrets.has(
          registry.lookup(item.id)!.secretReference,
        ),
      })),
    },
  })
  async function action(input: ToolPreviewAction): Promise<string> {
    if (disposed)
      throw new ToolFault(
        'SESSION_CLOSED',
        'This development session has ended.',
      )
    if (input.action === 'feedback') {
      validatePreviewFeedback(runtime, input.command)
      accepted(runtime.dispatch(input.command))
      return 'Host accepted discrete scene feedback.'
    }
    if (input.action === 'cancel') {
      if (pendingExecution && executionId) {
        executor.cancel(executionId)
        return 'Cancellation requested.'
      }
      if (requestId)
        accepted(
          manager.cancelRequest(
            requestId,
            'Explicit development cancellation.',
          ),
        )
      return 'Request cancelled explicitly.'
    }
    if (input.action === 'disconnect') {
      if (pendingExecution && executionId) executor.cancel(executionId)
      accepted(runtime.dispatch({ type: 'disconnect' }))
      return 'Disconnected; retained provider records are inactive.'
    }
    if (input.action === 'reconnect') {
      accepted(runtime.dispatch({ type: 'connect' }))
      return 'Reconnected to the same host session.'
    }
    if (preparing || pendingExecution || executor.getMetrics().activeExecutions)
      throw new ToolFault(
        'BUSY',
        'Wait for the current host operation to finish.',
      )
    if (runtime.getSnapshot().connection !== 'local')
      throw new ToolFault('DISCONNECTED', 'Connect before sending a command.')
    if (counter >= 100)
      throw new ToolFault(
        'SESSION_LIMIT',
        'Reset the development session before creating more records.',
      )
    if (input.action === 'provider-prepare') {
      if (
        taskId &&
        !['completed', 'failed', 'cancelled'].includes(
          runtime.getSnapshot().tasks[taskId].status,
        )
      )
        throw new ToolFault(
          'ACTIVE_TASK',
          'Complete or cancel the current scenario before preparing another.',
        )
      preparing = true
      try {
        scenario = input.scenario
        requestId = `phase11-request-${++counter}`
        taskId = `${requestId}:task`
        executionId = null
        accepted(
          manager.receiveRequest({
            requestId,
            title: `Development ${scenario} provider scenario`,
            description:
              'Explicit deterministic adapter scenario. No live provider calls or spending.',
            requestedBy: 'Development preview user',
            priority: 'normal',
            constraints: [
              'No network provider',
              'No automatic task completion',
              'No automatic artifact or memory capture',
            ],
          }),
        )
        accepted(await manager.planRequest(requestId))
        const dispatch = manager.dispatchReady(requestId)
        if (!dispatch.ok)
          throw new ToolFault(
            'DISPATCH_FAILED',
            'The development task could not be assigned.',
          )
        accepted(runtime.dispatch({ type: 'selectTask', taskId }))
        accepted(
          runtime.dispatch({ type: 'selectAgent', agentId: IDS.research }),
        )
        return 'Manager planned and dispatched the explicit provider task.'
      } finally {
        preparing = false
      }
    }
    if (!taskId || !scenario)
      throw new ToolFault('NO_TASK', 'Prepare a provider scenario first.')
    if (input.action === 'resume') {
      accepted(runtime.dispatch({ type: 'startTask', taskId }))
      return 'Task resumed explicitly.'
    }
    const execution = executionId
      ? runtime.getSnapshot().toolExecutions[executionId]
      : null
    if (input.action === 'complete') {
      if (execution?.status !== 'completed')
        throw new ToolFault(
          'OUTPUT_REQUIRED',
          'A successful provider result is required before explicit completion.',
        )
      accepted(runtime.dispatch({ type: 'completeTask', taskId }))
      return 'Task completed explicitly. No QA verification was claimed.'
    }
    if (
      input.action === 'provider-artifact' ||
      input.action === 'provider-memory'
    ) {
      if (execution?.status !== 'completed')
        throw new ToolFault(
          'OUTPUT_REQUIRED',
          'Execute a successful provider request before capturing its output.',
        )
      const output = execution.output as unknown as ProviderExecutionResult
      if (input.action === 'provider-artifact') {
        if (!output.content)
          throw new ToolFault(
            'CONTENT_REQUIRED',
            'This provider result has no immutable content receipt.',
          )
        artifacts.create({
          artifactId: `${executionId}:artifact`,
          name: 'Development provider output',
          description:
            'Explicitly captured deterministic provider output. QA has not verified it.',
          type: 'report',
          role: 'output',
          outputRole: 'finding',
          taskId,
          scope: { kind: 'task', id: taskId },
          status: 'completed',
          source: { kind: 'tool', executionId: execution.executionId },
          content: output.content,
        })
        return 'Output artifact captured explicitly; status completed, not verified.'
      }
      accepted(
        runtime.dispatch({
          type: 'createMemory',
          agentId: IDS.research,
          memory: {
            id: `${executionId}:memory`,
            scope: { kind: 'task', id: taskId },
            type: 'episodic',
            content: JSON.stringify(output.output),
            trust: 'unverified',
            source: { kind: 'tool', id: execution.executionId },
            importance: 'normal',
            reason: 'fact',
            rationale:
              'Explicitly retained development finding; no independent verification exists.',
          },
        }),
      )
      return 'Provider finding retained explicitly with unverified tool provenance.'
    }
    if (input.action !== 'provider-execute')
      throw new ToolFault(
        'ACTION_DENIED',
        'This session accepts only named provider actions.',
      )
    const agent = runtime.getSnapshot().agents[IDS.research]
    if (agent.status !== 'working' || agent.destination)
      throw new ToolFault(
        'WORKER_NOT_READY',
        'Wait for the worker to reach the assigned workstation.',
      )
    const providerIds: Record<ProviderPreviewScenario, string> = {
      success: 'fixture-primary',
      denied: 'fixture-denied',
      budget: 'fixture-primary',
      unavailable: 'fixture-unavailable',
      fallback: 'fixture-unavailable',
      'all-unavailable': 'fixture-all-unavailable',
      failed: 'fixture-failed',
      'unsafe-response': 'fixture-unsafe',
      'missing-credential': 'fixture-missing',
      'unknown-provider': 'fixture-unknown',
    }
    executionId = `phase11-execution-${++counter}`
    try {
      pendingExecution = executor.execute({
        executionId,
        agentId: IDS.research,
        taskId,
        toolId: 'provider.invoke',
        input: {
          providerId: providerIds[scenario],
          modelId: 'fixture-text',
          capability: 'text',
          input: {
            prompt:
              'Return one explicitly labelled deterministic development finding.',
          },
          maxOutputUnits: 128,
          maxCostMicros: scenario === 'budget' ? 1 : 5000,
          allowFallback:
            scenario === 'fallback' || scenario === 'all-unavailable',
        },
      })
      const result = await pendingExecution
      return `Provider tool ${result.status}${result.error ? ` (${result.error.code})` : ''}. Task completion remains explicit.`
    } finally {
      pendingExecution = null
    }
  }
  return {
    sessionId,
    runtime,
    snapshot,
    action,
    cancelRunning: () => {
      if (pendingExecution && executionId) executor.cancel(executionId)
    },
    dispose: async () => {
      disposed = true
      executor.dispose()
      manager.dispose()
      await pendingExecution?.catch(() => undefined)
    },
  }
}
