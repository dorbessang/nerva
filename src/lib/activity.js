// Log de actividad — alimenta el timeline de proyectos y de entidades.

export async function logActivity(supabase, { workspaceId, negotiationId, entityId, type, title, actorId }) {
  await supabase.from('activity_log').insert({
    workspace_id: workspaceId,
    negotiation_id: negotiationId || null,
    entity_id: entityId || null,
    type,
    title,
    actor_id: actorId || null,
  })
}
