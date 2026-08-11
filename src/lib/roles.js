// Roles de workspace_members, de más a menos privilegio. Único lugar donde
// se define la lista y qué puede hacer cada uno — antes cada pantalla
// comparaba el string a mano (17+ veces, repartidas en 6 archivos).
export const ROLES = ['owner', 'admin', 'editor', 'viewer']

export const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

export function isOwner(role) {
  return role === 'owner'
}

// owner/admin: gestión del workspace (invitar, borrar en bloque, pausar
// proyectos, etc.)
export function isPrivileged(role) {
  return role === 'owner' || role === 'admin'
}

// Cualquier rol menos viewer: puede crear/editar contenido (proyectos,
// notas, tareas, etc.), no solo verlo.
export function canEditContent(role) {
  return role !== 'viewer'
}
