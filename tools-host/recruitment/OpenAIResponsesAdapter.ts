import { Buffer } from 'node:buffer'
import { memoryObject, memorySafeJson } from '../../src/memory/memoryPolicy'
import type { RuntimeJson } from '../../src/runtime/runtimeTypes'
import { ToolFault } from '../../src/tools/toolTypes'
import type {
  ProviderAdapter,
  ProviderAdapterInput,
  ProviderAdapterResult,
} from '../providers/ProviderRegistry'

export const RECRUITMENT_MODEL = 'gpt-6-astra'
const ENDPOINT = 'https://api.openai.com/v1/responses'
const FORMAT = {
  type: 'json_schema',
  name: 'candidate_work_sample',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { answer: { type: 'string' } },
    required: ['answer'],
  },
} as const
const invalid = () =>
  new ToolFault(
    'PROVIDER_OUTPUT_INVALID',
    'The provider did not return a usable work sample.',
  )
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const units = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0

/** Only the broker receives the credential. No model-selected tools or URL are accepted. */
export class OpenAIResponsesAdapter implements ProviderAdapter {
  readonly #request: typeof fetch
  constructor(request: typeof fetch = fetch) {
    this.#request = request
  }

  estimateInputUnits(input: RuntimeJson): number {
    // UTF-8 bytes conservatively bound text tokens; reserve schema and message framing too.
    return (
      Buffer.byteLength(JSON.stringify(input)) +
      Buffer.byteLength(JSON.stringify(FORMAT)) +
      2048
    )
  }

  async execute(input: ProviderAdapterInput): Promise<ProviderAdapterResult> {
    try {
      return await this.run(input)
    } catch {
      // Raw network/parser errors can contain prompts or credentials. Only fixed public codes escape.
      if (input.signal.aborted)
        throw new ToolFault(
          'PROVIDER_CANCELLED',
          'The provider request was cancelled.',
        )
      throw invalid()
    }
  }

  private async run(
    input: ProviderAdapterInput,
  ): Promise<ProviderAdapterResult> {
    if (
      input.signal.aborted ||
      input.modelId !== RECRUITMENT_MODEL ||
      input.capability !== 'structured' ||
      !units(input.maxOutputUnits) ||
      input.maxOutputUnits < 1 ||
      input.maxOutputUnits > 100000
    )
      throw invalid()
    const data = memoryObject(input.input, ['instructions', 'prompt'])
    memorySafeJson(data, 16000)
    if (
      typeof data.instructions !== 'string' ||
      !data.instructions.trim() ||
      typeof data.prompt !== 'string' ||
      !data.prompt.trim()
    )
      throw invalid()
    const response = await this.#request(ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      signal: input.signal,
      headers: {
        Authorization: `Bearer ${input.credential}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: input.modelId,
        store: false,
        instructions: data.instructions,
        input: [{ role: 'user', content: data.prompt }],
        max_output_tokens: input.maxOutputUnits,
        reasoning: { effort: 'low' },
        text: { format: FORMAT },
      }),
    })
    // Do not copy provider errors (which can echo prompts or credentials) into runtime history.
    if (!response.ok) {
      await response.body?.cancel()
      return { status: 'failed', output: null, usage: null }
    }
    const reader = response.body?.getReader()
    if (!reader) throw invalid()
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > 262144) {
          await reader.cancel()
          throw invalid()
        }
        chunks.push(chunk.value)
      }
    } finally {
      reader.releaseLock()
    }
    const result: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!object(result)) throw invalid()
    const rawUsage = result.usage
    const usage =
      object(rawUsage) &&
      units(rawUsage.input_tokens) &&
      units(rawUsage.output_tokens)
        ? {
            inputUnits: rawUsage.input_tokens,
            outputUnits: rawUsage.output_tokens,
          }
        : null
    const failed: ProviderAdapterResult = {
      status: 'failed',
      output: null,
      usage,
    }
    // Keep observed overrun usage for the ledger; do not return its output as usable work.
    if (
      !usage ||
      usage.inputUnits > this.estimateInputUnits(input.input) ||
      usage.outputUnits > input.maxOutputUnits ||
      result.status !== 'completed' ||
      !Array.isArray(result.output)
    )
      return failed
    let text: string | null = null
    for (const item of result.output) {
      if (!object(item)) return failed
      if (item.type === 'reasoning') continue
      if (
        item.type !== 'message' ||
        item.role !== 'assistant' ||
        item.status !== 'completed' ||
        !Array.isArray(item.content) ||
        item.content.length !== 1 ||
        text !== null
      )
        return failed
      const content: unknown = item.content[0]
      if (
        !object(content) ||
        content.type !== 'output_text' ||
        typeof content.text !== 'string'
      )
        return failed
      text = content.text
    }
    if (text === null) return failed
    try {
      const output = memoryObject(JSON.parse(text), ['answer'])
      if (
        typeof output.answer !== 'string' ||
        !output.answer.trim() ||
        output.answer.length > 12000
      )
        return failed
      memorySafeJson(output, 16000)
      return { status: 'completed', output, usage }
    } catch {
      return failed
    }
  }
}
