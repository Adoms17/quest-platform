// @vitest-environment node
import { it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { decodeBackupKey, readBackupKeys } from './backup-key-input.mjs'
it('decodes exactly 32 bytes and accepts two CRLF lines split across chunks', async () => {
 const key=randomBytes(32), text=key.toString('base64')
 expect(decodeBackupKey(text)).toEqual(key)
 const result=await readBackupKeys(Readable.from([text.slice(0,9),text.slice(9)+'\r\n'+text+'\r\n']))
 expect(result).toEqual([key,key])
})
it.each(['password','', 'A'.repeat(44), Buffer.alloc(31).toString('base64'), ' '+Buffer.alloc(32).toString('base64')])('rejects malformed key %#', text => {
 expect(()=>decodeBackupKey(text)).toThrow('invalid_backup_key')
})
it('rejects missing second key and oversized input without reflecting it', async () => {
 await expect(readBackupKeys(Readable.from(['private-invalid']))).rejects.toThrow(/^invalid_backup_key_input$/)
 await expect(readBackupKeys(Readable.from(['x'.repeat(129)]))).rejects.toThrow(/^invalid_backup_key_input$/)
})