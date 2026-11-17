// Only for disposable integration databases; never import from a deployment runner.
export function isolatedSandboxBootstrap(containerName) {
 if(!/^qvesta-release-test-[a-f0-9]{32}$/.test(containerName))throw Error('Disposable test container required')
 return `do $test_environment$
 begin
  if exists(select 1 from platform_private.billing_runtime_environment where environment<>'sandbox') then
   raise exception 'test bootstrap refuses configured non-sandbox environment';
  end if;
  if not exists(select 1 from platform_private.billing_runtime_environment) then
   insert into platform_private.billing_runtime_environment(environment) values('sandbox');
  end if;
  perform platform_private.require_sandbox_environment();
 end; $test_environment$;`
}
