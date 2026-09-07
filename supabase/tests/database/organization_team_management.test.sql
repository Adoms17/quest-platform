begin;

select plan(19);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('1a000000-0000-4000-8000-000000000001', 'team-owner@example.test', '{"username":"Team owner"}'::jsonb),
  ('1a000000-0000-4000-8000-000000000002', 'team-member@example.test', '{"username":"Team member"}'::jsonb),
  ('1a000000-0000-4000-8000-000000000003', 'wrong-member@example.test', '{"username":"Wrong member"}'::jsonb),
  ('1a000000-0000-4000-8000-000000000004', 'outsider-team@example.test', '{"username":"Outsider"}'::jsonb);

insert into public.organization_memberships (organization_id, user_id, status)
values (
  (select id from public.organizations where personal_owner_id = '1a000000-0000-4000-8000-000000000001'),
  '1a000000-0000-4000-8000-000000000004',
  'active'
);

insert into public.membership_roles (membership_id, role_id)
select membership.id, role.id
from public.organization_memberships membership
join public.roles role on role.key = 'participant_manager'
where membership.organization_id = (
    select id from public.organizations where personal_owner_id = '1a000000-0000-4000-8000-000000000001'
  )
  and membership.user_id = '1a000000-0000-4000-8000-000000000004';

select set_config(
  'app.test_team_organization_id',
  (select id::text from public.organizations where personal_owner_id = '1a000000-0000-4000-8000-000000000001'),
  true
);

select set_config('request.jwt.claim.sub', '1a000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  format(
    $$select * from public.create_organization_invitation(%L::uuid, ' NORMALIZE@example.test ', array['admin'])$$,
    current_setting('app.test_team_organization_id')
  ),
  'a team manager can create an email-bound invitation'
);

reset role;

select set_config(
  'app.test_team_invitation_id',
  (select id::text from public.organization_invitations where email = 'normalize@example.test'),
  true
);

select set_config(
  'app.test_team_invitation_token',
  (
    select invitation_token
    from public.create_organization_invitation(
      current_setting('app.test_team_organization_id')::uuid,
      'second-invite@example.test',
      array['host']
    )
  ),
  true
);

-- Use the first invitation's known database hash to verify that raw tokens are not stored.
select matches(
  (select token_hash from public.organization_invitations where id = current_setting('app.test_team_invitation_id')::uuid),
  '^[0-9a-f]{64}$',
  'only a SHA-256 token hash is stored'
);

select is(
  (select email from public.organization_invitations where id = current_setting('app.test_team_invitation_id')::uuid),
  'normalize@example.test',
  'invitation email is normalized'
);

select is(
  (
    select count(*)
    from public.organization_audit_events
    where action = 'invitation.created'
      and organization_id = current_setting('app.test_team_organization_id')::uuid
  ),
  2::bigint,
  'invitation creation is audited'
);

select is(
  (
    select count(*)
    from public.organization_audit_events
    where organization_id = current_setting('app.test_team_organization_id')::uuid
      and metadata ?| array['token', 'token_hash', 'email']
  ),
  0::bigint,
  'audit metadata excludes invitation secrets and email'
);

select set_config('request.jwt.claim.sub', '1a000000-0000-4000-8000-000000000004', true);
set local role authenticated;

select isnt(
  public.has_organization_permission(
    current_setting('app.test_team_organization_id')::uuid,
    'members.manage'
  ),
  true,
  'a participant manager cannot manage organization staff roles'
);

select is(
  (select count(*) from public.organization_invitations),
  0::bigint,
  'an outsider cannot list organization invitations'
);

select throws_ok(
  format(
    $$select * from public.create_organization_invitation(%L::uuid, 'denied@example.test', array['host'])$$,
    current_setting('app.test_team_organization_id')
  ),
  '42501',
  'organization member management denied',
  'an outsider cannot create an invitation'
);

reset role;
select set_config('request.jwt.claim.sub', '1a000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select throws_ok(
  format(
    $$select * from public.create_organization_invitation(%L::uuid, 'owner-invite@example.test', array['owner'])$$,
    current_setting('app.test_team_organization_id')
  ),
  '22023',
  'invalid or forbidden invitation roles',
  'the owner role cannot be granted through an invitation'
);

-- Create a fresh invitation and retain its one-time token for acceptance checks.
select set_config(
  'app.test_accept_token',
  (
    select invitation_token
    from public.create_organization_invitation(
      current_setting('app.test_team_organization_id')::uuid,
      'team-member@example.test',
      array['admin']
    )
  ),
  true
);

reset role;
select set_config('request.jwt.claim.sub', '1a000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select throws_ok(
  format(
    $$select * from public.accept_organization_invitation(%L)$$,
    current_setting('app.test_accept_token')
  ),
  '42501',
  'invitation belongs to another account',
  'an invitation cannot be accepted by another email account'
);

reset role;
select set_config('request.jwt.claim.sub', '1a000000-0000-4000-8000-000000000002', true);
set local role authenticated;

select lives_ok(
  format(
    $$select * from public.accept_organization_invitation(%L)$$,
    current_setting('app.test_accept_token')
  ),
  'the matching account can accept an invitation'
);

select lives_ok(
  format(
    $$select * from public.accept_organization_invitation(%L)$$,
    current_setting('app.test_accept_token')
  ),
  'accepting an accepted invitation is idempotent for the same account'
);

select is(
  (
    select count(*)
    from public.organization_memberships
    where organization_id = current_setting('app.test_team_organization_id')::uuid
      and user_id = '1a000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'invitation acceptance creates exactly one membership'
);

select ok(
  public.has_organization_permission(
    current_setting('app.test_team_organization_id')::uuid,
    'members.manage'
  ),
  'the accepted admin role grants team management permission'
);

reset role;
select set_config('request.jwt.claim.sub', '1a000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select throws_ok(
  format(
    $$select public.set_organization_member_roles(%L::uuid, array['host'])$$,
    (
      select id
      from public.organization_memberships
      where organization_id = current_setting('app.test_team_organization_id')::uuid
        and user_id = '1a000000-0000-4000-8000-000000000001'
    )
  ),
  '42501',
  'owner roles require the ownership transfer flow',
  'ordinary role management cannot modify an owner'
);

select lives_ok(
  format(
    $$select public.set_organization_member_roles(%L::uuid, array['host'])$$,
    (
      select id
      from public.organization_memberships
      where organization_id = current_setting('app.test_team_organization_id')::uuid
        and user_id = '1a000000-0000-4000-8000-000000000002'
    )
  ),
  'a manager can replace a non-owner member role'
);

select lives_ok(
  format(
    $$select public.revoke_organization_membership(%L::uuid)$$,
    (
      select id
      from public.organization_memberships
      where organization_id = current_setting('app.test_team_organization_id')::uuid
        and user_id = '1a000000-0000-4000-8000-000000000002'
    )
  ),
  'a manager can revoke a non-owner membership'
);

select is(
  (
    select status
    from public.organization_memberships
    where organization_id = current_setting('app.test_team_organization_id')::uuid
      and user_id = '1a000000-0000-4000-8000-000000000002'
  ),
  'revoked',
  'revoked membership is retained for auditability'
);

select is(
  (
    select count(*)
    from public.organization_audit_events
    where organization_id = current_setting('app.test_team_organization_id')::uuid
      and action in ('invitation.accepted', 'membership.roles_changed', 'membership.revoked')
  ),
  3::bigint,
  'acceptance and membership changes are audited once'
);

select * from finish();
rollback;
