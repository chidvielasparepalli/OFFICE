import { describe, expect, it } from 'vitest'
import type { RuntimeJson } from '../runtime/runtimeTypes'
import type { ToolExecutionResult } from '../tools/toolTypes'
import { evaluateQA, qaExecutionInput, validateQARequest } from './qaPolicy'
import type { QAAssertion, QACheck, QARequest, QARequestInput } from './qaTypes'

const timestamp = '2026-10-11T10:00:00.000Z'
const check: QACheck = {
  checkId: 'structure',
  title: 'Required structure',
  type: 'structure',
  required: true,
  severity: 'error',
  toolId: 'validation.inspect',
  input: { artifact: 'sample' },
  assertion: { kind: 'equals', path: ['valid'], value: true },
}
const input = (patch: Partial<QARequestInput> = {}): QARequestInput => ({
  taskId: 'task',
  requestedBy: 'manager',
  scope: 'Artifact structure',
  checks: [check],
  repairCapabilities: ['frontend'],
  ...patch,
})
const request = (checks: readonly QACheck[] = [check]): QARequest => ({
  ...input(),
  qaId: 'qa',
  agentId: 'worker',
  artifactId: 'artifact',
  checks,
  priority: 'normal',
  status: 'running',
  maxRepairAttempts: 2,
  rootQaId: 'qa',
  previousQaId: null,
  repairId: null,
  attempt: 0,
  verifierAgentId: 'verifier',
  inspectionTaskId: 'inspection',
  executionIds: Object.fromEntries(
    checks.map((item) => [item.checkId, `execution:${item.checkId}`]),
  ),
  result: null,
  createdAt: timestamp,
  startedAt: timestamp,
  completedAt: null,
})
const execution = (
  patch: Partial<ToolExecutionResult> = {},
): ToolExecutionResult => ({
  executionId: 'execution:structure',
  agentId: 'verifier',
  taskId: 'inspection',
  toolId: 'validation.inspect',
  status: 'completed',
  requestedAt: timestamp,
  startedAt: timestamp,
  completedAt: timestamp,
  inputSummary: {},
  permission: {
    allowed: true,
    code: 'ALLOWED',
    reason: 'Explicit host grant.',
    requiredPermissions: ['read'],
  },
  output: { valid: true },
  error: null,
  metadata: {},
  ...patch,
})
const run = (assertion: QAAssertion, output: RuntimeJson) =>
  evaluateQA(
    request([{ ...check, assertion }]),
    { 'execution:structure': execution({ output }) },
    timestamp,
  )

describe('QA check configuration', () => {
  it('normalizes bounded explicit checks without mutating caller data', () => {
    const value = input()
    const validated = validateQARequest(value)
    expect(validated).toMatchObject({
      priority: 'normal',
      maxRepairAttempts: 2,
    })
    expect(value.maxRepairAttempts).toBeUndefined()
    expect(validated.checks).not.toBe(value.checks)
  })

  it.each([
    { checks: [] },
    {
      checks: Array.from({ length: 17 }, (_, index) => ({
        ...check,
        checkId: `c${index}`,
      })),
    },
    { checks: [check, check] },
    { checks: [{ ...check, required: false }] },
    { maxRepairAttempts: -1 },
    { maxRepairAttempts: 6 },
    { maxRepairAttempts: 1.5 },
    { repairCapabilities: [] },
    { repairCapabilities: ['frontend', 'frontend'] },
  ])('rejects malformed or unbounded request %#', (patch) => {
    expect(() => validateQARequest(input(patch))).toThrow()
  })

  it.each([
    { ...check, required: 'true' },
    { ...check, severity: 'catastrophic' },
    { ...check, type: 'arbitrary-code' },
    { ...check, assertion: { kind: 'execute', path: [] } },
    { ...check, assertion: { kind: 'exists', path: ['constructor'] } },
    { ...check, assertion: { kind: 'exists', path: [], value: true } },
    { ...check, assertion: { kind: 'maximum', path: [], value: '10' } },
    { ...check, assertion: { kind: 'includes', path: [], value: '' } },
    { ...check, assertion: { kind: 'equals', path: [] } },
  ])('rejects unsupported check data %#', (invalid) => {
    expect(() =>
      validateQARequest(input({ checks: [invalid as QACheck] })),
    ).toThrow()
  })

  it('applies the unchanged Phase 8 secret boundary to persisted check input', () => {
    expect(() =>
      validateQARequest(
        input({
          checks: [
            {
              ...check,
              input: { nested: { note: 'password=synthetic-qa-fixture' } },
            },
          ],
        }),
      ),
    ).toThrow('Credential-like content cannot be stored')
  })
})

