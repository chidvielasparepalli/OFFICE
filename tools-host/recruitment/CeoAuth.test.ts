// @vitest-environment node
import { scryptSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { CeoAuth, type CeoAuthConfig } from './CeoAuth'

const password = 'synthetic-local-test-passphrase-only'
const salt = 'ab'.repeat(16)
const config: CeoAuthConfig = {
  version: 1,
  id: 'test-ceo',
  salt,
  passwordHash: scryptSync(password, Buffer.from(salt, 'hex'), 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  }).toString('hex'),
}
const cookieFrom = (value: string) => value.split(';')[0]!
const directories: string[] = []
afterEach(() => {
  directories
    .splice(0)
    .forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

describe('host-only local CEO authentication', () => {
  it('verifies the password and issues only a bounded HttpOnly strict cookie', async () => {
    const auth = new CeoAuth({ config })
    expect(await auth.verify(password)).toBe(true)
    expect(await auth.verify('synthetic-wrong-passphrase')).toBe(false)
    const login = await auth.login(password, '127.0.0.1')
    expect(login.principal).toEqual({ id: 'test-ceo', role: 'ceo' })
    expect(login.setCookie).toMatch(/HttpOnly; SameSite=Strict; Max-Age=14400/u)
    expect(auth.authenticate(cookieFrom(login.setCookie))).toEqual(
      login.principal,
    )
    expect(JSON.stringify(auth)).toBe('{}')
    expect(JSON.stringify(login)).not.toContain(password)
    expect(JSON.stringify(login)).not.toContain(config.passwordHash)
  })

  it('rejects forged, role-only, malformed, duplicate and missing cookies', async () => {
    const auth = new CeoAuth({ config })
    const login = await auth.login(password, '127.0.0.1')
    const cookie = cookieFrom(login.setCookie)
    for (const value of [
      undefined,
      'role=ceo',
      `office_ceo_session=${'a'.repeat(43)}`,
      'office_ceo_session=invalid',
      `${cookie}; ${cookie}`,
      'x'.repeat(8193),
    ])
      expect(auth.authenticate(value)).toBeNull()
    expect(auth.authenticate(`other=value; ${cookie}`)?.id).toBe('test-ceo')
  })

  it('invalidates sessions on logout, expiry and host restart', async () => {
    let time = 1000
    const auth = new CeoAuth({ config, now: () => time })
    const first = cookieFrom(
      (await auth.login(password, '127.0.0.1')).setCookie,
    )
    expect(auth.logout(first)).toContain('Max-Age=0')
    expect(auth.authenticate(first)).toBeNull()
    const second = cookieFrom(
      (await auth.login(password, '127.0.0.1')).setCookie,
    )
    expect(new CeoAuth({ config }).authenticate(second)).toBeNull()
    time += 4 * 60 * 60 * 1000
    expect(auth.authenticate(second)).toBeNull()
  })

  it('limits failed attempts before expensive password work and resets after the bounded window', async () => {
    let time = 0
    const auth = new CeoAuth({ config, now: () => time })
    for (let i = 0; i < 5; i += 1)
      await expect(auth.login('', '127.0.0.1')).rejects.toMatchObject({
        code: 'CEO_AUTH_INVALID',
      })
    await expect(auth.login(password, '127.0.0.1')).rejects.toMatchObject({
      code: 'CEO_AUTH_RATE_LIMITED',
    })
    time += 10 * 60 * 1000
    expect((await auth.login(password, '127.0.0.1')).principal.role).toBe('ceo')
  })

  it('bounds simultaneous scrypt work and reserves attempts before awaiting', async () => {
    const auth = new CeoAuth({ config })
    const first = auth.login(password, '127.0.0.1')
    const second = auth.login(password, '127.0.0.1')
    await expect(auth.login(password, '127.0.0.1')).rejects.toMatchObject({
      code: 'CEO_AUTH_RATE_LIMITED',
    })
    const results = await Promise.all([first, second])
    expect(results[0]!.setCookie).not.toBe(results[1]!.setCookie)
  })

  it('does not expose rejected password values in error messages', async () => {
    const auth = new CeoAuth({ config })
    const rejected = 'synthetic-value-not-for-logs'
    try {
      await auth.login(rejected, '127.0.0.1')
    } catch (error) {
      expect(String(error)).not.toContain(rejected)
      expect(error).toMatchObject({ code: 'CEO_AUTH_INVALID' })
    }
    expect(await auth.verify({ password })).toBe(false)
    expect(await auth.verify('x'.repeat(513))).toBe(false)
  })

  it('reads only validated local configuration without leaking corrupt file contents', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'office-auth-test-'))
    directories.push(directory)
    expect(() => CeoAuth.fromDirectory(directory)).toThrowError(
      expect.objectContaining({ code: 'CEO_AUTH_UNAVAILABLE' }),
    )
    writeFileSync(path.join(directory, 'ceo.json'), JSON.stringify(config))
    expect(CeoAuth.fromDirectory(directory)).toBeInstanceOf(CeoAuth)
    writeFileSync(
      path.join(directory, 'ceo.json'),
      'invalid synthetic private configuration',
    )
    expect(() => CeoAuth.fromDirectory(directory)).toThrow(
      'CEO authentication could not be completed.',
    )
  })

  it('rejects unsupported hashing config and cannot change identity through later config mutation', async () => {
    expect(
      () =>
        new CeoAuth({
          config: { ...config, version: 2 } as unknown as CeoAuthConfig,
        }),
    ).toThrow()
    expect(
      () => new CeoAuth({ config: { ...config, passwordHash: 'invalid' } }),
    ).toThrow()
    const mutable = { ...config }
    const auth = new CeoAuth({ config: mutable })
    mutable.id = 'another-user'
    expect((await auth.login(password, '127.0.0.1')).principal.id).toBe(
      'test-ceo',
    )
  })
})
