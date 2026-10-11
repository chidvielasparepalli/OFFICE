import { artifactAssert } from './artifactPolicy'
import { hashArtifactBytes } from './ArtifactStorage'
import type {
  ArtifactCreateInput,
  ArtifactRepository,
  ArtifactStorage,
  ArtifactVersionInput,
} from './artifactTypes'

/** Explicit metadata creation and authorized content reads; no automatic tool-output capture. */
export class ArtifactService {
  readonly #repository: ArtifactRepository
  readonly #storage: ArtifactStorage
  constructor(repository: ArtifactRepository, storage: ArtifactStorage) {
    this.#repository = repository
    this.#storage = storage
  }
  create(input: ArtifactCreateInput) {
    return this.#repository.create(input)
  }
  createVersion(
    id: string,
    expectedRevision: number,
    input: ArtifactVersionInput,
  ) {
    return this.#repository.createVersion(id, expectedRevision, input)
  }
  async read(id: string): Promise<Uint8Array> {
    const artifact = this.#repository.get(id)
    artifactAssert(
      artifact,
      'ARTIFACT_NOT_FOUND',
      'Artifact version is unavailable.',
    )
    const bytes = await this.#storage.read(artifact.content)
    const hash = await hashArtifactBytes(bytes)
    artifactAssert(
      this.#repository.canRead(id),
      'ARTIFACT_ACCESS_DENIED',
      'Artifact access is no longer authorized.',
    )
    artifactAssert(
      hash === artifact.content.sha256 &&
        bytes.byteLength === artifact.content.byteLength,
      'ARTIFACT_INTEGRITY',
      'Stored content does not match the immutable artifact identity.',
    )
    return bytes
  }
}
