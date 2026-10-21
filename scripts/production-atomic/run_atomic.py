"""Production runner for the pinned reviewed SQL; no import side effects."""
import argparse, hashlib, json, os, re, subprocess, sys, signal
from pathlib import Path

ENABLED = True  # Dispatch remains gated by the reviewed workflow and production environment.
BUNDLE_SHA256 = 'a060c3e9cb87e3e73957b80bda39e913a1a2d2933bbad996020d8971b50bed6f'
BUNDLE_BYTES = 2613787
HOST = 'aws-0-eu-west-1.pooler.supabase.com'
USER = 'postgres.szjiwamevblkpjmmeonf'
CA = '/etc/ssl/certs/ca-certificates.crt'

def require(ok, message):
    if not ok: raise RuntimeError(message)

def readback_sql(raw):
    # Exact pinned bytes only: not a general SQL parser or arbitrary extraction.
    require(hashlib.sha256(raw).hexdigest()==BUNDLE_SHA256 and len(raw)==BUNDLE_BYTES,'PACKAGE_HASH_MISMATCH')
    text=raw.decode('utf-8')
    require(text.count('DO $final$')==1 and text.count('END $final$;')==1,'FINAL_GUARD_BOUNDARY')
    final=text[text.index('DO $final$'):text.index('END $final$;')+len('END $final$;')]
    return ("BEGIN READ ONLY; SET LOCAL search_path=pg_catalog;\n"+final+"\n"+r"""
DO $sequences$ DECLARE s text; r text; p text; BEGIN
 FOREACH s IN ARRAY ARRAY['public.billing_lifecycle_runs_id_seq','public.billing_trial_transitions_id_seq'] LOOP
  FOREACH p IN ARRAY ARRAY['SELECT','UPDATE','USAGE'] LOOP
   FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_sequence_privilege(r,s,p) THEN RAISE EXCEPTION 'Sequence client privilege remains'; END IF;
   END LOOP;
   IF NOT has_sequence_privilege('service_role',s,p) OR NOT has_sequence_privilege('postgres',s,p) THEN
    RAISE EXCEPTION 'Sequence owner/service privilege missing'; END IF;
  END LOOP;
 END LOOP;
END $sequences$;
SELECT json_build_object('ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'activeJobs',(SELECT count(*) FROM cron.job WHERE active),
 'queuedHttp',(SELECT count(*) FROM net.http_request_queue));
COMMIT;
""").encode()

PREFLIGHT = b"""BEGIN READ ONLY;
SELECT json_build_object('serverVersion',current_setting('server_version_num')::integer,
 'role',current_user,'database',current_database(),
 'ledgerCount',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'extensions',(SELECT json_object_agg(extname,extversion) FROM pg_extension
  WHERE extname IN ('pg_cron','pg_net','supabase_vault')));
COMMIT;"""

def connection_env(password,readonly):
    # No inherited PGHOST/PGSERVICE/options or user credential files.
    env={k:os.environ[k] for k in ('PATH','LANG','LC_ALL') if k in os.environ}
    env.update(PGHOST=HOST,PGPORT='5432',PGDATABASE='postgres',PGUSER=USER,
      PGPASSWORD=password,PGPASSFILE='/dev/null',PGSERVICEFILE='/dev/null',
      PGSSLMODE='verify-full',PGSSLROOTCERT=CA,PGCONNECT_TIMEOUT='10',
      PGAPPNAME='qvesta-reviewed-atomic-release',
      PGOPTIONS='-c statement_timeout=30000 -c lock_timeout=2000 -c transaction_timeout=60000 -c idle_in_transaction_session_timeout=10000'+(' -c default_transaction_read_only=on' if readonly else ''))
    return env

def psql(password, *, raw=None, path=None, readonly=True):
    require((raw is None)!=(path is None),'ONE_INPUT_REQUIRED')
    args=['psql','-X','--no-password','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate']
    if path is not None: args+=['-f',str(path)]
    try:
        result=subprocess.run(args,input=raw,capture_output=True,env=connection_env(password,readonly),timeout=90)
    except subprocess.TimeoutExpired:
        return {'ok':False,'uncertain':True,'reason':'CLIENT_TIMEOUT_NO_RETRY'}
    except OSError:
        return {'ok':False,'uncertain':True,'reason':'CLIENT_TRANSPORT_ERROR_NO_RETRY'}
    if result.returncode:
        # Never emit raw SQL errors or echo queries/data/credentials.
        match=re.search(rb'ERROR:\s+([A-Z0-9]{5})',result.stderr)
        return {'ok':False,'uncertain':True,'reason':'PSQL_ERROR','sqlstate':match[1].decode() if match else None}
    return {'ok':True,'stdout':result.stdout.decode('utf-8').strip()}

