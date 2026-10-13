// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { ProviderAdapterInput } from '../providers/ProviderRegistry'
import {
  OpenAIResponsesAdapter,
  RECRUITMENT_MODEL,
} from './OpenAIResponsesAdapter'

const privateFixture = 'SYNTHETIC_RECRUITMENT_ADAPTER_VALUE_ONLY'
const input = (
  patch: Partial<ProviderAdapterInput> = {},
): ProviderAdapterInput => ({
  modelId: RECRUITMENT_MODEL,
  capability: 'structured',
  input: {
    instructions: 'Respect the approved boundaries.',
    prompt: 'Explain authorized repository review.',
  },
  maxOutputUnits: 100,
  credential: privateFixture,
  signal: new AbortController().signal,
  ...patch,
})
const message = (answer = 'A bounded work sample.') => ({
  type: 'message',
  role: 'assistant',
  status: 'completed',
  content: [{ type: 'output_text', text: JSON.stringify({ answer }) }],
})
const response = (patch: Record<string, unknown> = {}) => ({
  status: 'completed',
  output: [message()],
  usage: { input_tokens: 30, output_tokens: 20 },
  ...patch,
})
const setup = (body: unknown = response()) => {
  const request = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
      }),
  )
  return { request, adapter: new OpenAIResponsesAdapter(request) }
}

