import { ToolFault, type Tool } from './toolTypes'
import { toolObject, toolText } from './toolValidation'

export type ResearchResponse = {
  mode: 'fixture' | 'live'
  summary: string
  results: { title: string; excerpt: string; url: string | null }[]
}

/** A future provider runs on the host and returns structured, attributable results. */
export interface ResearchProvider {
  readonly mode: 'fixture' | 'live'
  search(query: string, signal: AbortSignal): Promise<ResearchResponse>
}

export function createResearchTool(
  provider: ResearchProvider,
): Tool<{ query: string }, ResearchResponse> {
  return {
    id: 'research.search',
    name: 'Research',
    category: 'research',
    description:
      provider.mode === 'fixture'
        ? 'Explicit development fixture; does not search the web.'
        : 'Search through the configured host research provider.',
    capabilities: ['research.search'],
    permissions: provider.mode === 'fixture' ? ['read'] : ['read', 'network'],
    allowedKinds: ['standard-worker', 'manager'],
    timeoutMs: 15_000,
    metadata: { mode: provider.mode },
    inputSchema: {
      description: '{ query: nonempty text, maximum 2000 characters }',
      parse(value) {
        const record = toolObject(value, ['query'])
        return { query: toolText(record.query, 'Research query', 2000) }
      },
    },
    outputSchema: {
      description:
        'Research mode, summary and at most 20 attributable results.',
      parse(value) {
        try {
          const record = toolObject(value, ['mode', 'summary', 'results'])
          if (
            record.mode !== provider.mode ||
            !Array.isArray(record.results) ||
            record.results.length > 20
          )
            throw new Error('Invalid research result')
          return {
            mode: provider.mode,
            summary: toolText(record.summary, 'Research summary', 4000),
            results: record.results.map((item) => {
              const result = toolObject(item, ['title', 'excerpt', 'url'])
              const url =
                result.url === null
                  ? null
                  : toolText(result.url, 'Source URL', 2000)
              if (
                url !== null &&
                !['https:', 'http:'].includes(new URL(url).protocol)
              )
                throw new Error('Invalid source URL')
              if (provider.mode === 'live' && url === null)
                throw new Error('Missing source URL')
              return {
                title: toolText(result.title, 'Result title', 300),
                excerpt: toolText(result.excerpt, 'Result excerpt', 3000),
                url,
              }
            }),
          }
        } catch {
          throw new ToolFault(
            'INVALID_OUTPUT',
            'Research provider returned an invalid structured result.',
          )
        }
      },
    },
    summarizeInput: (input) => ({ queryCharacters: input.query.length }),
    execute: (input, context) => provider.search(input.query, context.signal),
  }
}
