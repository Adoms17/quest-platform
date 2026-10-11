-- Participant managers manage quest participants, not organization staff roles.
-- Keeping members.manage on that role would allow privilege escalation to admin.

delete from public.role_permissions role_permission
using public.roles role, public.permissions permission
where role_permission.role_id = role.id
  and role_permission.permission_id = permission.id
  and role.key = 'participant_manager'
  and permission.key = 'members.manage';

