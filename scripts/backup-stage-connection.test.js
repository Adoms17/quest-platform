// @vitest-environment node
import { it, expect } from 'vitest'
import { classifyBackupConnection } from './backup-stage-connection.mjs'
it.each([
 ['Invalid access token format', 'invalid_token'],
 ['HTTP 403 Forbidden', 'access_denied'],
 ['Access token not provided', 'authentication_failed'],
 ['password authentication failed', 'database_authentication_failed'],
 ['Cannot find project ref. Have you run supabase link?', 'project_not_linked'],
 ['Cannot connect to the Docker daemon', 'docker_unavailable'],
 ['open //./pipe/dockerDesktopLinuxEngine: file not found', 'docker_unavailable'],
 ['pg_dumpall: SSL SYSCALL error: EOF detected', 'connection_closed'],
 ['Transport error (GET https://example.invalid/private)', 'network_error'],
 ['self-signed certificate in certificate chain', 'certificate_error'],
 ['panic(main thread): Segmentation fault', 'cli_crashed'],
 ['unrecognised private diagnostic', 'export_connection_failed'],
])('classifies without exposing diagnostic: %s', (stderr, expected) => {
 expect(classifyBackupConnection({status:1, stderr:stderr+' secret-synthetic-value'})).toBe(expected)
})
it('handles success, timeout and spawn failure',()=>{
 expect(classifyBackupConnection({status:0})).toBe('passed')
 expect(classifyBackupConnection({status:null,error:{code:'ETIMEDOUT'}})).toBe('timeout')
 expect(classifyBackupConnection({status:null,error:{code:'ENOENT'}})).toBe('cli_start_failed')
})