describe('host OpenAI Responses recruitment adapter', () => {
  it('uses only the fixed model/endpoint, no provider tools, strict output schema and store:false', async () => {
    const { request, adapter } = setup()
    const result = await adapter.execute(input())
    expect(result).toEqual({
      status: 'completed',
      output: { answer: 'A bounded work sample.' },
      usage: { inputUnits: 30, outputUnits: 20 },
    })
    const [url, options] = request.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(options?.method).toBe('POST')
    expect(options?.redirect).toBe('error')
    expect(
      new Headers(options?.headers).get('Authorization') ===
        `Bearer ${privateFixture}`,
    ).toBe(true)
    const body = JSON.parse(options?.body as string)
    expect(body).toMatchObject({
      model: 'gpt-6-astra',
      store: false,
      reasoning: { effort: 'low' },
      max_output_tokens: 100,
      text: {
        format: {
          type: 'json_schema',
          strict: true,
          schema: { additionalProperties: false, required: ['answer'] },
        },
      },
    })
    expect(body).not.toHaveProperty('tools')
    expect(body).not.toHaveProperty('previous_response_id')
    expect(JSON.stringify(result).includes(privateFixture)).toBe(false)
  })

  it('estimates UTF-8 prompt, schema and message framing before dispatch', async () => {
    const { request, adapter } = setup()
    const options = input({
      input: {
        instructions: 'Approved policy.',
        prompt: 'Explain 🔐 permissions सुरक्षित',
      },
    })
    const estimate = adapter.estimateInputUnits(options.input)
    await adapter.execute(options)
    const actualProtocol = request.mock.calls[0]![1]!.body as string
    expect(estimate).toBeGreaterThan(Buffer.byteLength(actualProtocol, 'utf8'))
    expect(estimate).toBeGreaterThan(
      Buffer.byteLength(JSON.stringify(options.input), 'utf8'),
    )
    expect(estimate).toBe(adapter.estimateInputUnits(options.input))
  })

  it.each([
    { modelId: 'unapproved-model' },
    { capability: 'text' },
    { maxOutputUnits: 0 },
    { maxOutputUnits: -1 },
    { maxOutputUnits: 100001 },
    { maxOutputUnits: 1.5 },
    { input: { instructions: '', prompt: 'A question' } },
    {
      input: {
        instructions: 'Approved',
        prompt: 'A question',
        url: 'https://elsewhere.invalid',
      },
    },
    { input: { instructions: 'Approved', prompt: 'x'.repeat(16000) } },
    {
      input: {
        instructions: 'Approved',
        prompt: 'password=synthetic-test-only',
      },
    },
  ] as Partial<ProviderAdapterInput>[])(
    'rejects malformed/unapproved request %j before network access',
    async (patch) => {
      const { request, adapter } = setup()
      await expect(adapter.execute(input(patch))).rejects.toMatchObject({
        code: 'PROVIDER_OUTPUT_INVALID',
      })
      expect(request).not.toHaveBeenCalled()
    },
  )

  it('uses abort signal and does not request an already cancelled operation', async () => {
    const controller = new AbortController()
    controller.abort()
    const { request, adapter } = setup()
    await expect(
      adapter.execute(input({ signal: controller.signal })),
    ).rejects.toMatchObject({ code: 'PROVIDER_CANCELLED' })
    expect(request).not.toHaveBeenCalled()
    const active = input()
    await adapter.execute(active)
    expect(request.mock.calls[0]![1]!.signal).toBe(active.signal)
  })

  it('discards non-success response bodies and raw network failures without leaking details', async () => {
    const rejected = new OpenAIResponsesAdapter(
      async () => new Response(privateFixture, { status: 403 }),
    )
    expect(await rejected.execute(input())).toEqual({
      status: 'failed',
      output: null,
      usage: null,
    })
    const failed = new OpenAIResponsesAdapter(async () => {
      throw new Error(privateFixture)
    })
    try {
      await failed.execute(input())
    } catch (error) {
      expect(String(error).includes(privateFixture)).toBe(false)
      expect(error).toMatchObject({ code: 'PROVIDER_OUTPUT_INVALID' })
    }
  })

  it('bounds streamed response bytes, cancels overflow and returns no raw response', async () => {
    const cancel = vi.fn()
    const adapter = new OpenAIResponsesAdapter(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(262145))
            },
            cancel,
          }),
        ),
    )
    await expect(adapter.execute(input())).rejects.toMatchObject({
      code: 'PROVIDER_OUTPUT_INVALID',
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each([null, [], 42, 'not an object'])(
    'rejects malformed response root without unsafe exceptions: %j',
    async (body) => {
      await expect(setup(body).adapter.execute(input())).rejects.toMatchObject({
        code: 'PROVIDER_OUTPUT_INVALID',
      })
    },
  )

  it.each([
    { status: 'incomplete' },
    { status: 'failed' },
    { usage: null },
    { usage: { input_tokens: -1, output_tokens: 20 } },
    { usage: { input_tokens: 1.5, output_tokens: 20 } },
    { usage: { input_tokens: 10, output_tokens: Number.MAX_SAFE_INTEGER + 1 } },
    { output: [null] },
    { output: [] },
    {
      output: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'refusal', refusal: privateFixture }],
        },
      ],
    },
    { output: [{ ...message(), status: 'incomplete' }] },
    { output: [{ ...message(), role: 'user' }] },
    { output: [message(), message()] },
    {
      output: [
        { type: 'function_call', name: 'unrequested_tool', arguments: '{}' },
      ],
    },
    { output: [message('password=synthetic-test-only')] },
    { output: [message('')] },
    { output: [message('x'.repeat(12001))] },
    {
      output: [
        {
          ...message(),
          content: [
            { type: 'output_text', text: '{"answer":"A","unexpected":true}' },
          ],
        },
      ],
    },
  ])(
    'does not pass incomplete, refused, unsafe or malformed output %#',
    async (patch) => {
      const result = await setup(response(patch)).adapter.execute(input())
      expect(result.status).toBe('failed')
      expect(result.output).toBeNull()
      expect(JSON.stringify(result).includes(privateFixture)).toBe(false)
    },
  )

  it('preserves actual overrun/failure usage for accounting without accepting the output', async () => {
    const overrun = { input_tokens: 90000, output_tokens: 1000 }
    expect(
      await setup(response({ usage: overrun })).adapter.execute(input()),
    ).toEqual({
      status: 'failed',
      output: null,
      usage: { inputUnits: 90000, outputUnits: 1000 },
    })
    expect(
      await setup(response({ status: 'incomplete' })).adapter.execute(input()),
    ).toEqual({
      status: 'failed',
      output: null,
      usage: { inputUnits: 30, outputUnits: 20 },
    })
  })

  it('does not expose reasoning or provider metadata as assessed work', async () => {
    const result = await setup(
      response({
        output: [
          { type: 'reasoning', summary: [{ text: privateFixture }] },
          message(),
        ],
        metadata: { internal: privateFixture },
      }),
    ).adapter.execute(input())
    expect(result.status).toBe('completed')
    expect(JSON.stringify(result).includes(privateFixture)).toBe(false)
  })
})
