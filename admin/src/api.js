// Все административные чтения проходят серверную проверку прав и MFA.
export function createAdminApi(client) {
  async function rpc(name, parameters) {
    const { data, error } = await client.rpc(name, parameters)
    if (error) throw error
    return data
  }
  return {
    search: (query = '', cursor = null) => rpc('search_platform_organizations', {
      p_search: query.trim(), p_after: cursor, p_limit: 25,
    }),
    organization: id => rpc('get_platform_organization_summary', { p_organization_id: id }),
  }
}

export function adminError(error) {
  if (error?.code === '42501') return 'Доступ не предоставлен или отозван. Обратитесь к владельцу платформы.'
  return 'Не удалось выполнить запрос. Проверьте соединение и повторите попытку.'
}
