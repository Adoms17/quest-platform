// identity — результат authenticateRefundOwner, не тело HTTP запроса.
export function sandboxRefundGatewayRpc(service, identity) {
 const context = { p_actor_user_id: identity.actorId, p_mfa_at: identity.mfaAt, p_expires_at: identity.expiresAt }
 const actions = { read_sandbox_refund: 'read', begin_sandbox_refund: 'begin', record_sandbox_refund: 'record', reject_sandbox_refund: 'reject' }
 return (name, args) => {
  if (!Object.hasOwn(actions, name)) throw new Error('invalid_refund_gateway_action')
  return service.rpc('sandbox_refund_from_gateway', { ...context, p_action: actions[name], p_refund_id: args.p_refund_id,
   p_result: name === 'record_sandbox_refund' ? { refundId: args.p_provider_id, status: args.p_status } : null })
 }
}
