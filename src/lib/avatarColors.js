// Iniciales + color de avatar por nombre — compartido entre Entidades,
// Productos y (desde la unificación de Mosaico) Proyectos, así una misma
// entidad/producto/proyecto siempre cae en el mismo color sin importar
// desde qué página se lo mire.
const AVATAR_COLORS = [
  ['#EFF6FF', '#1D4ED8'],
  ['#F5F3FF', '#6D28D9'],
  ['#ECFDF5', '#059669'],
  ['#FFFBEB', '#D97706'],
  ['#FEF2F2', '#DC2626'],
]

export function getInitials(name) {
  return (name || '').split(' ').filter(Boolean).map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

export function getAvatarColor(name) {
  const code = (name || '').charCodeAt(0) || 0
  return AVATAR_COLORS[code % AVATAR_COLORS.length]
}
