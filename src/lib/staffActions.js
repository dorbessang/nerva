// Ejecuta una acción directo si quien la pide ya tiene, en la base, el rol
// necesario -- o la deja pendiente de aprobación de un owner del workspace
// si es staff actuando por encima de su rol real ahí (ver PENDIENTES.md,
// "Solicitud de acción de staff"). Nunca aplica a usuarios normales: un
// cliente sin el rol ni ve el botón (gateado client-side por
// effectiveRole), así que si alguien no-staff llega hasta acá es porque
// su rol real ya alcanza.
export async function withOwnerApproval(supabase, { isStaff, role, workspaceId, actionType, payload }, directFn) {
  if (isStaff && role !== 'owner') {
    const { error } = await supabase.rpc('request_staff_action', {
      p_workspace_id: workspaceId,
      p_action_type: actionType,
      p_payload: payload,
    })
    return { requested: true, error }
  }
  await directFn()
  return { requested: false, error: null }
}
