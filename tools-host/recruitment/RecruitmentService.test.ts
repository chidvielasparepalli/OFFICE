// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RecruitmentService, RECRUITMENT_MANAGER } from './RecruitmentService'
import {
  OpenAIResponsesAdapter,
  RECRUITMENT_MODEL,
} from './OpenAIResponsesAdapter'
import { LocalRuntimeRepository } from './LocalRuntimeRepository'
import {
  createOfficeRuntime,
  InMemoryOfficeRuntimeRepository,
} from '../../src/runtime/officeRuntime'
import type {
  OfficeRuntimeRepository,
  RuntimeCommand,
  RuntimeState,
} from '../../src/runtime/runtimeTypes'
import type { RecruitmentSpec } from '../../src/recruitment/recruitmentTypes'
import { createRealtimeProjection } from '../realtime/publication'
import {
  createCharacterMotion,
  standingWorkstationAnchor,
} from '../../src/office/characterMotion'
import { createOfficeRuntimeBridge } from '../../src/runtime/officeRuntimeBridge'
import { presentedAgents } from '../../src/office/workerPresentation'
import { RealtimePublisher } from '../../src/realtime/RealtimePublisher'
import { LocalRealtimeTransport } from '../../src/realtime/LocalRealtimeTransport'
import { RealtimeStore } from '../../src/realtime/RealtimeStore'

