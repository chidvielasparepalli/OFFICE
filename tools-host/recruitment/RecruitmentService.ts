import { randomUUID } from 'node:crypto'
import {
  createOfficeRuntime,
  type OfficeRuntime,
} from '../../src/runtime/officeRuntime'
import type {
  OfficeRuntimeRepository,
  RuntimeCommand,
  RuntimeJson,
} from '../../src/runtime/runtimeTypes'
import { officeAssets } from '../../src/assets/officeAssets'
import {
  seatedWorkstationAnchor,
  standingWorkstationAnchor,
} from '../../src/office/characterMotion'
import type { WorldPosition } from '../../src/office/officeState'
import {
  currentProposal,
  RECRUITMENT_MANAGER_INTERVIEW_POSITION,
  recruitmentInstructions,
  type RecruitmentScene,
  type RecruitmentSession,
  type RecruitmentSpec,
  type RecruitmentState,
} from '../../src/recruitment/recruitmentTypes'
import { recruitmentAssert } from '../../src/recruitment/recruitmentPolicy'
import { validateRealtimePublicData } from '../../src/realtime/realtimeValidation'
import { MemoryService } from '../../src/memory/MemoryService'
import { InMemoryMemoryRepository } from '../../src/memory/InMemoryMemoryRepository'
import { serializeMemoryContext } from '../../src/memory/memoryRetrieval'
import { ToolExecutor } from '../../src/tools/ToolExecutor'
import { ToolRegistry } from '../../src/tools/ToolRegistry'
import { ToolFault } from '../../src/tools/toolTypes'
import { ProviderBroker } from '../providers/ProviderBroker'
import {
  ProviderRegistry,
  type ProviderAdapter,
} from '../providers/ProviderRegistry'
import { InMemorySecretStore } from '../providers/SecretStore'
import type { ProviderExecutionResult } from '../../src/providers/providerTypes'
import {
  OpenAIResponsesAdapter,
  RECRUITMENT_MODEL,
} from './OpenAIResponsesAdapter'

export const RECRUITMENT_MANAGER = 'recruitment-manager'
const SERVICE = 'recruitment-service'
const ENTRANCE: WorldPosition = [0, 0, 17]
const INTERVIEW: WorldPosition = [-0.8, 0, 10]
const MANAGER_INTERVIEW: WorldPosition = RECRUITMENT_MANAGER_INTERVIEW_POSITION
const safeStates = new Set([
  'requested',
  'pending_ceo_approval',
  'changes_requested',
  'approved',
  'technical_failure',
  'pending_retry',
  'hired',
  'rejected',
  'cancelled',
])
const fault = (code: string) =>
  new ToolFault(
    code,
    'Recruitment could not proceed. Review the recorded status and approved configuration.',
  )

/** One durable canonical runtime; this service only holds in-flight execution handles. */
export class RecruitmentService {
  readonly runtime: OfficeRuntime
  readonly secrets: InMemorySecretStore
  readonly ceoId: string
  readonly openaiAvailable: boolean
  private readonly adapter: ProviderAdapter
  private readonly jobs = new Map<string, Promise<void>>()
  private readonly executors = new Map<ToolExecutor, string>()
  private disposed = false

