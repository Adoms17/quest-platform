export function hasOrganizationPermission(organization, permissionKey) {
  return Boolean(organization?.permissions?.includes(permissionKey))
}