describe('immutable artifact evidence binding', () => {
  const binding = {
    artifactId: 'artifact:v1',
    version: 1,
    sha256: 'a'.repeat(64),
  }
  const bound = (): QARequest => ({
    ...request([{ ...check, input: { format: 'document' } }]),
    artifactId: binding.artifactId,
    artifactBinding: binding,
  })

  it('injects only the runtime-owned target while preserving policy and input', () => {
    const qa = bound()
    expect(qaExecutionInput(qa, qa.checks[0])).toEqual({
      format: 'document',
      artifact: binding,
    })
    expect(qa.checks[0].input).toEqual({ format: 'document' })
    expect(check.input).toEqual({ artifact: 'sample' })
    expect(qaExecutionInput(request(), check)).toBe(check.input)
  })

  it.each([null, [], 'unstructured', { artifact: binding }])(
    'rejects caller-owned binding or unstructured artifact input %#',
    (invalid) => {
      expect(() =>
        validateQARequest(
          input({
            artifactId: binding.artifactId,
            checks: [{ ...check, input: invalid }],
          }),
        ),
      ).toThrow()
    },
  )

  it('requires and retains exact artifact identity from completed tool evidence', () => {
    const qa = bound()
    const result = evaluateQA(
      qa,
      {
        'execution:structure': execution({
          output: { valid: true, artifact: binding },
        }),
      },
      timestamp,
    )
    expect(result.status).toBe('passed')
    expect(result.artifactBinding).toEqual(binding)
  })

  it.each([
    undefined,
    { ...binding, artifactId: 'different' },
    { ...binding, version: 2 },
    { ...binding, sha256: 'b'.repeat(64) },
    { ...binding, extra: true },
  ])(
    'never verifies an absent or mismatched content version %#',
    (artifact) => {
      const result = evaluateQA(
        bound(),
        {
          'execution:structure': execution({
            output: artifact ? { valid: true, artifact } : { valid: true },
          }),
        },
        timestamp,
      )
      expect(result.status).toBe('blocked')
      expect(result.evidence[0].errorCode).toBe('ARTIFACT_EVIDENCE_MISMATCH')
    },
  )

  it('blocks stale, superseded or archived registry targets despite passing tool assertions', () => {
    const result = evaluateQA(
      bound(),
      {
        'execution:structure': execution({
          output: { valid: true, artifact: binding },
        }),
      },
      timestamp,
      false,
    )
    expect(result.status).toBe('blocked')
    expect(result.evidence[0].errorCode).toBe('ARTIFACT_CHANGED')
  })
})

