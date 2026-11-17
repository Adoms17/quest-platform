begin;
insert into auth.users(id,email) values(md5('section-test-user')::uuid,'sections@example.test');
select set_config('request.jwt.claim.sub',md5('section-test-user')::uuid::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',md5('section-test-user')::uuid,'role','authenticated','aal','aal2')::text,true);
set local role authenticated;
do $$ begin
 if public.read_my_platform_sections()<>'[]'::jsonb then raise exception 'unassigned access'; end if;
end $$;
reset role;
insert into public.platform_access_assignments(user_id,role_key,scope_kind)
 values(md5('section-test-user')::uuid,'operations','platform');
set local role authenticated;
do $$ begin
 if not (public.read_my_platform_sections() ? 'organizations') then raise exception 'operations missing'; end if;
 if public.read_my_platform_sections() ? 'documents' then raise exception 'owner menu leaked'; end if;
end $$;
reset role;
update public.platform_access_assignments set revoked_at=clock_timestamp() where user_id=md5('section-test-user')::uuid;
set local role authenticated;
do $$ begin
 if public.read_my_platform_sections()<>'[]'::jsonb then raise exception 'revoked access'; end if;
end $$;
reset role;
update public.platform_access_assignments set revoked_at=null,valid_from=statement_timestamp()+interval '1 hour' where user_id=md5('section-test-user')::uuid;
set local role authenticated;
do $$ begin
 if public.read_my_platform_sections()<>'[]'::jsonb then raise exception 'future access'; end if;
end $$;
reset role;
update public.platform_access_assignments set valid_from=statement_timestamp()-interval '2 hours',expires_at=statement_timestamp()-interval '1 hour' where user_id=md5('section-test-user')::uuid;
set local role authenticated;
do $$ begin
 if public.read_my_platform_sections()<>'[]'::jsonb then raise exception 'expired access'; end if;
end $$;
reset role;
update public.platform_access_assignments set expires_at=null,role_key='owner' where user_id=md5('section-test-user')::uuid;
set local role authenticated;
do $$ begin
 if jsonb_array_length(public.read_my_platform_sections())<>7 then raise exception 'owner sections'; end if;
end $$;
select set_config('request.jwt.claim.sub',md5('section-test-user')::uuid::text,true);
reset role;
update public.platform_access_assignments set role_key='operations',scope_kind='organization',
 organization_id=(select id from public.organizations where personal_owner_id=md5('section-test-user')::uuid)
 where user_id=md5('section-test-user')::uuid;
set local role authenticated;
do $$ begin
 if public.read_my_platform_sections()<>'["organizations"]'::jsonb then raise exception 'scoped menu leaked'; end if;
end $$;
reset role;
insert into public.platform_support_cases(id,organization_id,created_by)
 select md5('section-support')::uuid,id,md5('section-test-user')::uuid from public.organizations where personal_owner_id=md5('section-test-user')::uuid;
update public.platform_access_assignments set role_key='support',scope_kind='support_case',support_case_id=md5('section-support')::uuid,expires_at=statement_timestamp()+interval '1 hour'
 where user_id=md5('section-test-user')::uuid;
set local role authenticated;
do $$ begin
 if public.read_my_platform_sections()<>'["organizations"]'::jsonb then raise exception 'support menu'; end if;
end $$;
reset role;
update public.platform_support_cases set closed_at=clock_timestamp() where id=md5('section-support')::uuid;
set local role authenticated;
do $$ begin
 if public.read_my_platform_sections()<>'[]'::jsonb then raise exception 'closed support access'; end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',md5('section-test-user')::uuid,'role','authenticated','aal','aal1')::text,true);
do $$ begin
 begin perform public.read_my_platform_sections(); raise exception 'aal1 accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.read_my_platform_sections()','EXECUTE')
 or has_function_privilege('service_role','public.read_my_platform_sections()','EXECUTE') then raise exception 'unexpected execute grant'; end if;
 if not (select relrowsecurity from pg_class where oid='public.platform_access_assignments'::regclass) then raise exception 'RLS disabled'; end if;
end $$;
rollback;
