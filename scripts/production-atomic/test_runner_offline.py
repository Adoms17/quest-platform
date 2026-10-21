"""Offline mocks only. Never invokes psql, network, Docker or business functions."""
import unittest, tempfile, json, os, io, subprocess
from contextlib import redirect_stdout
from types import SimpleNamespace
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
            mock.assert_called_once_with('synthetic-not-a-credential',raw=r.PREFLIGHT,diagnostics=True)
    def test_hash_mismatch(self):
        with self.assertRaisesRegex(RuntimeError,'PACKAGE_HASH_MISMATCH'):r.readback_sql(b'COMMIT;')
    def test_disabled_before_any_read(self):
        with patch.object(r,'ENABLED',False),self.assertRaisesRegex(RuntimeError,'DISABLED_LOCAL_REVIEW_COPY'):r.execute(Path('missing'),Path('missing-receipt'))

class InspectDiagnostics(unittest.TestCase):
    def test_inspect_guards_still_stop_before_psql(self):
        valid={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'Adoms17/quest-platform',
               'GITHUB_REF':'refs/heads/main','PGPASSWORD':'synthetic'}
        for key,value,error in (('GITHUB_ACTIONS','false','APPROVED_RUNNER_REQUIRED'),
            ('GITHUB_REPOSITORY','other/repo','APPROVED_RUNNER_REQUIRED'),
            ('GITHUB_REF','refs/heads/other','MAIN_ONLY'),('PGPASSWORD','','EXISTING_SECRET_MISSING')):
            with patch.dict(os.environ,{**valid,key:value},clear=True),patch.object(r,'psql') as call:
                with self.assertRaisesRegex(RuntimeError,'^'+error+'$'):r.inspect_connection()
                call.assert_not_called()

    def test_categories_and_unknowns_never_echo_input(self):
        cases={
            b'certificate verify failed':'TLS_CERTIFICATE_VERIFY_FAILED',
            b'does not match host name':'TLS_HOSTNAME_MISMATCH',
            b'root certificate file missing':'TLS_TRUST_STORE_ERROR',
            b'could not translate host name':'DNS_RESOLUTION_FAILED',
            b'password authentication failed':'AUTHENTICATION_FAILED',
            b'unsupported startup parameter':'STARTUP_PARAMETER_REJECTED',
            b'unrecognized configuration parameter':'STARTUP_PARAMETER_REJECTED',
            b'Connection refused':'CONNECTION_REFUSED',
            b'timeout expired':'CONNECTION_TIMEOUT',
            b'FATAL: ZZ999: opaque':'PSQL_FAILURE_UNCLASSIFIED',
            b'ERROR: 28P01INJECTED':'PSQL_FAILURE_UNCLASSIFIED',
            b'\xff arbitrary failure':'PSQL_FAILURE_UNCLASSIFIED'}
        for marker,reason in cases.items():
            with self.subTest(marker=marker):
                result=r.inspect_diagnostic(marker+b' postgres://fake:canary@private.example/db SELECT private_row')
                self.assertEqual(result,{'reason':reason})

    def test_sqlstate_allowlist(self):
        states={'28P01':'AUTHENTICATION_FAILED','28000':'AUTHORIZATION_FAILED',
                '42501':'QUERY_PERMISSION_DENIED','42P01':'QUERY_RELATION_MISSING',
                '42704':'QUERY_OBJECT_MISSING','22023':'INVALID_PARAMETER',
                '57014':'QUERY_CANCELLED','25006':'READ_ONLY_VIOLATION',
                '53300':'CONNECTION_CAPACITY','57P03':'SERVER_UNAVAILABLE'}
        for state,reason in states.items():
            for severity in ('ERROR','FATAL'):
                with self.subTest(state=state,severity=severity):
                    self.assertEqual(r.inspect_diagnostic(f'{severity}:  {state}: canary'.encode()),
                                     {'reason':reason,'sqlstate':state})

    def test_psql_failure_diagnostics_are_opt_in(self):
        result=SimpleNamespace(returncode=2,stdout=b'private output',stderr=b'FATAL: 28P01: private error')
        with patch.object(r.subprocess,'run',return_value=result) as call:
            self.assertEqual(r.psql('synthetic',raw=r.PREFLIGHT,diagnostics=True),
                             {'ok':False,'reason':'AUTHENTICATION_FAILED','sqlstate':'28P01'})
            args=call.call_args.kwargs
            self.assertEqual(args['env']['PGSSLMODE'],'verify-full')
            self.assertEqual(args['env']['PGHOST'],r.HOST)
            self.assertIn('default_transaction_read_only=on',args['env']['PGOPTIONS'])
            self.assertEqual(r.psql('synthetic',raw=r.PREFLIGHT),
                             {'ok':False,'uncertain':True,'reason':'PSQL_ERROR','sqlstate':None})

    def test_failure_output_boundary_and_no_retry(self):
        for outcome,expected in (
            ({'ok':False,'reason':'QUERY_PERMISSION_DENIED','sqlstate':'42501','stdout':'private'},
             {'status':'READ_ONLY_CONNECTION_FAILED','reason':'QUERY_PERMISSION_DENIED','sqlstate':'42501'}),
            ({'ok':False,'reason':'canary','sqlstate':'ZZ999','stderr':'postgres://private'},
             {'status':'READ_ONLY_CONNECTION_FAILED','reason':'PSQL_FAILURE_UNCLASSIFIED'}),
            ({'ok':False,'reason':'CLIENT_TIMEOUT_NO_RETRY','uncertain':True},
             {'status':'READ_ONLY_CONNECTION_FAILED','reason':'CLIENT_TIMEOUT_NO_RETRY'})):
            output=io.StringIO()
            with patch.dict(os.environ,{'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'Adoms17/quest-platform',
                'GITHUB_REF':'refs/heads/main','PGPASSWORD':'synthetic'},clear=True), \
                patch.object(r,'psql',return_value=outcome) as call, redirect_stdout(output):
                with self.assertRaisesRegex(RuntimeError,'^READ_ONLY_CONNECTION_FAILED$'):
                    r.inspect_connection()
                call.assert_called_once_with('synthetic',raw=r.PREFLIGHT,diagnostics=True)
            self.assertEqual(json.loads(output.getvalue()),expected)

    def test_client_exceptions_do_not_leak_details(self):
        for error,reason in ((OSError('private'), 'CLIENT_TRANSPORT_ERROR_NO_RETRY'),
            (subprocess.TimeoutExpired('private',90,output=b'private',stderr=b'private'), 'CLIENT_TIMEOUT_NO_RETRY')):
            with patch.object(r.subprocess,'run',side_effect=error):
                self.assertEqual(r.psql('synthetic',raw=r.PREFLIGHT,diagnostics=True),
                                 {'ok':False,'uncertain':True,'reason':reason})

if __name__=='__main__': unittest.main()
