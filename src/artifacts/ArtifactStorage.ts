import { memorySafeJson } from '../memory/memoryPolicy'
import {
  ArtifactFault,
  type ArtifactContentReference,
  type ArtifactStorage,
} from './artifactTypes'

export async function hashArtifactBytes(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new Uint8Array(bytes),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** Trusted storage adapter. Agents read content through their principal-bound service. */
export class InMemoryArtifactStorage implements ArtifactStorage {
  private readonly content = new Map<
    string,
    { reference: ArtifactContentReference; bytes: Uint8Array }
  >()
  private size = 0
  async put(
    bytes: Uint8Array,
    mediaType: string,
  ): Promise<ArtifactContentReference> {
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength > 8 * 1024 * 1024 ||
      mediaType.length > 52 ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/u.test(mediaType)
    )
      throw new ArtifactFault(
        'INVALID_CONTENT',
        'Content must have a supported media type and at most 8 MiB.',
      )
    const copy = new Uint8Array(bytes)
    if (
      mediaType.startsWith('text/') ||
      /json|javascript|xml/u.test(mediaType)
    ) {
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(copy)
      } catch {
        throw new ArtifactFault(
          'INVALID_CONTENT',
          'Text content must be valid UTF-8.',
        )
      }
      memorySafeJson(text, 64 * 1024 * 1024)
    }
    const sha256 = await hashArtifactBytes(copy)
    const contentId = `${sha256}:${mediaType.replace('/', ':').replaceAll('+', '_')}`
    const prior = this.content.get(contentId)
    if (prior) return prior.reference
    if (this.size + copy.byteLength > 64 * 1024 * 1024)
      throw new ArtifactFault(
        'STORAGE_LIMIT',
        'Development content storage is limited to 64 MiB.',
      )
    const reference = Object.freeze({
      storageId: 'memory',
      contentId,
      sha256,
      byteLength: copy.byteLength,
      mediaType,
    })
    this.content.set(contentId, { reference, bytes: copy })
    this.size += copy.byteLength
    return reference
  }
  inspect(
    reference: ArtifactContentReference,
  ): ArtifactContentReference | null {
    const stored = this.content.get(reference.contentId)
    return stored &&
      Object.keys(stored.reference).every(
        (key) =>
          stored.reference[key as keyof ArtifactContentReference] ===
          reference[key as keyof ArtifactContentReference],
      )
      ? stored.reference
      : null
  }
  async read(reference: ArtifactContentReference): Promise<Uint8Array> {
    if (!this.inspect(reference))
      throw new ArtifactFault(
        'CONTENT_NOT_FOUND',
        'The immutable content reference is unavailable.',
      )
    return new Uint8Array(this.content.get(reference.contentId)!.bytes)
  }
}
