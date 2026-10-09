import type { ResearchProvider, ResearchResponse } from '../tools/researchTool'

/** Development fixture only. Its result explicitly says no real research was performed. */
export class DeterministicResearchProvider implements ResearchProvider {
  readonly mode = 'fixture' as const
  async search(_query: string, signal: AbortSignal): Promise<ResearchResponse> {
    signal.throwIfAborted()
    return {
      mode: 'fixture',
      summary:
        'Deterministic development fixture. No web search or factual research was performed.',
      results: [
        {
          title: 'Execution boundary fixture',
          excerpt:
            'The supplied query passed through the registered research tool and host permission checks.',
          url: null,
        },
      ],
    }
  }
}
