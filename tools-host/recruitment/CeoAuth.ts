import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'

export interface CeoPrincipal {
  readonly id: string
  readonly role: 'ceo'
}

export interface CeoAuthConfig {
  readonly version: 1
  readonly id: string
  readonly salt: string
  readonly passwordHash: string
}

const COOKIE = 'office_ceo_session'
const SESSION_MS = 4 * 60 * 60 * 1000
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const COOKIE_SUFFIX = 'Path=/; HttpOnly; SameSite=Strict'

export class CeoAuthFault extends Error {
  readonly code:
    'CEO_AUTH_INVALID' | 'CEO_AUTH_RATE_LIMITED' | 'CEO_AUTH_UNAVAILABLE'
  constructor(code: CeoAuthFault['code']) {
    super(
      code === 'CEO_AUTH_RATE_LIMITED'
        ? 'Too many sign-in attempts. Try again later.'
        : 'CEO authentication could not be completed.',
    )
    this.code = code
  }
}

function passwordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT, (error, key) =>
      error ? reject(error) : resolve(key),
    )
  })
}

function configValid(value: unknown): asserts value is CeoAuthConfig {
  const config = value as CeoAuthConfig | null
  if (
    !config ||
    typeof config !== 'object' ||
    config.version !== 1 ||
    typeof config.id !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,64}$/u.test(config.id) ||
    typeof config.salt !== 'string' ||
    !/^[a-f0-9]{32}$/u.test(config.salt) ||
    typeof config.passwordHash !== 'string' ||
    !/^[a-f0-9]{128}$/u.test(config.passwordHash)
  )
    throw new CeoAuthFault('CEO_AUTH_UNAVAILABLE')
}

function tokenFromCookie(cookie: string | undefined) {
  if (!cookie || cookie.length > 8192) return null
  const matches = cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE}=`))
  if (matches.length !== 1) return null
  const token = matches[0]!.slice(COOKIE.length + 1)
  return /^[A-Za-z0-9_-]{43}$/u.test(token) ? token : null
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest()

/** Local host authentication, not a deployment identity provider. Keep this object out of snapshots. */
export class CeoAuth {
  readonly #config: CeoAuthConfig
  readonly #now: () => number
  readonly #sessions = new Map<string, { hash: Buffer; expiresAt: number }>()
  readonly #attempts = new Map<string, { count: number; resetAt: number }>()
  #inFlight = 0

  constructor(options: {
    readonly config: CeoAuthConfig
    readonly now?: () => number
  }) {
    configValid(options.config)
    this.#config = Object.freeze({ ...options.config })
    this.#now = options.now ?? Date.now
  }

  static fromDirectory(directory: string) {
    try {
      const root = path.resolve(directory)
      const folder = lstatSync(root)
      const file = path.join(root, 'ceo.json')
      const info = lstatSync(file)
      if (
        folder.isSymbolicLink() ||
        !folder.isDirectory() ||
        info.isSymbolicLink() ||
        !info.isFile() ||
        info.size > 4096
      )
        throw new CeoAuthFault('CEO_AUTH_UNAVAILABLE')
      const config: unknown = JSON.parse(readFileSync(file, 'utf8'))
      configValid(config)
      return new CeoAuth({ config })
    } catch {
      throw new CeoAuthFault('CEO_AUTH_UNAVAILABLE')
    }
  }

  async verify(password: unknown) {
    if (
      typeof password !== 'string' ||
      password.length < 12 ||
      password.length > 512
    )
      return false
    try {
      const actual = await passwordKey(
        password,
        Buffer.from(this.#config.salt, 'hex'),
      )
      return timingSafeEqual(
        actual,
        Buffer.from(this.#config.passwordHash, 'hex'),
      )
    } catch {
      throw new CeoAuthFault('CEO_AUTH_UNAVAILABLE')
    }
  }

  async login(password: unknown, clientKey: string) {
    this.prune()
    // clientKey must come from the accepted socket, never a request body or forwarded header.
    if (!clientKey || clientKey.length > 128 || this.#inFlight >= 2)
      throw new CeoAuthFault('CEO_AUTH_RATE_LIMITED')
    const attempt = this.#attempts.get(clientKey) ?? {
      count: 0,
      resetAt: this.#now() + ATTEMPT_WINDOW_MS,
    }
    if (
      attempt.count >= 5 ||
      (!this.#attempts.has(clientKey) && this.#attempts.size >= 100)
    )
      throw new CeoAuthFault('CEO_AUTH_RATE_LIMITED')
    // Reserve the attempt before awaiting scrypt so parallel requests cannot bypass the limit.
    attempt.count += 1
    this.#attempts.set(clientKey, attempt)
    this.#inFlight += 1
    let valid: boolean
    try {
      valid = await this.verify(password)
    } finally {
      this.#inFlight -= 1
    }
    if (!valid) throw new CeoAuthFault('CEO_AUTH_INVALID')
    this.#attempts.delete(clientKey)
    if (this.#sessions.size >= 32)
      throw new CeoAuthFault('CEO_AUTH_RATE_LIMITED')
    const token = randomBytes(32).toString('base64url')
    const hash = tokenHash(token)
    this.#sessions.set(hash.toString('hex'), {
      hash,
      expiresAt: this.#now() + SESSION_MS,
    })
    return Object.freeze({
      principal: Object.freeze({ id: this.#config.id, role: 'ceo' as const }),
      setCookie: `${COOKIE}=${token}; ${COOKIE_SUFFIX}; Max-Age=${SESSION_MS / 1000}`,
    })
  }

  authenticate(cookieHeader: string | undefined): CeoPrincipal | null {
    this.prune()
    const token = tokenFromCookie(cookieHeader)
    if (!token) return null
    const hash = tokenHash(token)
    const session = this.#sessions.get(hash.toString('hex'))
    if (!session || !timingSafeEqual(hash, session.hash)) return null
    return Object.freeze({ id: this.#config.id, role: 'ceo' })
  }

  logout(cookieHeader: string | undefined) {
    const token = tokenFromCookie(cookieHeader)
    if (token) this.#sessions.delete(tokenHash(token).toString('hex'))
    return `${COOKIE}=; ${COOKIE_SUFFIX}; Max-Age=0`
  }

  private prune() {
    const now = this.#now()
    for (const [key, session] of this.#sessions)
      if (session.expiresAt <= now) this.#sessions.delete(key)
    for (const [key, attempt] of this.#attempts)
      if (attempt.resetAt <= now) this.#attempts.delete(key)
  }
}
