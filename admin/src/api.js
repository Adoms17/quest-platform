// Все административные чтения проходят серверную проверку прав и MFA.
export function createAdminApi(client) {
  async function rpc(name, parameters) {
    const { data, error } = await client.rpc(name, parameters)
    if (error) throw error
    return data
  }
  return {
    issueCampaign: (organizationId, id, revision, command, deadline = null) => rpc('issue_platform_campaign_discount', { p_organization_id:organizationId, p_campaign_id:id, p_expected_revision:revision, p_command_id:command, p_activate_before:deadline }),
    saveCampaign: parameters => rpc('save_platform_discount_campaign', parameters),
    approveCampaign: (id, revision, command) => rpc('approve_platform_discount_campaign', { p_id:id, p_expected_revision:revision, p_command_id:command }),
    campaigns: (organizationId, cursor = null, id = null, revision = null) => rpc('read_platform_discount_campaigns', { p_organization_id: organizationId, p_after: cursor, p_id: id, p_expected_revision: revision }),
    discounts: (organizationId, cursor = null) => rpc('read_platform_organization_discounts', { p_organization_id: organizationId, p_after: cursor }),
    scheduleSupportEnd: (id, endsAt, count, command) => rpc('schedule_tariff_support_end', {p_version_id:id,p_ends_at:endsAt,p_expected_count:count,p_command_id:command}),
    previewSupportEnd: id => rpc('preview_tariff_support_end', { p_version_id: id }),
    publishDraft: (id, revision, effectiveAt, command) => rpc('publish_tariff_draft', { p_draft_id: id, p_expected_revision: revision, p_effective_at: effectiveAt, p_command_id: command }),
    revokePublication: (id, command) => rpc('revoke_tariff_publication', { p_version_id: id, p_command_id: command }),
    timeline: (sourceId, cursor = null) => rpc('read_platform_tariff_timeline', { p_source_id: sourceId, p_after: cursor }),
    drafts: (sourceId, cursor = null) => rpc('read_platform_tariff_drafts', { p_source_version_id: sourceId, p_after: cursor }),
    previewDraft: (id, revision) => rpc('preview_platform_tariff_draft', { p_id: id, p_expected_revision: revision }),
    fixedVersions: (source, draft = null, cursor = null) => rpc('list_fixed_tariff_versions', { p_source_id: source, p_draft_id: draft, p_after: cursor }),
    fixedDraft: (id, revision) => rpc('read_fixed_tariff_draft_version', { p_draft_id: id, p_revision: revision }),
    previewActivation: id => rpc('preview_fixed_tariff_activation', { p_id: id }),
    enableVersion: (id, previous, command) => rpc('enable_fixed_tariff_version', { p_id: id, p_expected_previous_id: previous, p_command_id: command }),
    fixDraft: (id, revision, command) => rpc('fix_platform_tariff_version', { p_draft_id: id, p_expected_revision: revision, p_command_id: command }),
    saveDraft: parameters => rpc('save_platform_tariff_draft', parameters),
    tariffs: (cursor = null, id = null, planKey = 'free') => id ? rpc('read_platform_tariff_catalog', { p_after: null, p_id: id }) : rpc('read_platform_tariff_versions', { p_plan_key: planKey, p_after: cursor }),
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
