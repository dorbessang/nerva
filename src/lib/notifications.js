// Helpers para notificaciones in-app.

// Por defecto todo tipo de notificación está habilitado — solo se
// deshabilita si el usuario explícitamente guardó enabled:false para ese
// (usuario, workspace, tipo) en notification_preferences.
export async function isNotificationEnabled(supabase, { userId, workspaceId, type }) {
  const { data } = await supabase
    .from('notification_preferences')
    .select('enabled')
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .eq('type', type)
    .maybeSingle()
  return data?.enabled !== false
}

async function filterEnabled(supabase, workspaceId, type, userIds) {
  const checks = await Promise.all(
    userIds.map(async (uid) => ({ uid, ok: await isNotificationEnabled(supabase, { userId: uid, workspaceId, type }) }))
  )
  return checks.filter(c => c.ok).map(c => c.uid)
}

export async function notifyRoleChanged(supabase, { workspaceId, userId, newRoleLabel, actingUserId }) {
  if (!userId || userId === actingUserId) return
  if (!(await isNotificationEnabled(supabase, { userId, workspaceId, type: 'role_changed' }))) return
  await supabase.from('notifications').insert({
    workspace_id: workspaceId,
    user_id: userId,
    type: 'role_changed',
    title: 'Tu rol cambió',
    body: `Ahora sos ${newRoleLabel} en este workspace.`,
  })
}

export async function notifyNegotiationStatusChanged(supabase, { workspaceId, negotiationId, negotiationTitle, newStatus, recipients, actingUserId }) {
  const candidates = [...new Set((recipients || []).filter(Boolean))].filter(id => id !== actingUserId)
  if (candidates.length === 0) return
  const toNotify = await filterEnabled(supabase, workspaceId, 'negotiation_status_changed', candidates)
  if (toNotify.length === 0) return
  await supabase.from('notifications').insert(
    toNotify.map(uid => ({
      workspace_id: workspaceId,
      user_id: uid,
      negotiation_id: negotiationId,
      type: 'negotiation_status_changed',
      title: 'Cambio de estado de proyecto',
      body: `"${negotiationTitle}" pasó a estado "${newStatus}".`,
    }))
  )
}