  constructor(options: {
    repository: OfficeRuntimeRepository
    ceoId: string
    credential?: string
    adapter?: ProviderAdapter
    globalBudgetMicros?: number
  }) {
    this.ceoId = options.ceoId
    this.openaiAvailable = !!options.credential
    this.secrets = new InMemorySecretStore(
      options.credential ? { 'openai-host': options.credential } : {},
    )
    this.adapter = options.adapter ?? new OpenAIResponsesAdapter()
    const limit = options.globalBudgetMicros ?? 1_000_000
    recruitmentAssert(
      Number.isSafeInteger(limit) && limit >= 0 && limit <= 100_000_000,
      'INVALID_BUDGET',
      'Configure a bounded integer local spending limit.',
    )
    this.runtime = createOfficeRuntime({
      repository: options.repository,
      recruitmentPolicy: {
        ceoIds: [this.ceoId],
        managerIds: [RECRUITMENT_MANAGER],
        serviceIds: [SERVICE],
      },
      providerBudgetPolicy: {
        unit: 'credit-micros',
        globalLimitMicros: limit,
        perAgentLimitMicros: limit,
        perTaskLimitMicros: limit,
        perRequestLimitMicros: limit,
      },
    })
    this.issue({ type: 'connect' })
    this.initializeOffice()
    // A crash can leave paid execution uncertain. Never replay it or release its liability implicitly.
    for (const request of Object.values(
      this.runtime.getSnapshot().providerRequests,
    ))
      if (request.status === 'reserved')
        this.issue({
          type: 'settleProviderRequest',
          requestId: request.requestId,
          status: 'failed',
          disposition: 'unknown',
          errorCode: 'PROVIDER_RECONCILIATION_REQUIRED',
        })
    for (const execution of Object.values(
      this.runtime.getSnapshot().toolExecutions,
    ))
      if (['queued', 'running'].includes(execution.status))
        this.issue({
          type: 'cancelToolExecution',
          executionId: execution.executionId,
          reason: 'Host restarted; execution was not replayed.',
        })
    for (const task of Object.values(this.runtime.getSnapshot().tasks))
      if (
        typeof task.metadata.recruitmentId === 'string' &&
        !['completed', 'failed', 'cancelled'].includes(task.status)
      )
        this.issue({
          type: 'cancelTask',
          taskId: task.id,
          reason:
            'Host restarted; retained work requires an explicit new authorization.',
        })
    for (const session of Object.values(
      this.runtime.getSnapshot().recruitments,
    )) {
      if (!safeStates.has(session.state))
        this.fail(session.recruitmentId, 'HOST_RESTARTED')
    }
    this.resumeCommittedEmployeeArrivals()
  }

  private resumeCommittedEmployeeArrivals() {
    for (const session of Object.values(
      this.runtime.getSnapshot().recruitments,
    )) {
      const state = this.runtime.getSnapshot(),
        employee = state.employees[session.candidateId],
        agent = state.agents[session.candidateId]
      if (
        session.state !== 'hired' ||
        employee?.status !== 'active' ||
        !agent ||
        agent.destination ||
        (session.scene?.phase === 'workstation' && session.scene.arrived)
      )
        continue
      const desk = agent.workstationId
        ? state.workstations[agent.workstationId]
        : null
      if (!desk) continue
      const destination = standingWorkstationAnchor(desk),
        atDesk = [destination, seatedWorkstationAnchor(desk)].some(
          (point) =>
            Math.hypot(...point.map((n, i) => n - agent.position[i])) < 0.03,
        )
      // Activation is already durable. Recover only its interrupted presentation;
      // do not recreate identity, reassess capabilities or replay provider work.
      if (session.scene?.phase !== 'workstation')
        this.scene(
          session.recruitmentId,
          'workstation',
          agent.position,
          destination,
          atDesk,
        )
      else if (atDesk)
        this.issue({
          type: 'arriveRecruitmentScene',
          actorId: SERVICE,
          recruitmentId: session.recruitmentId,
          intentId: session.scene.intentId,
        })
      if (!atDesk)
        this.issue({
          type: 'requestMovement',
          agentId: agent.id,
          destinationType: 'workstation',
          destinationId: desk.id,
          movementReason:
            'Resume the activated employee arrival after host recovery.',
          arrivalStatus: 'waiting',
        })
    }
  }