const services: RecruitmentService[] = []
const repositories: LocalRuntimeRepository[] = []
const folders: string[] = []
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()))
  repositories.splice(0).forEach((repository) => repository.close())
  folders
    .splice(0)
    .forEach((folder) => rmSync(folder, { recursive: true, force: true }))
})
const privateFixture = 'SYNTHETIC_RECRUITMENT_SERVICE_PRIVATE_ONLY'
const spec = (patch: Partial<RecruitmentSpec> = {}): RecruitmentSpec => ({
  name: 'Security Reviewer',
  role: 'Security Analyst',
  departmentId: 'engineering',
  mission: 'Review authorized synthetic examples.',
  responsibilities: ['Describe issues in approved inputs.'],
  instructions: 'Use only approved inputs and explain uncertainty.',
  personality: 'Careful',
  skills: [
    {
      id: 'review',
      description: 'Identify the synthetic unsafe construction.',
      mandatory: true,
      prompt: 'Review the synthetic example.',
      expectedIncludes: ['unsafe'],
    },
  ],
  providerId: 'openai',
  modelId: RECRUITMENT_MODEL,
  toolIds: ['provider.invoke'],
  memoryScopes: ['agent'],
  knowledgeIds: [],
  collaboratorIds: [],
  managerId: RECRUITMENT_MANAGER,
  budgetMicros: 500000,
  maxOutputUnits: 100,
  adapterMode: 'mock-success',
  ...patch,
})
function create(
  options: {
    repository?: OfficeRuntimeRepository
    credential?: string
    adapter?: OpenAIResponsesAdapter
    globalBudgetMicros?: number
  } = {},
) {
  const service = new RecruitmentService({
    repository: options.repository ?? new InMemoryOfficeRuntimeRepository(),
    ceoId: 'local-ceo',
    ...options,
  })
  services.push(service)
  return service
}
function issue(service: RecruitmentService, command: RuntimeCommand) {
  const result = service.runtime.dispatch(command)
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`)
}
function proposed(service: RecruitmentService, value = spec()) {
  const id = service.request(value)
  service.decide(
    id,
    1,
    'approve',
    'Approved for the specified bounded local workflow.',
  )
  return id
}
function managerArrival(service: RecruitmentService) {
  const manager = service.runtime.getSnapshot().agents[RECRUITMENT_MANAGER]
  service.feedback({
    type: 'arrive',
    agentId: manager.id,
    intentId: manager.destination!.id,
    position: [0.8, 0, 10],
    headingRadians: -Math.PI / 2,
  })
}
async function run(service: RecruitmentService, value = spec()) {
  const id = proposed(service, value)
  service.start(id)
  const scene = service.runtime.getSnapshot().recruitments[id].scene!
  service.arrival(id, scene.intentId)
  managerArrival(service)
  await service.waitForJob(id)
  return service.runtime.getSnapshot().recruitments[id]
}
function response(answer = 'The synthetic construction is unsafe.') {
  return new Response(
    JSON.stringify({
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify({ answer }) }],
        },
      ],
      usage: { input_tokens: 30, output_tokens: 20 },
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
}
function liveAdapter(answer?: string) {
  const request = vi.fn<typeof fetch>(async () => response(answer))
  return { request, adapter: new OpenAIResponsesAdapter(request) }
}

describe('host recruitment workflow integration', () => {
  it('starts with real authored department/desk anchors and a distinct Manager', () => {
    const service = create(),
      state = service.runtime.getSnapshot()
    expect(Object.keys(state.departments)).toHaveLength(7)
    expect(Object.keys(state.workstations)).toHaveLength(7)
    expect(state.agents[RECRUITMENT_MANAGER].kind).toBe('manager')
    expect(state.employees).toEqual({})
    expect(state.providerRequests).toEqual({})
  })
  it('does not start an unapproved proposal or let a rejected proposal proceed', () => {
    const service = create(),
      id = service.request(spec())
    expect(() => service.start(id)).toThrow()
    service.decide(id, 1, 'reject', 'CEO declined the proposal.')
    expect(() => service.start(id)).toThrow()
    expect(service.runtime.getSnapshot().employees).toEqual({})
  })
  it('creates one clearly labelled simulation employee only after explicit arrival and checks', async () => {
    const service = create(),
      id = proposed(service)
    service.start(id)
    expect(service.runtime.getSnapshot().recruitments[id].state).toBe(
      'candidate_arriving',
    )
    expect(service.runtime.getSnapshot().employees).toEqual({})
    const intent =
      service.runtime.getSnapshot().recruitments[id].scene!.intentId
    service.arrival(id, intent)
    service.arrival(id, intent)
    managerArrival(service)
    await service.waitForJob(id)
    const state = service.runtime.getSnapshot(),
      session = state.recruitments[id]
    expect(session.state).toBe('hired')
    expect(state.employees[session.candidateId]).toMatchObject({
      mode: 'simulation',
      status: 'active',
    })
    expect(state.agents[session.candidateId]).toMatchObject({
      kind: 'standard-worker',
      destination: { destinationType: 'workstation' },
    })
    expect(state.agents[session.candidateId].capabilities).toContain(
      'structured',
    )
    expect(session.assessments[0]).toMatchObject({
      mode: 'simulation',
      status: 'passed',
    })
    expect(Object.keys(state.employees)).toHaveLength(1)
    expect(Object.keys(state.providerRequests)).toHaveLength(0)
  })
  it('records mock mandatory capability failure as rejection with evidence and exit', async () => {
    const service = create(),
      session = await run(
        service,
        spec({ adapterMode: 'mock-capability-failure' }),
      )
    expect(session.state).toBe('rejected')
    expect(session.scene?.phase).toBe('exit')
    expect(session.assessments[0]).toMatchObject({
      status: 'failed',
      mode: 'simulation',
    })
    expect(session.assessments[0].evidence.length).toBeGreaterThan(0)
    expect(service.runtime.getSnapshot().employees).toEqual({})
    service.arrival(session.recruitmentId, session.scene!.intentId)
    expect(
      service.runtime.getSnapshot().recruitments[session.recruitmentId].scene
        ?.phase,
    ).toBe('departed')
  })
  it('preserves technical initialization failure as paused rather than a skill rejection', async () => {
    const service = create(),
      session = await run(
        service,
        spec({ adapterMode: 'mock-technical-failure' }),
      )
    expect(session.state).toBe('technical_failure')
    expect(session.scene?.phase).toBe('waiting')
    expect(session.assessments).toEqual([])
    expect(session.failures[0].code).toBe('SIMULATED_INITIALIZATION_FAILURE')
    expect(
      service.runtime
        .getSnapshot()
        .events.some((event) => event.type === 'RECRUITMENT_REJECTED'),
    ).toBe(false)
  })
  it('requires renewed approval for changed tools and budgets', () => {
    const service = create(),
      id = proposed(service)
    service.revise(id, spec({ budgetMicros: 200000 }))
    expect(() => service.start(id)).toThrow()
    expect(() =>
      service.decide(id, 1, 'approve', 'Obsolete proposal.'),
    ).toThrow()
    service.decide(id, 2, 'approve', 'Review current proposal.')
    service.start(id)
    expect(service.runtime.getSnapshot().recruitments[id].approvedVersion).toBe(
      2,
    )
  })
  it.each([
    ['tool', { toolIds: ['provider.invoke', 'filesystem.read'] }],
    ['knowledge', { knowledgeIds: ['missing-source'] }],
    ['scope', { memoryScopes: ['organization'] }],
    ['model', { modelId: 'unsupported-model' }],
  ] as const)(
    'does not claim a %s integration exists when unavailable',
    async (_kind, patch) => {
      const service = create(),
        session = await run(service, spec(patch))
      expect(session.state).toBe('technical_failure')
      expect(session.assessments).toEqual([])
      expect(session.scene?.phase).toBe('waiting')
      expect(service.runtime.getSnapshot().employees).toEqual({})
    },
  )
  it('fails live initialization truthfully when no host credential exists', async () => {
    const service = create(),
      session = await run(service, spec({ adapterMode: 'openai' }))
    expect(session.state).toBe('technical_failure')
    expect(session.failures[0].code).toBe('CREDENTIAL_UNAVAILABLE')
    expect(service.runtime.getSnapshot().providerRequests).toEqual({})
  })
  it('uses injected HTTP through the real adapter, broker, ToolExecutor and ledger', async () => {
    const { adapter, request } = liveAdapter(),
      service = create({ adapter, credential: privateFixture })
    const session = await run(service, spec({ adapterMode: 'openai' }))
    expect(session.state).toBe('hired')
    expect(
      service.runtime.getSnapshot().employees[session.candidateId].mode,
    ).toBe('live')
    expect(session.assessments[0]).toMatchObject({
      mode: 'live',
      status: 'passed',
    })
    expect(request).toHaveBeenCalledOnce()
    expect(
      Object.values(service.runtime.getSnapshot().providerRequests)[0],
    ).toMatchObject({ status: 'succeeded', actualMicros: 1390 })
    expect(service.runtime.getSnapshot().creditLedger.length).toBeGreaterThan(0)
    expect(
      JSON.stringify(service.runtime.getSnapshot()).includes(privateFixture),
    ).toBe(false)
  })
  it('executes an explicit approved live employee task and denies it after termination', async () => {
    const { adapter, request } = liveAdapter(),
      service = create({ adapter, credential: privateFixture })
    const session = await run(service, spec({ adapterMode: 'openai' }))
    await service.employeeTask(
      session.candidateId,
      'Review another authorized synthetic example.',
    )
    expect(request).toHaveBeenCalledTimes(2)
    service.terminate(session.candidateId, 'CEO revoked operational access.')
    await expect(
      service.employeeTask(session.candidateId, 'Cannot execute now.'),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_OPERATIONAL' })
    expect(request).toHaveBeenCalledTimes(2)
    expect(
      service.runtime.getSnapshot().agents[session.candidateId].capabilities,
    ).toEqual([])
  })
  it('never passes a credential-like provider answer into personnel, events or memory', async () => {
    const { adapter } = liveAdapter(
        'api_key=synthetic_unsafe_provider_fixture',
      ),
      service = create({ adapter, credential: privateFixture })
    const session = await run(service, spec({ adapterMode: 'openai' }))
    expect(session.state).toBe('technical_failure')
    expect(session.assessments).toEqual([])
    const serialized = JSON.stringify(service.runtime.getSnapshot())
    expect(serialized.includes('synthetic_unsafe_provider_fixture')).toBe(false)
    expect(serialized.includes(privateFixture)).toBe(false)
  })
  it('denies execution before HTTP submission when approved budget cannot cover estimate', async () => {
    const { adapter, request } = liveAdapter(),
      service = create({ adapter, credential: privateFixture })
    const session = await run(
      service,
      spec({ adapterMode: 'openai', budgetMicros: 1 }),
    )
    expect(session.state).toBe('technical_failure')
    expect(session.assessments).toEqual([])
    expect(request.mock.calls.length).toBe(0)
    expect(service.runtime.getSnapshot().employees).toEqual({})
  })
  it('does not put a second employee at an occupied desk', async () => {
    const service = create(),
      first = await run(service),
      second = await run(service, spec({ name: 'Second reviewer' }))
    expect(first.state).toBe('hired')
    expect(second.state).toBe('technical_failure')
    expect(second.failures.at(-1)?.code).toBe('WORKSTATION_UNAVAILABLE')
    expect(Object.keys(service.runtime.getSnapshot().employees)).toHaveLength(1)
  })
  it('preserves identity and progress on real local repository reopen', async () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), 'office-recruitment-integration-'),
    )
    folders.push(directory)
    const repository = new LocalRuntimeRepository({ directory })
    repositories.push(repository)
    const service = create({ repository }),
      session = await run(service)
    await service.close()
    repository.close()
    const restoredRepository = new LocalRuntimeRepository({ directory })
    repositories.push(restoredRepository)
    const restored = create({ repository: restoredRepository }),
      state = restored.runtime.getSnapshot()
    expect(state.recruitments[session.recruitmentId].state).toBe('hired')
    expect(Object.keys(state.employees)).toEqual([session.candidateId])
    expect(state.employees[session.candidateId].versions).toEqual(
      service.runtime.getSnapshot().employees[session.candidateId].versions,
    )
  })
  it('recovers interrupted initialization as a technical failure without replay', async () => {
    const repository = new InMemoryOfficeRuntimeRepository(),
      service = create({ repository }),
      id = proposed(service)
    service.start(id)
    issue(service, {
      type: 'advanceRecruitment',
      actorId: 'recruitment-service',
      recruitmentId: id,
      approvedVersion: 1,
      state: 'interview_in_progress',
    })
    issue(service, {
      type: 'advanceRecruitment',
      actorId: 'recruitment-service',
      recruitmentId: id,
      approvedVersion: 1,
      state: 'agent_configuration_created',
    })
    await service.close()
    const { adapter, request } = liveAdapter(),
      restored = create({ repository, adapter, credential: privateFixture })
    expect(restored.runtime.getSnapshot().recruitments[id].state).toBe(
      'technical_failure',
    )
    expect(
      restored.runtime.getSnapshot().recruitments[id].failures.at(-1)?.code,
    ).toBe('HOST_RESTARTED')
    expect(request.mock.calls.length).toBe(0)
  })
  it.each([
    'EMPLOYEE_ACTIVATED',
    'RECRUITMENT_SCENE_CHANGED',
    'AGENT_ARRIVED',
  ] as const)(
    'recovers onboarding after the %s commit without recreating an employee or replaying work',
    async (commit) => {
      const service = create()
      let saved: RuntimeState | null = null
      const unsubscribe = service.runtime.subscribe(() => {
        const state = service.runtime.getSnapshot(),
          session = Object.values(state.recruitments).find(
            (item) => item.state === 'hired',
          )
        if (
          !saved &&
          state.events.at(-1)?.type === commit &&
          session &&
          !state.agents[session.candidateId].destination
        )
          saved = state
      })
      const session = await run(service)
      if (commit === 'AGENT_ARRIVED') {
        const state = service.runtime.getSnapshot(),
          agent = state.agents[session.candidateId]
        service.feedback({
          type: 'arrive',
          agentId: agent.id,
          intentId: agent.destination!.id,
          position: standingWorkstationAnchor(
            state.workstations[agent.workstationId!],
          ),
          headingRadians: 0,
        })
      }
      unsubscribe()
      expect(saved).not.toBeNull()
      const captured = saved!,
        repository = new InMemoryOfficeRuntimeRepository(captured),
        { adapter, request } = liveAdapter(),
        restored = create({ repository, adapter, credential: privateFixture }),
        state = restored.runtime.getSnapshot(),
        employee = state.agents[session.candidateId]
      expect(state.recruitments[session.recruitmentId].scene).toMatchObject({
        phase: 'workstation',
        arrived: commit === 'AGENT_ARRIVED',
      })
      if (commit === 'AGENT_ARRIVED') expect(employee.destination).toBeNull()
      else
        expect(employee.destination).toMatchObject({
          destinationType: 'workstation',
          destinationId: employee.workstationId,
        })
      expect(state.employees).toEqual(captured.employees)
      expect(state.recruitments[session.recruitmentId].assessments).toEqual(
        captured.recruitments[session.recruitmentId].assessments,
      )
      expect(state.providerRequests).toEqual(captured.providerRequests)
      expect(
        state.events.filter((item) => item.type === 'EMPLOYEE_ACTIVATED'),
      ).toHaveLength(1)
      expect(request.mock.calls.length).toBe(0)
      await restored.close()
      const reopened = create({
          repository,
          adapter,
          credential: privateFixture,
        }),
        reopenedState = reopened.runtime.getSnapshot()
      expect(reopenedState.agents[session.candidateId].destination).toEqual(
        employee.destination,
      )
      expect(reopenedState.recruitments[session.recruitmentId].scene).toEqual(
        state.recruitments[session.recruitmentId].scene,
      )
      expect(reopenedState.employees).toEqual(state.employees)
      expect(request.mock.calls.length).toBe(0)
    },
  )
  it('requires deliberate retry and retains failed history and candidate identity', async () => {
    const service = create(),
      session = await run(
        service,
        spec({ adapterMode: 'mock-technical-failure' }),
      )
    service.retry(session.recruitmentId)
    const retried =
      service.runtime.getSnapshot().recruitments[session.recruitmentId]
    expect(retried).toMatchObject({
      candidateId: session.candidateId,
      attempt: 2,
      state: 'candidate_arriving',
    })
    expect(retried.failures).toHaveLength(1)
    expect(service.runtime.getSnapshot().employees).toEqual({})
  })
  it('does not register a cancelled candidate when its old arrival event repeats', async () => {
    const service = create(),
      id = proposed(service)
    service.start(id)
    const intent =
      service.runtime.getSnapshot().recruitments[id].scene!.intentId
    service.cancel(id)
    service.arrival(id, intent)
    await service.waitForJob(id)
    expect(service.runtime.getSnapshot().recruitments[id].state).toBe(
      'cancelled',
    )
    expect(service.runtime.getSnapshot().employees).toEqual({})
  })
  it('keeps personnel specifications out of ordinary recipient projections', async () => {
    const service = create(),
      session = await run(service)
    const options = {
      principalAgentId: RECRUITMENT_MANAGER,
      memoryPolicy: { grants: [] },
      artifactPolicy: { grants: [] },
      assertPublic: (value: unknown, maxBytes?: number) =>
        service.public(value, maxBytes),
    }
    const ordinary = createRealtimeProjection(options)(
      service.runtime.getSnapshot(),
    )
    expect(ordinary.state.recruitments).toEqual({})
    expect(ordinary.state.employees).toEqual({})
    expect(JSON.stringify(ordinary).includes(spec().instructions)).toBe(false)
    const ceo = createRealtimeProjection({ ...options, recruitmentCeo: true })(
      service.runtime.getSnapshot(),
    )
    expect(
      ceo.state.recruitments[session.recruitmentId].proposals[0].spec
        .instructions,
    ).toBe(spec().instructions)
    expect(ceo.state.employees[session.candidateId].mode).toBe('simulation')
  })
  it('removes terminated occupants through CEO and ordinary realtime deltas while preserving history and reusing only the released desk', async () => {
    const service = create(),
      session = await run(service),
      before = service.runtime.getSnapshot(),
      employeeAgent = before.agents[session.candidateId],
      deskId = employeeAgent.workstationId!
    service.feedback({
      type: 'arrive',
      agentId: employeeAgent.id,
      intentId: employeeAgent.destination!.id,
      position: standingWorkstationAnchor(before.workstations[deskId]),
      headingRadians: 0,
    })
    issue(service, { type: 'selectAgent', agentId: employeeAgent.id })
    const canonicalBridge = createOfficeRuntimeBridge(),
      projectedBefore = canonicalBridge.project(
        service.runtime.getSnapshot(),
        new Map(),
      )
    expect(projectedBefore?.agents[employeeAgent.id]).toBeDefined()
    const clients = [false, true].map((recruitmentCeo) => {
      const publisher = new RealtimePublisher({
          runtime: service.runtime,
          streamId: recruitmentCeo ? 'termination-ceo' : 'termination-office',
          project: createRealtimeProjection({
            principalAgentId: RECRUITMENT_MANAGER,
            memoryPolicy: { grants: [] },
            artifactPolicy: { grants: [] },
            recruitmentCeo,
          }),
        }),
        store = new RealtimeStore(new LocalRealtimeTransport(publisher)),
        tombstones: string[] = []
      publisher.subscribe((message) => {
        if (
          message.kind === 'delta' &&
          message.changes.records.agents?.[employeeAgent.id] === null
        )
          tombstones.push(employeeAgent.id)
      })
      return { recruitmentCeo, publisher, store, tombstones }
    })
    await Promise.all(clients.map(({ store }) => store.connect()))
    try {
      service.terminate(employeeAgent.id, 'CEO ended the local employment.')
      const retained = service.runtime.getSnapshot()
      expect(retained.agents[employeeAgent.id]).toMatchObject({
        workstationId: null,
        capabilities: [],
        destination: null,
      })
      expect(retained.employees[employeeAgent.id].status).toBe('terminated')
      expect(retained.recruitments[session.recruitmentId].state).toBe('hired')
      const canonical = canonicalBridge.project(retained, new Map())
      expect(canonical?.agents[employeeAgent.id]).toBeUndefined()
      expect(canonical?.departments.engineering.agentIds).not.toContain(
        employeeAgent.id,
      )
      for (const { recruitmentCeo, store, tombstones } of clients) {
        const state = store.getSnapshot()
        expect(store.getConnection().status).toBe('connected')
        expect(state.selectedAgentId).toBeNull()
        expect(state.agents[employeeAgent.id]).toBeUndefined()
        expect(tombstones).toEqual([employeeAgent.id])
        expect(
          presentedAgents(
            createOfficeRuntimeBridge().project(state, new Map()),
          ).some((agent) => agent.id === employeeAgent.id),
        ).toBe(false)
        if (recruitmentCeo)
          expect(state.employees[employeeAgent.id].status).toBe('terminated')
        else {
          expect(state.employees).toEqual({})
          expect(state.recruitments).toEqual({})
          expect(JSON.stringify(state).includes(spec().instructions)).toBe(
            false,
          )
        }
      }
      const replacement = await run(
          service,
          spec({ name: 'Replacement reviewer' }),
        ),
        final = service.runtime.getSnapshot()
      expect(replacement.candidateId).not.toBe(employeeAgent.id)
      expect(replacement.workstationId).toBe(deskId)
      expect(Object.keys(final.employees)).toHaveLength(2)
      expect(final.employees[employeeAgent.id].status).toBe('terminated')
      const placements = presentedAgents(
        canonicalBridge.project(final, new Map()),
      )
      expect(
        placements
          .filter((agent) => agent.workstation?.id === deskId)
          .map((agent) => agent.id),
      ).toEqual([replacement.candidateId])
      expect(placements.some((agent) => agent.id === employeeAgent.id)).toBe(
        false,
      )
    } finally {
      for (const { store, publisher } of clients) {
        store.dispose()
        publisher.dispose()
      }
    }
  })
  it('invalidates the office bridge when only employee lifecycle changes', async () => {
    const service = create(),
      session = await run(service),
      state = service.runtime.getSnapshot(),
      bridge = createOfficeRuntimeBridge()
    expect(
      bridge.project(state, new Map())?.agents[session.candidateId],
    ).toBeDefined()
    const lifecycleOnly: RuntimeState = {
      ...state,
      employees: {
        ...state.employees,
        [session.candidateId]: {
          ...state.employees[session.candidateId],
          status: 'terminated',
        },
      },
    }
    expect(lifecycleOnly.agents).toBe(state.agents)
    expect(
      bridge.project(lifecycleOnly, new Map())?.agents[session.candidateId],
    ).toBeUndefined()
  })
  it('releases a failed assessment task so the Manager can interview another candidate', async () => {
    const { adapter } = liveAdapter(),
      service = create({ adapter, credential: privateFixture })
    const failed = await run(
      service,
      spec({ adapterMode: 'openai', budgetMicros: 1 }),
    )
    expect(failed.state).toBe('technical_failure')
    const pendingId = proposed(service, spec({ name: 'Pending reviewer' }))
    expect(() => service.start(pendingId)).toThrow()
    expect(service.runtime.getSnapshot().recruitments[pendingId].state).toBe(
      'approved',
    )
    service.cancel(failed.recruitmentId)
    const next = await run(service, spec({ name: 'Next reviewer' }))
    expect(next.state).toBe('hired')
    const manager = service.runtime.getSnapshot().agents[RECRUITMENT_MANAGER]
    expect(manager.destination?.destinationType).toBe('workstation')
    expect(['completed', 'failed', 'cancelled']).toContain(
      service.runtime.getSnapshot().tasks[manager.currentTaskId!].status,
    )
  })
  it('cancels an in-flight assessment without hiring and releases Manager work', async () => {
    let submitted!: () => void
    const began = new Promise<void>((resolve) => {
      submitted = resolve
    })
    const request = vi.fn<typeof fetch>(async (_url, options) => {
      submitted()
      return new Promise<Response>((_resolve, reject) => {
        const signal = options!.signal!
        signal.addEventListener(
          'abort',
          () => reject(new Error('Synthetic cancellation.')),
          { once: true },
        )
      })
    })
    const service = create({
        adapter: new OpenAIResponsesAdapter(request),
        credential: privateFixture,
      }),
      id = proposed(service, spec({ adapterMode: 'openai' }))
    service.start(id)
    service.arrival(
      id,
      service.runtime.getSnapshot().recruitments[id].scene!.intentId,
    )
    managerArrival(service)
    await began
    service.cancel(id)
    await service.waitForJob(id)
    const state = service.runtime.getSnapshot()
    expect(state.recruitments[id].state).toBe('cancelled')
    expect(state.employees).toEqual({})
    expect(state.agents[RECRUITMENT_MANAGER].destination?.destinationType).toBe(
      'workstation',
    )
    expect(
      Object.values(state.tasks).every((task) =>
        ['completed', 'failed', 'cancelled'].includes(task.status),
      ),
    ).toBe(true)
    expect(request).toHaveBeenCalledOnce()
  })
  it('keeps the live Manager working at the interview through realtime while HTTP is pending', async () => {
    let submitted!: () => void, finish!: (response: Response) => void
    const began = new Promise<void>((resolve) => {
        submitted = resolve
      }),
      request = vi.fn<typeof fetch>(async () => {
        submitted()
        return new Promise<Response>((resolve) => {
          finish = resolve
        })
      }),
      service = create({
        adapter: new OpenAIResponsesAdapter(request),
        credential: privateFixture,
      }),
      id = proposed(service, spec({ adapterMode: 'openai' })),
      publisher = new RealtimePublisher({
        runtime: service.runtime,
        streamId: 'recruitment-live-interview',
        project: createRealtimeProjection({
          principalAgentId: RECRUITMENT_MANAGER,
          memoryPolicy: { grants: [] },
          artifactPolicy: { grants: [] },
          recruitmentCeo: true,
          assertPublic: (value, maxBytes) => service.public(value, maxBytes),
        }),
      }),
      store = new RealtimeStore(new LocalRealtimeTransport(publisher))
    await store.connect()
    try {
      service.start(id)
      service.arrival(
        id,
        service.runtime.getSnapshot().recruitments[id].scene!.intentId,
      )
      managerArrival(service)
      await began
      const state = store.getSnapshot(),
        manager = state.agents[RECRUITMENT_MANAGER],
        task = state.tasks[manager.currentTaskId!]
      expect(store.getConnection().status).toBe('connected')
      expect(manager.status).toBe('working')
      expect(manager.destination).toBeNull()
      expect(manager.position).toEqual([0.8, 0, 10])
      expect(task).toMatchObject({
        status: 'in_progress',
        workLocation: 'current-position',
      })
      const projected = createOfficeRuntimeBridge().project(state, new Map()),
        placement = presentedAgents(projected).find(
          (agent) => agent.id === manager.id,
        )!,
        controller = createCharacterMotion(placement)
      expect(placement.standingWork).toBe(true)
      const frame = controller.advance(30)
      expect(frame.position).toEqual([0.8, 0, 10])
      expect(frame.clip).toBe('stand_idle')
      expect(frame.diagnostic).toBeNull()
      expect(frame.headbandVisible).toBe(false)
      expect(frame.workingHard).toBe(false)
      expect(service.runtime.getSnapshot().recruitments[id].state).toBe(
        'capability_checks_running',
      )
      finish(response())
      await service.waitForJob(id)
      expect(service.runtime.getSnapshot().recruitments[id].state).toBe('hired')
    } finally {
      finish?.(response())
      await service.waitForJob(id)
      store.dispose()
      publisher.dispose()
    }
  })
  it('permits explicit retry after a known-usage provider failure without stranding the Manager', async () => {
    let calls = 0
    const request = vi.fn<typeof fetch>(async () =>
        ++calls === 1
          ? new Response(
              JSON.stringify({
                status: 'failed',
                output: [],
                usage: { input_tokens: 30, output_tokens: 20 },
              }),
            )
          : response(),
      ),
      service = create({
        adapter: new OpenAIResponsesAdapter(request),
        credential: privateFixture,
      }),
      failed = await run(service, spec({ adapterMode: 'openai' }))
    expect(failed.state).toBe('technical_failure')
    expect(failed.failures.at(-1)?.retryable).toBe(true)
    expect(
      service.runtime.getSnapshot().agents[RECRUITMENT_MANAGER].status,
    ).not.toBe('blocked')
    service.retry(failed.recruitmentId)
    const retried =
      service.runtime.getSnapshot().recruitments[failed.recruitmentId]
    expect(retried.state).toBe('candidate_arriving')
    service.arrival(retried.recruitmentId, retried.scene!.intentId)
    managerArrival(service)
    await service.waitForJob(retried.recruitmentId)
    const result =
      service.runtime.getSnapshot().recruitments[retried.recruitmentId]
    expect(result.state).toBe('hired')
    expect(result.attempt).toBe(2)
    expect(result.failures).toHaveLength(1)
    expect(request.mock.calls.length).toBe(2)
  })
  it('does not restart uncertain paid work or consume another attempt before reconciliation', async () => {
    const request = vi.fn<typeof fetch>(
        async () => new Response(null, { status: 503 }),
      ),
      service = create({
        adapter: new OpenAIResponsesAdapter(request),
        credential: privateFixture,
      }),
      failed = await run(service, spec({ adapterMode: 'openai' }))
    expect(failed.state).toBe('technical_failure')
    expect(failed.failures.at(-1)?.retryable).toBe(false)
    expect(() => service.retry(failed.recruitmentId)).toThrow()
    expect(
      service.runtime.getSnapshot().recruitments[failed.recruitmentId],
    ).toEqual(failed)
    expect(request.mock.calls.length).toBe(1)
  })
  it('records route failure truthfully and never begins a blocked Manager interview or a partial retry', async () => {
    const service = create(),
      id = proposed(service)
    service.start(id)
    const manager = service.runtime.getSnapshot().agents[RECRUITMENT_MANAGER]
    service.feedback({
      type: 'rejectMovement',
      agentId: manager.id,
      intentId: manager.destination!.id,
      reason: 'Synthetic route refusal.',
    })
    const failed = service.runtime.getSnapshot().recruitments[id]
    expect(failed.state).toBe('technical_failure')
    expect(failed.failures.at(-1)).toMatchObject({
      code: 'NAVIGATION_UNAVAILABLE',
      retryable: false,
    })
    service.arrival(id, failed.scene!.intentId)
    expect(() => service.retry(id)).toThrow()
    expect(service.runtime.getSnapshot().recruitments[id].state).toBe(
      'technical_failure',
    )
    expect(service.runtime.getSnapshot().recruitments[id].attempt).toBe(1)
    expect(service.runtime.getSnapshot().employees).toEqual({})
  })
  it('cancels a queued assessment before it can submit an HTTP request', async () => {
    const { adapter, request } = liveAdapter(),
      service = create({ adapter, credential: privateFixture }),
      id = proposed(service, spec({ adapterMode: 'openai' }))
    service.start(id)
    service.arrival(
      id,
      service.runtime.getSnapshot().recruitments[id].scene!.intentId,
    )
    managerArrival(service)
    service.cancel(id)
    await service.waitForJob(id)
    expect(request.mock.calls.length).toBe(0)
    expect(service.runtime.getSnapshot().recruitments[id].state).toBe(
      'cancelled',
    )
    expect(service.runtime.getSnapshot().employees).toEqual({})
  })
  it('resumes an interrupted office bootstrap without duplicate records', () => {
    const repository = new InMemoryOfficeRuntimeRepository(),
      runtime = createOfficeRuntime({ repository })
    expect(runtime.dispatch({ type: 'connect' }).ok).toBe(true)
    expect(
      runtime.dispatch({
        type: 'registerDepartment',
        department: { id: 'executive', name: 'Executive' },
      }).ok,
    ).toBe(true)
    const service = create({ repository }),
      state = service.runtime.getSnapshot()
    expect(Object.keys(state.departments)).toHaveLength(7)
    expect(Object.keys(state.workstations)).toHaveLength(7)
    expect(state.agents[RECRUITMENT_MANAGER].kind).toBe('manager')
  })
  it('blocks a queued employee invocation when termination precedes submission', async () => {
    const { adapter, request } = liveAdapter(),
      service = create({ adapter, credential: privateFixture }),
      session = await run(service, spec({ adapterMode: 'openai' }))
    request.mockClear()
    const invocation = service.employeeTask(
      session.candidateId,
      'Review an authorized follow-up.',
    )
    service.terminate(
      session.candidateId,
      'CEO revoked operational access before submission.',
    )
    await expect(invocation).rejects.toBeDefined()
    expect(request.mock.calls.length).toBe(0)
    expect(
      service.runtime.getSnapshot().employees[session.candidateId].status,
    ).toBe('terminated')
  })
  it('includes only bounded own-agent memory in employee requests, never Manager private onboarding context', async () => {
    const { adapter, request } = liveAdapter(),
      service = create({ adapter, credential: privateFixture })
    const remember = (agentId: string, content: string) =>
      issue(service, {
        type: 'createMemory',
        agentId,
        memory: {
          scope: { kind: 'agent', id: agentId },
          type: 'semantic',
          content,
          trust: 'unverified',
          source: { kind: 'agent', id: agentId },
          reason: 'lesson',
          rationale: 'Explicit test-only memory for future authorized review.',
        },
      })
    remember(
      RECRUITMENT_MANAGER,
      'Review manager_private_fixture must remain private.',
    )
    const session = await run(service, spec({ adapterMode: 'openai' }))
    expect(
      JSON.stringify(request.mock.calls[0]?.[1]?.body).includes(
        'manager_private_fixture',
      ),
    ).toBe(false)
    issue(service, {
      type: 'registerAgent',
      agent: {
        id: 'other-worker',
        name: 'Other test worker',
        role: 'Reviewer',
        kind: 'standard-worker',
        departmentId: 'engineering',
        position: [0, 0, 0],
        headingRadians: 0,
      },
    })
    remember(
      'other-worker',
      'Review unrelated_worker_private_fixture must remain private.',
    )
    for (let n = 0; n < 5; n++)
      remember(
        session.candidateId,
        `Review own_private_fixture_${n} under its original unverified provenance.`,
      )
    const before = service.runtime.getSnapshot(),
      memoryCount = Object.keys(before.memories).length
    await service.employeeTask(
      session.candidateId,
      'Review the authorized example.',
    )
    const body = JSON.parse(request.mock.calls.at(-1)![1]!.body as string)
    const prompt = body.input[0].content as string
    expect(prompt).toContain('own_private_fixture_')
    expect(prompt.includes('manager_private_fixture')).toBe(false)
    expect(prompt.includes('unrelated_worker_private_fixture')).toBe(false)
    const serialized = prompt.split(
      'Scoped memory evidence (preserve source and trust):\n',
    )[1]!
    expect(serialized.length).toBeLessThanOrEqual(2000)
    const context = JSON.parse(serialized)
    expect(context.memories.length).toBeGreaterThan(0)
    expect(context.memories.length).toBeLessThanOrEqual(3)
    expect(
      context.memories.every(
        (memory: {
          trust: string
          source: { id: string }
          scope: { id: string }
        }) =>
          memory.trust === 'unverified' &&
          memory.source.id === session.candidateId &&
          memory.scope.id === session.candidateId,
      ),
    ).toBe(true)
    const after = service.runtime.getSnapshot()
    expect(Object.keys(after.memories)).toHaveLength(memoryCount)
    expect(after.memories).toBe(before.memories)
    expect(
      after.events
        .slice(before.events.length)
        .filter((event) => event.type === 'MEMORY_CREATED'),
    ).toHaveLength(0)
  })
  it('does not retrieve memory when the approved employee configuration has no memory scope', async () => {
    const { adapter, request } = liveAdapter(),
      service = create({ adapter, credential: privateFixture }),
      session = await run(
        service,
        spec({ adapterMode: 'openai', memoryScopes: [] }),
      )
    issue(service, {
      type: 'createMemory',
      agentId: session.candidateId,
      memory: {
        scope: { kind: 'agent', id: session.candidateId },
        type: 'semantic',
        content: 'Review private_disabled_fixture.',
        trust: 'unverified',
        source: { kind: 'agent', id: session.candidateId },
        reason: 'lesson',
        rationale: 'Explicit test-only memory.',
      },
    })
    const revision = service.runtime.getSnapshot().events.length
    await service.employeeTask(
      session.candidateId,
      'Review the authorized example.',
    )
    expect(
      String(request.mock.calls.at(-1)![1]!.body).includes(
        'private_disabled_fixture',
      ),
    ).toBe(false)
    expect(
      service.runtime
        .getSnapshot()
        .events.slice(revision)
        .some((event) => event.type === 'MEMORY_RETRIEVED'),
    ).toBe(false)
  })
})
