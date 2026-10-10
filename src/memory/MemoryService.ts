import type {
  MemoryQuery,
  MemoryRepository,
  MemoryTaskContextRequest,
  MemoryWriteInput,
} from './memoryTypes'

/** Explicit application operations. No subscription that stores tool outputs or thoughts. */
export class MemoryService {
  readonly #repository: MemoryRepository
  constructor(repository: MemoryRepository) {
    this.#repository = repository
  }
  remember(input: MemoryWriteInput) {
    return this.#repository.add(input)
  }
  recall(query: MemoryQuery) {
    return this.#repository.search(query)
  }
  forTask(request: MemoryTaskContextRequest) {
    return this.#repository.buildContext(request)
  }
}
