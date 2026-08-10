// Tarjeta de total — siempre la primera de la fila de tarjetas en
// Proyectos/Entidades/Productos (y en cada página por tipo de entidad).
// Cuando hay algún filtro activo (búsqueda, checklist de columna, tarjetas
// de tipo/estado/país...) agrega una segunda línea de subtotal, nombrando
// qué está filtrado cuando se puede armar una etiqueta legible.
export default function TotalStatCard({ label, plural, total, filteredCount, filterParts }) {
  const isFiltered = typeof filteredCount === 'number' && filteredCount !== total
  const description = (filterParts || []).filter(Boolean).join(' · ')
  return (
    <div className="neg-stat-card neg-stat-card--total">
      <div className="neg-stat-label">{label}</div>
      <div className="neg-stat-count">{total}</div>
      {isFiltered && (
        <div className="neg-stat-subtotal">
          {filteredCount} {plural}{description ? `: ${description}` : ''}
        </div>
      )}
    </div>
  )
}
