import { randomBytes, scryptSync } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitKeypressEvents } from 'node:readline'
import { recoverLocalRuntimeLock } from '../tools-host/recruitment/LocalRuntimeRepository.ts'

const directory = fileURLToPath(new URL('../.office.local/', import.meta.url))
const file = path.join(directory, 'ceo.json')

function hiddenPassword(label) {
  return new Promise((resolve, reject) => {
    let value = ''
    process.stdout.write(label)
    emitKeypressEvents(process.stdin)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    const finish = () => {
      process.stdin.removeListener('keypress', onKey)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
    }
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        finish()
        reject(new Error('cancelled'))
        return
      }
      if (key.name === 'return' || key.name === 'enter') {
        finish()
        resolve(value)
        return
      }
      if (key.name === 'backspace') {
        value = value.slice(0, -1)
        return
      }
      if (
        !key.ctrl &&
        !key.meta &&
        text &&
        ![...text].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) &&
        value.length + text.length <= 512
      )
        value += text
    }
    process.stdin.on('keypress', onKey)
  })
}

try {
  if (process.argv.length === 3 && process.argv[2] === '--recover-lock') {
    const recovered = recoverLocalRuntimeLock(directory)
    process.stdout.write(
      recovered
        ? 'Dead process lock recovered. Committed office records were preserved.\n'
        : 'No runtime process lock requires recovery.\n',
    )
    process.exit(0)
  }
  if (
    process.argv.length !== 2 ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  )
    throw new Error(
      'Use an interactive terminal; password arguments and redirected input are not accepted.',
    )
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const info = lstatSync(directory)
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error('Local configuration directory is unsafe.')
  if (existsSync(file))
    throw new Error('CEO configuration already exists. It was not changed.')
  process.stdout.write(
    'Create the local OFFICE CEO login. Password input is hidden. This is not production authentication.\n',
  )
  const password = await hiddenPassword(
    'New password (at least 12 characters): ',
  )
  const confirmation = await hiddenPassword('Confirm password: ')
  if (
    password.length < 12 ||
    password.length > 512 ||
    password !== confirmation
  )
    throw new Error(
      'Password length or confirmation was invalid. No account was created.',
    )
  const salt = randomBytes(16)
  const config = {
    version: 1,
    id: 'local-ceo',
    salt: salt.toString('hex'),
    passwordHash: scryptSync(password, salt, 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }).toString('hex'),
  }
  const fd = openSync(file, 'wx', 0o600)
  try {
    writeFileSync(fd, `${JSON.stringify(config)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  process.stdout.write(
    'Local CEO account created. The password was not stored. Restart the OFFICE development server.\n',
  )
} catch (error) {
  // Never print raw filesystem/crypto exceptions, arguments, or password input.
  const safe =
    error instanceof Error &&
    [
      'Use an interactive terminal; password arguments and redirected input are not accepted.',
      'Local configuration directory is unsafe.',
      'CEO configuration already exists. It was not changed.',
      'Password length or confirmation was invalid. No account was created.',
      'cancelled',
    ].includes(error.message)
      ? error.message
      : 'Local CEO setup failed. Existing configuration was not overwritten.'
  process.stderr.write(`${safe}\n`)
  process.exitCode = 1
}