describe('QA evidence and deterministic decisions', () => {
  it('cannot produce a vacuous pass without required checks', () => {
    expect(() => evaluateQA(request([]), {}, timestamp)).toThrow()
  })
  it.each([
    [{ kind: 'exists', path: ['document'] }, { document: 'Present' }],
    [
      { kind: 'equals', path: [], value: { b: 2, a: 1 } },
      { a: 1, b: 2 },
    ],
    [
      { kind: 'includes', path: ['body'], value: 'Required section' },
      { body: 'Title\nRequired section\nDetails' },
    ],
    [{ kind: 'maximum', path: ['bytes'], value: 1024 }, { bytes: 1024 }],
    [{ kind: 'no-credentials', path: [] }, { body: 'Ordinary documentation' }],
  ] satisfies [QAAssertion, RuntimeJson][])(
    'evaluates explicit %j assertions',
    (assertion, output) => {
      expect(run(assertion, output).status).toBe('passed')
    },
  )

  it.each([
    [{ kind: 'exists', path: ['missing'] }, {}],
    [{ kind: 'exists', path: [] }, null],
    [{ kind: 'equals', path: [], value: [1, 2] }, [2, 1]],
    [{ kind: 'includes', path: [], value: 'Required' }, 'Different'],
    [{ kind: 'maximum', path: [], value: 10 }, 11],
    [{ kind: 'maximum', path: [], value: 10 }, '5'],
    [{ kind: 'no-credentials', path: [] }, 'password=synthetic-qa-fixture'],
    [{ kind: 'no-credentials', path: [] }, { note: 'Bearer [REDACTED]' }],
  ] satisfies [QAAssertion, RuntimeJson][])(
    'fails explicit %j assertions',
    (assertion, output) => {
      expect(run(assertion, output).status).toBe('failed')
    },
  )

  it('records factual references and severity without copying observed contents', () => {
    const result = run(
      { kind: 'equals', path: ['valid'], value: true },
      { valid: false, detail: 'PRIVATE FIXTURE BODY' },
    )
    expect(result).toMatchObject({
      status: 'failed',
      failedChecks: ['structure'],
      severity: 'error',
      verifier: { agentId: 'verifier', taskId: 'inspection' },
    })
    expect(result.findings[0]).toMatchObject({
      checkId: 'structure',
      affectedTaskId: 'task',
      affectedArtifactId: 'artifact',
      suggestedRepairType: 'structure',
    })
    expect(result.evidence).toEqual([
      {
        executionId: 'execution:structure',
        toolId: 'validation.inspect',
        path: ['valid'],
        matched: false,
        errorCode: null,
      },
    ])
    expect(JSON.stringify(result)).not.toContain('PRIVATE FIXTURE BODY')
  })

  it.each([
    { toolId: 'different' },
    { agentId: 'different' },
    { taskId: 'different' },
    { executionId: 'different' },
  ])('rejects mismatched evidence identity %#', (patch) => {
    const result = evaluateQA(
      request(),
      { 'execution:structure': execution(patch) },
      timestamp,
    )
    expect(result.status).toBe('blocked')
    expect(result.evidence[0]).toMatchObject({
      matched: null,
      errorCode: 'EVIDENCE_IDENTITY_MISMATCH',
    })
  })

  it.each(['queued', 'running', 'failed', 'cancelled'] as const)(
    'blocks %s tool evidence',
    (status) => {
      expect(
        evaluateQA(
          request(),
          { 'execution:structure': execution({ status }) },
          timestamp,
        ).status,
      ).toBe('blocked')
    },
  )

  it('blocks denied, missing and malformed evidence without claiming pass', () => {
    const denied = execution({
      permission: {
        allowed: false,
        code: 'PERMISSION_DENIED',
        reason: 'Denied',
        requiredPermissions: ['read'],
      },
    })
    expect(
      evaluateQA(request(), { 'execution:structure': denied }, timestamp)
        .status,
    ).toBe('blocked')
    expect(evaluateQA(request(), {}, timestamp)).toMatchObject({
      status: 'blocked',
      evidence: [],
    })
    expect(run({ kind: 'exists', path: [] }, { amount: NaN }).status).toBe(
      'blocked',
    )
  })

  it('allows only nonrequired low-severity findings to pass and preserves findings', () => {
    const optional = {
      ...check,
      checkId: 'optional',
      required: false,
      severity: 'warning' as const,
    }
    const records = {
      'execution:structure': execution(),
      'execution:optional': execution({
        executionId: 'execution:optional',
        output: { valid: false },
      }),
    }
    const passed = evaluateQA(request([check, optional]), records, timestamp)
    expect(passed).toMatchObject({
      status: 'passed',
      failedChecks: ['optional'],
      severity: 'warning',
    })
    expect(passed.findings).toHaveLength(1)
    expect(
      evaluateQA(
        request([check, { ...optional, severity: 'critical' }]),
        records,
        timestamp,
      ).status,
    ).toBe('failed')
  })

  it('prioritizes unavailable required verification over an observed failure', () => {
    const missing = { ...check, checkId: 'missing' }
    expect(
      evaluateQA(
        request([check, missing]),
        { 'execution:structure': execution({ output: { valid: false } }) },
        timestamp,
      ).status,
    ).toBe('blocked')
  })
})
