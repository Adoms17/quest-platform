"""Offline mocks only. Never invokes psql, network, Docker or business functions."""
import unittest, tempfile, json, os
from pathlib import Path
from unittest.mock import patch
import run_atomic as r

PACKAGE=Path(__file__).resolve().parents[2]/'release/production-atomic/application.sql'
META={'serverVersion':170006,'role':'postgres','database':'postgres','ledgerCount':99,
      'extensions':{'pg_cron':'1.6.4','pg_net':'0.20.4','supabase_vault':'0.3.1'}}
POST={'ok':True,'stdout':json.dumps({'ledgerCount':335,'activeJobs':0,'queuedHttp':0})}

class Offline(unittest.TestCase):
    def simulate(self,outcomes,access_ok=True):
        outcomes.insert(1,{'ok':access_ok,'stdout':'0\n0'})
        calls=[]
        def fake(password,**kwargs):
            self.assertEqual(password,'synthetic-not-a-credential')
            calls.append(kwargs)
            result=outcomes.pop(0)
            if isinstance(result,BaseException): raise result
            return result
        with tempfile.TemporaryDirectory() as d:
            receipt=Path(d)/'result.json'
            with patch.object(r,'ENABLED',True),patch.object(Path,'is_file',return_value=True),patch.dict(os.environ,{
                'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'Adoms17/quest-platform',
                'GITHUB_REF':'refs/heads/main','PGPASSWORD':'synthetic-not-a-credential'},clear=True):
                try:r.execute(PACKAGE,receipt,call=fake)
                except RuntimeError as error:self.assertEqual(str(error),'STOP_RECONCILE_READ_ONLY_NO_RETRY' if access_ok else 'REQUIRED_METADATA_READ_ACCESS_UNAVAILABLE_NO_GRANT')
            return calls,json.loads(receipt.read_text())
    def pre(self): return {'ok':True,'stdout':json.dumps(META)}
    def test_single_pinned_byte_stream(self):
        calls,result=self.simulate([self.pre(),{'ok':True,'stdout':''},POST])
        self.assertEqual(len(calls),4)
        self.assertEqual(calls[2],{'raw':PACKAGE.read_bytes(),'readonly':False})
        self.assertEqual(result['status'],'COMMITTED_VERIFIED')
    def test_timeout_does_not_retry_apply(self):
        calls,result=self.simulate([self.pre(),{'ok':False,'uncertain':True,'reason':'CLIENT_TIMEOUT_NO_RETRY'},POST])
        self.assertEqual(sum(c.get('readonly') is False for c in calls),1)
        self.assertEqual(result['status'],'COMMITTED_VERIFIED')
        self.assertFalse(result['applyClientSuccess'])
    def test_interruption_still_reads_and_preserves_uncertainty(self):
        calls,result=self.simulate([self.pre(),KeyboardInterrupt(),{'ok':False,'reason':'READBACK_FAILED'}])
        self.assertEqual(len(calls),4)
        self.assertEqual(result['status'],'UNRESOLVED_STOP_NO_RETRY')
        self.assertEqual(result['readbackDiagnostic']['reason'],'READBACK_FAILED')
    def test_read_access_failure_never_applies(self):
        calls,result=self.simulate([self.pre()],access_ok=False)
        self.assertEqual(len(calls),2)
        self.assertFalse(result['applyAttempted'])
        self.assertTrue(all(c.get('readonly') is not False for c in calls))
    def test_inspect_only_reads(self):
        with patch.dict(os.environ,{'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'Adoms17/quest-platform','GITHUB_REF':'refs/heads/main','PGPASSWORD':'synthetic-not-a-credential'},clear=True),patch.object(r,'psql',return_value=self.pre()) as mock:
            r.inspect_connection()
            mock.assert_called_once_with('synthetic-not-a-credential',raw=r.PREFLIGHT)
    def test_hash_mismatch(self):
        with self.assertRaisesRegex(RuntimeError,'PACKAGE_HASH_MISMATCH'):r.readback_sql(b'COMMIT;')
    def test_disabled_before_any_read(self):
        with patch.object(r,'ENABLED',False),self.assertRaisesRegex(RuntimeError,'DISABLED_LOCAL_REVIEW_COPY'):r.execute(Path('missing'),Path('missing-receipt'))

if __name__=='__main__': unittest.main()