def execute(path,receipt,call=psql):
    require(ENABLED,'DISABLED_LOCAL_REVIEW_COPY')
    require(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='Adoms17/quest-platform','APPROVED_RUNNER_REQUIRED')
    require(os.environ.get('GITHUB_REF')=='refs/heads/main','MAIN_ONLY')
    require(not receipt.exists(),'RECEIPT_EXISTS_NO_RETRY')
    raw=path.read_bytes(); final=readback_sql(raw)
    password=os.environ.get('PGPASSWORD',''); require(bool(password),'EXISTING_SECRET_MISSING')
    require(Path(CA).is_file(),'TRUST_STORE_MISSING_NO_TLS_DOWNGRADE')
    pre=call(password,raw=PREFLIGHT)
    require(pre['ok'],'READ_ONLY_PREFLIGHT_FAILED')
    metadata=json.loads(pre['stdout'])
    require(metadata['serverVersion']==170006 and metadata['role']=='postgres' and metadata['database']=='postgres','TARGET_METADATA_DRIFT')
    require(metadata['extensions']=={'pg_cron':'1.6.4','pg_net':'0.20.4','supabase_vault':'0.3.1'},'APPROVED_EXTENSIONS_REQUIRED')
    result={'bundleSha256':BUNDLE_SHA256,'status':'NOT_APPLIED','applyAttempted':False}
    receipt.write_text(json.dumps(result)+'\n')
    require(metadata['ledgerCount'] in (99,335),'LEDGER_DRIFT')
    access=call(password,raw=b'BEGIN READ ONLY; SELECT count(*) FROM net.http_request_queue; SELECT count(*) FROM cron.job; COMMIT;')
    require(access['ok'],'REQUIRED_METADATA_READ_ACCESS_UNAVAILABLE_NO_GRANT')
    if metadata['ledgerCount']==335:
        post=call(password,raw=final)
        result['status']='ALREADY_APPLIED_VERIFIED' if post['ok'] else 'DRIFT_NO_APPLY'
    else:
        require(hashlib.sha256(path.read_bytes()).hexdigest()==BUNDLE_SHA256,'PACKAGE_CHANGED')
        result.update(status='APPLY_PENDING_NO_RETRY',applyAttempted=True)
        receipt.write_text(json.dumps(result)+'\n')
        # Send the verified immutable bytes, not a path reopened after hashing.
        # One psql process/connection; SQL already owns BEGIN/COMMIT.
        try:
            applied=call(password,raw=raw,readonly=False)
        except BaseException as error:
            applied={'ok':False,'uncertain':True,'reason':'INTERRUPTED_'+type(error).__name__}
        finally:
            try:
                post=call(password,raw=final)
            except BaseException as error:
                post={'ok':False,'uncertain':True,'reason':'READBACK_INTERRUPTED_'+type(error).__name__}
        result['status']='COMMITTED_VERIFIED' if post['ok'] else 'UNRESOLVED_STOP_NO_RETRY'
        result['applyClientSuccess']=applied['ok']
        if not applied['ok']: result['applyDiagnostic']={k:v for k,v in applied.items() if k!='stdout'}
    if not post['ok']: result['readbackDiagnostic']={k:v for k,v in post.items() if k!='stdout'}
    if post['ok']:
        check=json.loads(post['stdout'])
        require(check=={'ledgerCount':335,'activeJobs':0,'queuedHttp':0},'FINAL_METADATA_DRIFT')
        result['readback']=check
    receipt.write_text(json.dumps(result,sort_keys=True)+'\n')
    print(json.dumps(result,sort_keys=True))
    require(post['ok'],'STOP_RECONCILE_READ_ONLY_NO_RETRY')

def inspect_connection():
    require(os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('GITHUB_REPOSITORY')=='Adoms17/quest-platform','APPROVED_RUNNER_REQUIRED')
    require(os.environ.get('GITHUB_REF')=='refs/heads/main','MAIN_ONLY')
    password=os.environ.get('PGPASSWORD',''); require(bool(password),'EXISTING_SECRET_MISSING')
    pre=psql(password,raw=PREFLIGHT)
    require(pre['ok'],'READ_ONLY_CONNECTION_FAILED')
    metadata=json.loads(pre['stdout'])
    require(metadata['serverVersion']==170006 and metadata['role']=='postgres' and metadata['database']=='postgres','TARGET_METADATA_DRIFT')
    require(metadata['ledgerCount'] in (99,335),'LEDGER_DRIFT')
    print(json.dumps({'status':'READ_ONLY_CONNECTION_VERIFIED','serverVersion':metadata['serverVersion'],'ledgerCount':metadata['ledgerCount'],'extensions':metadata['extensions']},sort_keys=True))

if __name__=='__main__':
    if sys.argv[1:]==['--inspect']:
        try: inspect_connection()
        except Exception as error:
            print('STOP: '+(str(error) if type(error) is RuntimeError else type(error).__name__),file=sys.stderr)
            sys.exit(1)
        sys.exit(0)
    p=argparse.ArgumentParser(); p.add_argument('--apply',type=Path,required=True); p.add_argument('--receipt',type=Path,required=True)
    a=p.parse_args()
    def interrupted(signum,frame): raise KeyboardInterrupt()
    handlers={sig:signal.signal(sig,interrupted) for sig in (signal.SIGINT,signal.SIGTERM)}
    try: execute(a.apply,a.receipt)
    except Exception as error:
        print('STOP: '+(str(error) if type(error) is RuntimeError else type(error).__name__),file=sys.stderr)
        sys.exit(1)
    finally:
        for sig,handler in handlers.items(): signal.signal(sig,handler)
