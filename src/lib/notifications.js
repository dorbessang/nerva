// Helpers para notificaciones in-app que no son sobre una tarea puntual.

export async function notifyRoleChanged(supabase, { workspaceId, userId, newRoleLabel, actingUserId }) {
  if (!userId || userId === actingUserId) return
  await supabase.from('notifications').insert({
    workspace_id: workspaceId,
    user_id: userId,
    type: 'role_changed',
    title: 'Tu rol cambió',
    body: `Ahora sos ${newRoleLabel} en este workspace.`,
  })
}

export async function notifyNegotiationStatusChanged(supabase, { workspaceId, negotiationId, negotiationTitle, newStatus, recipients, actingUserId }) {
  const toNotify = [...new Set((recipients || []).filter(Boolean))].filter(id => id !== actingUserId)
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
