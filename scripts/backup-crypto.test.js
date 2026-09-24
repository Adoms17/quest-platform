// @vitest-environment node
import { it, expect } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptBackup, decryptBackup } from './backup-crypto.mjs'
it('restores exact binary bytes and uses a fresh nonce', () => {
 const key = randomBytes(32), data = Buffer.from([0,255,1,128,10])
 const first = encryptBackup(data,key), second = encryptBackup(data,key)
 expect(first.equals(second)).toBe(false)
 expect(decryptBackup(first,key)).toEqual(data)
})
it.each([0,16,30,44])('rejects corruption at byte %s', offset => {
 const key=randomBytes(32), archive=encryptBackup(Buffer.alloc(100,42),key)
 archive[offset]^=1
 expect(()=>decryptBackup(archive,key)).toThrow('backup_authentication_failed')
})
it('rejects wrong keys, truncation and appended data', () => {
 const key=randomBytes(32), archive=encryptBackup(Buffer.from('synthetic'),key)
 for(const data of [archive.subarray(0,10),archive.subarray(0,-1),Buffer.concat([archive,Buffer.from([1])])]) expect(()=>decryptBackup(data,key)).toThrow('backup_authentication_failed')
 expect(()=>decryptBackup(archive,randomBytes(32))).toThrow('backup_authentication_failed')
})
it('rejects password strings and short keys', () => {
 expect(()=>encryptBackup(Buffer.from('test'),'password')).toThrow('invalid_backup_input')
 expect(()=>encryptBackup(Buffer.from('test'),Buffer.alloc(16))).toThrow('invalid_backup_input')
})