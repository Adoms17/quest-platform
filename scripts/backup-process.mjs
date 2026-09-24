import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { link, lstat, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { encryptBackupStream, verifyBackupFile } from './backup-stream.mjs'

// Internal adapter for a trusted direct executable (no shell, no process trees).
// Credentials must not appear in args. No stdout/stderr is logged or buffered.
export async function encryptBackupProcess({ executable, args = [], env, destination, key, timeoutMs = 300000 }) {
 if (!Buffer.isBuffer(key) || key.length !== 32 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
  throw Error('invalid_backup_process_input')
 }
 const output = resolve(destination)
 const partial = output + '.partial-' + randomUUID()
 let ownsPartial = false
 try {
  try { await lstat(output); throw Error('destination_exists') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  async function* produce() {
   const child = spawn(executable, args, {
    shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env,
   })
   let timedOut = false
   const completed = new Promise(resolveExit => {
    child.once('error', () => resolveExit(false))
    child.once('close', (code, signal) => resolveExit(code === 0 && !signal))
   })
   const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGKILL')
   }, timeoutMs)
   try {
    for await (const chunk of child.stdout) yield chunk
    // EOF alone is not proof of export success: wait for the exit status.
    if (!await completed || timedOut) throw Error('backup_producer_failed')
   } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await completed
   }
  }
  const result = await encryptBackupStream(Readable.from(produce()), partial, key)
  ownsPartial = true
  const checked = await verifyBackupFile(partial, key)
  if (checked.plaintextBytes !== result.plaintextBytes) throw Error('backup_size_mismatch')
  // Atomic no-overwrite publication on the same filesystem, after authentication.
  // Fail closed on filesystems without hard-link support.
  await link(partial, output)
  return { ...result, authenticated: true, producerSucceeded: true }
 } catch {
  throw Error('backup_process_export_failed')
 } finally {
  if (ownsPartial) await unlink(partial)
 }
}