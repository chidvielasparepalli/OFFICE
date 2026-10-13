import { describe, expect, it } from 'vitest'
import { estimateRecruitmentCost } from './recruitmentCost'
import type { RecruitmentSpec } from './recruitmentTypes'

describe('conservative recruitment cost review', () => {
  const spec: RecruitmentSpec = {
    name: 'Synthetic analyst',
    role: 'Analyst',
    departmentId: 'engineering',
    adapterMode: 'openai',
    instructions: 'Bounded instructions',
    mission: 'Synthetic work',
    maxOutputUnits: 128,
    budgetMicros: 1000000,
    responsibilities: ['Explain fixtures'],
    personality: 'Calm',
    providerId: 'openai',
    modelId: 'gpt-6-astra',
    toolIds: ['provider.invoke'],
    memoryScopes: ['agent'],
    knowledgeIds: [],
    collaboratorIds: [],
    managerId: 'recruitment-manager',
    skills: [
      {
        id: 'fixture',
        description: 'Explain a fixture',
        mandatory: true,
        prompt: 'Explain a fixture',
        expectedIncludes: ['fixture'],
      },
    ],
  }
  it('calculates a deterministic integer upper estimate without a provider call', () => {
    const input = JSON.stringify({
      instructions: `${spec.instructions}\nRole: ${spec.role}\nMission: ${spec.mission}\nResponsibilities: ${spec.responsibilities.join('; ')}\nWorking style: ${spec.personality}\nRespond with the requested work sample only. You cannot execute tools or grant permissions.`,
      prompt: spec.skills[0].prompt,
    })
    expect(estimateRecruitmentCost(spec)).toBe(
      (new TextEncoder().encode(input).byteLength + 4096) * 13 + 128 * 50,
    )
    expect(
      estimateRecruitmentCost({
        ...spec,
        skills: [...spec.skills, ...spec.skills],
      }),
    ).toBe(estimateRecruitmentCost(spec)! * 2)
  })
  it('shows zero simulated spend and refuses unsafe arithmetic instead of inventing a price', () => {
    expect(
      estimateRecruitmentCost({ ...spec, adapterMode: 'mock-success' }),
    ).toBe(0)
    expect(
      estimateRecruitmentCost({
        ...spec,
        maxOutputUnits: Number.MAX_SAFE_INTEGER,
      }),
    ).toBeNull()
    expect(estimateRecruitmentCost({ ...spec, maxOutputUnits: NaN })).toBeNull()
  })
})
