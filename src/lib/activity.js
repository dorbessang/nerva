// Log de actividad — alimenta el timeline de proyectos y de entidades.

export async function logActivity(supabase, { workspaceId, negotiationId, entityId, type, title, actorId }) {
  const { error } = await supabase.from('activity_log').insert({
    workspace_id: workspaceId,
    negotiation_id: negotiationId || null,
    entity_id: entityId || null,
    type,
    title,
    actor_id: actorId || null,
  })
  if (error) console.error('logActivity error:', error.message)
  return { error }
}
