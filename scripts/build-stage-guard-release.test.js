// @vitest-environment node
import {test,expect} from 'vitest'
import {buildGuardRelease} from './build-stage-guard-release.js'
import {isolatedSandboxBootstrap} from './isolated-billing-bootstrap.js'
test.each([undefined,'szjiwamevblkpjmmeonf','stage',''])('release rejects target %s',projectRef=>{
 expect(()=>buildGuardRelease({projectRef})).toThrow('Stage project required')
})
test('release defaults to rollback and rejects unknown modes',()=>{
 expect(buildGuardRelease({projectRef:'jeugfyaqzfgdvfhdxfht'}).trim().endsWith('rollback;')).toBe(true)
 expect(()=>buildGuardRelease({projectRef:'jeugfyaqzfgdvfhdxfht',mode:'deploy'})).toThrow('Unknown release mode')
})
test.each(['supabase_db_quest-platform','stage','qvesta-release-test-',''])('bootstrap rejects shared target %s',name=>{
 expect(()=>isolatedSandboxBootstrap(name)).toThrow('Disposable test container required')
})