  private initializeOffice() {
    for (const zone of officeAssets.warehouse.layout.departments) {
      if (!this.runtime.getSnapshot().departments[zone.id])
        this.issue({
          type: 'registerDepartment',
          department: {
            id: zone.id,
            name: zone.name,
            description: 'Authored open-office department.',
          },
        })
      const executive = zone.id === 'executive'
      const desk = {
        id: `recruitment-desk-${zone.id}`,
        departmentId: zone.id,
        position: [
          zone.position[0],
          0,
          zone.position[2] + (executive ? 0.82 : 0.72),
        ] as WorldPosition,
        headingRadians: 0,
      }
      if (!this.runtime.getSnapshot().workstations[desk.id])
        this.issue({ type: 'registerWorkstation', workstation: desk })
      if (executive && !this.runtime.getSnapshot().agents[RECRUITMENT_MANAGER])
        this.issue({
          type: 'registerAgent',
          agent: {
            id: RECRUITMENT_MANAGER,
            name: 'Manager',
            role: 'CEO-approved recruitment coordinator',
            kind: 'manager',
            departmentId: zone.id,
            capabilities: ['structured'],
            status: 'waiting',
            workstationId: desk.id,
            position: seatedWorkstationAnchor(desk),
            headingRadians: 0,
          },
        })
    }
  }
  private issue(command: RuntimeCommand) {
    const result = this.runtime.dispatch(command)
    if (!result.ok) throw fault(result.error.code)
  }
  private session(id: string): RecruitmentSession {
    const session = this.runtime.getSnapshot().recruitments[id]
    if (!session) throw fault('RECRUITMENT_NOT_FOUND')
    return session
  }
  private advance(id: string, state: RecruitmentState) {
    const session = this.session(id)
    this.issue({
      type: 'advanceRecruitment',
      actorId: SERVICE,
      recruitmentId: id,
      approvedVersion: session.approvedVersion!,
      state,
    })
  }
  private scene(
    id: string,
    phase: RecruitmentScene['phase'],
    from: WorldPosition,
    to: WorldPosition,
    arrived = false,
  ) {
    this.issue({
      type: 'setRecruitmentScene',
      actorId: SERVICE,
      recruitmentId: id,
      scene: {
        phase,
        intentId: randomUUID(),
        from,
        to,
        headingRadians: phase === 'interview' ? Math.PI / 2 : 0,
        arrived,
      },
    })
  }
  private fail(id: string, code: string) {
    const session = this.session(id)
    if (
      ['cancelled', 'rejected', 'hired', 'technical_failure'].includes(
        session.state,
      )
    )
      return
    this.issue({
      type: 'failRecruitment',
      actorId: SERVICE,
      recruitmentId: id,
      approvedVersion: session.approvedVersion!,
      stage: session.state,
      code,
      retryable:
        ![
          'NAVIGATION_UNAVAILABLE',
          'PROVIDER_RECONCILIATION_REQUIRED',
        ].includes(code) &&
        !Object.values(this.runtime.getSnapshot().providerRequests).some(
          (request) =>
            this.runtime.getSnapshot().tasks[request.taskId]?.metadata
              .recruitmentId === id &&
            ['reserved', 'unknown'].includes(request.disposition),
        ),
    })
    const position = session.scene?.arrived
      ? session.scene.to
      : (session.scene?.from ?? ENTRANCE)
    this.scene(id, 'waiting', position, position, true)
  }
  request(spec: RecruitmentSpec) {
    this.secrets.assertPublic(spec, 32768)
    validateRealtimePublicData(spec, 32768)
    const recruitmentId = randomUUID()
    this.issue({
      type: 'requestRecruitment',
      actorId: this.ceoId,
      recruitmentId,
      candidateId: randomUUID(),
      spec,
    })
    return recruitmentId
  }
  revise(recruitmentId: string, spec: RecruitmentSpec) {
    this.secrets.assertPublic(spec, 32768)
    validateRealtimePublicData(spec, 32768)
    this.issue({
      type: 'reviseRecruitment',
      actorId: this.ceoId,
      recruitmentId,
      spec,
    })
  }
  decide(
    recruitmentId: string,
    version: number,
    decision: 'approve' | 'reject' | 'changes',
    reason: string,
  ) {
    this.secrets.assertPublic(reason)
    this.issue({
      type: 'decideRecruitment',
      actorId: this.ceoId,
      recruitmentId,
      version,
      decision,
      reason,
    })
  }
  start(recruitmentId: string) {
    if (this.disposed) throw fault('HOST_CLOSED')
    const session = this.session(recruitmentId)
    if (session.state === 'candidate_arriving' || this.jobs.has(recruitmentId))
      return
    this.preflightInterview(recruitmentId)
    this.advance(recruitmentId, 'candidate_arriving')
    this.scene(recruitmentId, 'arrival', ENTRANCE, INTERVIEW)
    this.issue({
      type: 'requestMovement',
      agentId: RECRUITMENT_MANAGER,
      destinationType: 'waypoint',
      destinationId: 'interview:manager',
      movementReason: 'Receive the approved recruitment candidate.',
      arrivalStatus: 'collaborating',
    })
  }
  private preflightInterview(recruitmentId: string) {
    const state = this.runtime.getSnapshot(),
      manager = state.agents[RECRUITMENT_MANAGER],
      task = manager.currentTaskId ? state.tasks[manager.currentTaskId] : null
    if (manager.status === 'blocked' || manager.status === 'repair')
      throw fault('MANAGER_NEEDS_ATTENTION')
    if (
      (task && !['completed', 'failed', 'cancelled'].includes(task.status)) ||
      Object.values(state.toolExecutions).some(
        (execution) =>
          execution.agentId === manager.id &&
          ['queued', 'running'].includes(execution.status),
      )
    )
      throw fault('INTERVIEW_BUSY')
    if (
      Object.values(state.providerRequests).some(
        (request) =>
          state.tasks[request.taskId]?.metadata.recruitmentId ===
            recruitmentId &&
          ['reserved', 'unknown'].includes(request.disposition),
      )
    )
      throw fault('PROVIDER_RECONCILIATION_REQUIRED')
    if (
      Object.values(state.recruitments).some(
        (item) =>
          item.recruitmentId !== recruitmentId &&
          (!safeStates.has(item.state) ||
            item.state === 'candidate_arriving' ||
            (['technical_failure', 'pending_retry'].includes(item.state) &&
              item.scene !== null &&
              item.scene.phase !== 'departed')),
      )
    )
      throw fault('INTERVIEW_BUSY')
  }
  arrival(recruitmentId: string, intentId: string) {
    const session = this.session(recruitmentId)
    if (session.scene?.intentId !== intentId) return
    this.issue({
      type: 'arriveRecruitmentScene',
      actorId: SERVICE,
      recruitmentId,
      intentId,
    })
    if (session.state === 'candidate_arriving')
      this.beginInterview(recruitmentId)
    else if (session.scene?.phase === 'exit')
      this.scene(recruitmentId, 'departed', ENTRANCE, ENTRANCE, true)
  }
  private beginInterview(recruitmentId: string) {
    const session = this.session(recruitmentId),
      manager = this.runtime.getSnapshot().agents[RECRUITMENT_MANAGER]
    if (
      session.state === 'candidate_arriving' &&
      session.scene?.arrived &&
      manager.status !== 'blocked' &&
      manager.status !== 'repair' &&
      !manager.destination &&
      Math.hypot(...manager.position.map((n, i) => n - MANAGER_INTERVIEW[i])) <
        0.03 &&
      !this.jobs.has(recruitmentId)
    ) {
      this.advance(recruitmentId, 'interview_in_progress')
      this.scene(recruitmentId, 'interview', INTERVIEW, INTERVIEW, true)
      const job = this.run(recruitmentId)
        .catch(() => this.fail(recruitmentId, 'EXECUTION_UNAVAILABLE'))
        .finally(() => this.jobs.delete(recruitmentId))
      this.jobs.set(recruitmentId, job)
    }
  }
  async waitForJob(id: string) {
    await this.jobs.get(id)
  }
  retry(recruitmentId: string) {
    if (this.jobs.has(recruitmentId)) throw fault('INTERVIEW_BUSY')
    this.preflightInterview(recruitmentId)
    this.issue({ type: 'retryRecruitment', actorId: this.ceoId, recruitmentId })
    this.start(recruitmentId)
  }
  cancel(recruitmentId: string) {
    const session = this.session(recruitmentId)
    this.issue({
      type: 'cancelRecruitment',
      actorId: this.ceoId,
      recruitmentId,
      reason: 'Cancelled by the CEO.',
    })
    // Include queued host handles which have not yet produced a canonical execution record.
    for (const [executor, owner] of this.executors)
      if (owner === recruitmentId) executor.dispose()
    for (const execution of Object.values(
      this.runtime.getSnapshot().toolExecutions,
    )) {
      const task = this.runtime.getSnapshot().tasks[execution.taskId]
      if (task?.metadata.recruitmentId === recruitmentId)
        for (const executor of this.executors.keys())
          executor.cancel(execution.executionId)
    }
    if (session.scene)
      this.scene(
        recruitmentId,
        'exit',
        session.scene.arrived ? session.scene.to : session.scene.from,
        ENTRANCE,
      )
  }
  terminate(employeeId: string, reason: string) {
    this.secrets.assertPublic(reason)
    this.issue({
      type: 'terminateEmployee',
      actorId: this.ceoId,
      employeeId,
      reason,
    })
  }
  private supported(spec: RecruitmentSpec) {
    if (spec.providerId !== 'openai' || spec.modelId !== RECRUITMENT_MODEL)
      throw fault('MODEL_UNAVAILABLE')
    if (
      !spec.toolIds.includes('provider.invoke') ||
      spec.toolIds.some((id) => id !== 'provider.invoke')
    )
      throw fault('TOOL_INTEGRATION_UNAVAILABLE')
    if (
      spec.knowledgeIds.length ||
      spec.memoryScopes.some((scope) => scope !== 'agent')
    )
      throw fault('CONTEXT_INTEGRATION_UNAVAILABLE')
    if (spec.adapterMode === 'openai' && !this.openaiAvailable)
      throw fault('CREDENTIAL_UNAVAILABLE')
  }
  private async run(id: string) {
    const session = this.session(id),
      spec = currentProposal(session).spec
    try {
      this.advance(id, 'agent_configuration_created')
      this.advance(id, 'runtime_initializing')
      this.supported(spec)
      if (spec.adapterMode === 'mock-technical-failure')
        throw fault('SIMULATED_INITIALIZATION_FAILURE')
      this.advance(id, 'capability_checks_running')
      for (const skill of spec.skills) {
        if (this.session(id).state !== 'capability_checks_running') return
        const answer =
          spec.adapterMode === 'openai'
            ? await this.executeSample(
                id,
                RECRUITMENT_MANAGER,
                spec,
                skill.prompt,
              )
            : spec.adapterMode === 'mock-capability-failure'
              ? 'Simulated work sample omits mandatory evidence.'
              : `Simulation only: ${skill.expectedIncludes.join('; ')}`
        this.secrets.assertPublic(answer, 16000)
        const missing = skill.expectedIncludes.filter(
          (term) =>
            !answer
              .toLocaleLowerCase('en-US')
              .includes(term.toLocaleLowerCase('en-US')),
        )
        this.issue({
          type: 'recordRecruitmentAssessment',
          actorId: SERVICE,
          recruitmentId: id,
          approvedVersion: session.approvedVersion!,
          assessment: {
            testId: skill.id,
            status: missing.length ? 'failed' : 'passed',
            mode: spec.adapterMode === 'openai' ? 'live' : 'simulation',
            evidence: [
              `Work sample: ${answer.slice(0, 3000)}`,
              missing.length
                ? `Unmet explicit criteria: ${missing.join('; ')}`
                : 'All CEO-defined text criteria occurred in this work sample. This is not independent proof of broad professional competence.',
            ],
          },
        })
      }
      const latest = this.session(id)
      const failed = spec.skills.some(
        (skill) =>
          skill.mandatory &&
          latest.assessments.some(
            (result) =>
              result.attempt === latest.attempt &&
              result.testId === skill.id &&
              result.status === 'failed',
          ),
      )
      this.advance(
        id,
        failed ? 'capability_checks_failed' : 'capability_checks_passed',
      )
      if (failed) {
        this.advance(id, 'rejected')
        this.scene(id, 'exit', INTERVIEW, ENTRANCE)
        return
      }
      const state = this.runtime.getSnapshot()
      const occupied = new Set(
        Object.values(state.agents).map((agent) => agent.workstationId),
      )
      const desk = Object.values(state.workstations).find(
        (item) =>
          item.departmentId === spec.departmentId && !occupied.has(item.id),
      )
      if (!desk) throw fault('WORKSTATION_UNAVAILABLE')
      this.advance(id, 'recruitment_committing')
      this.advance(id, 'employee_activating')
      this.issue({
        type: 'activateRecruitment',
        actorId: SERVICE,
        recruitmentId: id,
        approvedVersion: session.approvedVersion!,
        workstationId: desk.id,
        position: INTERVIEW,
        headingRadians: 0,
      })
      this.scene(id, 'workstation', INTERVIEW, standingWorkstationAnchor(desk))
      this.issue({
        type: 'requestMovement',
        agentId: session.candidateId,
        destinationType: 'workstation',
        destinationId: desk.id,
        movementReason:
          'Welcome the activated employee to their assigned workstation.',
        arrivalStatus: 'waiting',
      })
    } catch (error) {
      this.fail(
        id,
        error instanceof ToolFault ? error.code : 'EXECUTION_UNAVAILABLE',
      )
    } finally {
      const manager = this.runtime.getSnapshot().agents[RECRUITMENT_MANAGER]
      if (
        manager.status !== 'blocked' &&
        (!manager.currentTaskId ||
          ['completed', 'failed', 'cancelled'].includes(
            this.runtime.getSnapshot().tasks[manager.currentTaskId].status,
          ))
      )
        this.issue({
          type: 'requestMovement',
          agentId: manager.id,
          destinationType: 'workstation',
          destinationId: manager.workstationId!,
          movementReason: 'Return after the recruitment interview.',
          arrivalStatus: 'waiting',
        })
    }
  }
  private async executeSample(
    recruitmentId: string,
    agentId: string,
    spec: RecruitmentSpec,
    prompt: string,
  ) {
    if (this.disposed) throw fault('HOST_CLOSED')
    this.secrets.assertPublic(prompt, 8000)
    const records = Object.values(
      this.runtime.getSnapshot().providerRequests,
    ).filter(
      (item) =>
        this.runtime.getSnapshot().tasks[item.taskId]?.metadata
          .recruitmentId === recruitmentId,
    )
    if (
      records.some((item) => ['unknown', 'reserved'].includes(item.disposition))
    )
      throw fault('PROVIDER_RECONCILIATION_REQUIRED')
    const spent = records.reduce(
      (sum, item) => sum + BigInt(item.actualMicros ?? 0),
      0n,
    )
    const remaining = BigInt(spec.budgetMicros) - spent
    if (remaining <= 0n) throw fault('BUDGET_EXCEEDED')
    const owner = this.runtime.getSnapshot().agents[agentId]
    if (
      owner.currentTaskId &&
      !['completed', 'failed', 'cancelled'].includes(
        this.runtime.getSnapshot().tasks[owner.currentTaskId].status,
      )
    )
      throw fault('AGENT_BUSY')
    const taskId = randomUUID()
    this.issue({
      type: 'createTask',
      task: {
        id: taskId,
        title:
          agentId === RECRUITMENT_MANAGER
            ? 'Approved candidate work sample'
            : 'CEO-authorized employee work',
        description:
          'Bounded execution using the approved employee configuration.',
        metadata: { recruitmentId },
      },
    })
    this.issue({ type: 'assignTask', taskId, agentId })
    this.issue({
      type: 'startTask',
      taskId,
      ...(agentId === RECRUITMENT_MANAGER
        ? {
            workLocation: 'current-position' as const,
            recruitmentId,
            approvedVersion: this.session(recruitmentId).approvedVersion!,
          }
        : {}),
    })
    const registry = new ProviderRegistry()
    registry.register({
      descriptor: {
        id: 'openai',
        displayName: 'OpenAI',
        enabled: true,
        status: 'available',
        capabilities: ['structured'],
        fallbacks: [],
        models: [
          {
            id: RECRUITMENT_MODEL,
            capabilities: ['structured'],
            pricing: { inputMicrosPerUnit: 13, outputMicrosPerUnit: 50 },
            maxInputUnits: 100000,
            maxOutputUnits: 8192,
          },
        ],
      },
      secretReference: 'openai-host',
      adapter: this.adapter,
    })
    const broker = new ProviderBroker({
      runtime: this.runtime,
      registry,
      secrets: this.secrets,
      grants: [
        { agentId, providerIds: ['openai'], capabilities: ['structured'] },
      ],
      timeoutMs: 120000,
    })
    const tools = new ToolRegistry()
    tools.register(broker.createTool())
    const executor = new ToolExecutor({
      runtime: this.runtime,
      registry: tools,
      grants: {
        [agentId]: { toolIds: spec.toolIds, permissions: ['network'] },
      },
    })
    this.executors.set(executor, recruitmentId)
    try {
      let taskPrompt = prompt
      if (
        agentId !== RECRUITMENT_MANAGER &&
        spec.memoryScopes.includes('agent')
      ) {
        const context = new MemoryService(
          new InMemoryMemoryRepository(this.runtime, agentId),
        ).forTask({
          taskId,
          query: prompt.slice(0, 1000),
          limit: 3,
          maxCharacters: 2000,
        })
        const privateMemories = context.memories.filter(
          (memory) =>
            memory.scope.kind === 'agent' && memory.scope.id === agentId,
        )
        if (privateMemories.length)
          taskPrompt += `\nScoped memory evidence (preserve source and trust):\n${serializeMemoryContext(agentId, taskId, null, privateMemories)}`
      }
      const result = await executor.execute({
        executionId: randomUUID(),
        taskId,
        agentId,
        toolId: 'provider.invoke',
        input: {
          providerId: spec.providerId,
          modelId: spec.modelId,
          capability: 'structured',
          maxOutputUnits: spec.maxOutputUnits,
          maxCostMicros: Number(remaining),
          allowFallback: false,
          input: {
            instructions: recruitmentInstructions(spec),
            prompt: taskPrompt,
          },
        },
      })
      if (result.status !== 'completed')
        throw fault(result.error?.code ?? 'PROVIDER_FAILED')
      const output = (result.output as unknown as ProviderExecutionResult)
        .output as { answer?: unknown }
      if (typeof output?.answer !== 'string')
        throw fault('PROVIDER_OUTPUT_INVALID')
      this.issue({ type: 'completeTask', taskId })
      return output.answer
    } catch (error) {
      const task = this.runtime.getSnapshot().tasks[taskId]
      if (!['completed', 'failed', 'cancelled'].includes(task.status))
        this.issue({
          type: 'cancelTask',
          taskId,
          reason:
            'Provider execution did not complete; retained tool and billing evidence require review.',
        })
      throw error
    } finally {
      executor.dispose()
      this.executors.delete(executor)
    }
  }
  async employeeTask(employeeId: string, prompt: string) {
    const employee = this.runtime.getSnapshot().employees[employeeId]
    if (!employee || employee.status !== 'active' || employee.mode !== 'live')
      throw fault('EMPLOYEE_NOT_OPERATIONAL')
    const spec = employee.versions.find(
      (item) => item.version === employee.currentVersion,
    )!.spec
    this.supported(spec)
    await this.executeSample(employee.recruitmentId, employeeId, spec, prompt)
  }
  feedback(command: RuntimeCommand) {
    if (command.type === 'selectAgent' || command.type === 'selectTask') {
      this.issue(command)
      return
    }
    if (command.type !== 'arrive' && command.type !== 'rejectMovement')
      throw fault('COMMAND_DENIED')
    const state = this.runtime.getSnapshot(),
      agent = state.agents[command.agentId]
    if (!agent?.destination || agent.destination.id !== command.intentId) return
    if (command.type === 'rejectMovement') {
      this.issue({
        ...command,
        reason: 'The authored office route could not be resolved.',
      })
      if (agent.id === RECRUITMENT_MANAGER)
        for (const session of Object.values(state.recruitments))
          if (session.state === 'candidate_arriving')
            this.fail(session.recruitmentId, 'NAVIGATION_UNAVAILABLE')
      return
    }
    const desk = agent.workstationId
      ? state.workstations[agent.workstationId]
      : null
    const allowed =
      agent.destination.destinationType === 'workstation' && desk
        ? [standingWorkstationAnchor(desk), seatedWorkstationAnchor(desk)]
        : agent.id === RECRUITMENT_MANAGER &&
            agent.destination.destinationId === 'interview:manager'
          ? [MANAGER_INTERVIEW]
          : []
    if (
      !allowed.some(
        (point) =>
          Math.hypot(...point.map((n, i) => n - command.position[i])) < 0.03,
      ) ||
      !Number.isFinite(command.headingRadians)
    )
      throw fault('INVALID_ARRIVAL')
    this.issue(
      agent.destination.destinationId === 'interview:manager'
        ? { ...command, headingRadians: -Math.PI / 2 }
        : command,
    )
    if (agent.id === RECRUITMENT_MANAGER)
      for (const item of Object.values(this.runtime.getSnapshot().recruitments))
        this.beginInterview(item.recruitmentId)
    const session = Object.values(state.recruitments).find(
      (item) => item.candidateId === agent.id && item.state === 'hired',
    )
    if (session?.scene && !session.scene.arrived)
      this.issue({
        type: 'arriveRecruitmentScene',
        actorId: SERVICE,
        recruitmentId: session.recruitmentId,
        intentId: session.scene.intentId,
      })
  }
  async close() {
    this.disposed = true
    for (const executor of this.executors.keys()) executor.dispose()
    await Promise.allSettled(this.jobs.values())
  }
  public(value: unknown, maxBytes?: number): RuntimeJson {
    return this.secrets.assertPublic(value, maxBytes)
  }
}
