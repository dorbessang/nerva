import { useState } from 'react'

// Filtro de columna estilo Excel: buscador + checklist de todos los valores
// posibles, en vez de un <select> de una sola opción — se puede tildar
// varios valores a la vez (match "alguno de los tildados").
export default function ColumnFilterMenu({ options, selected = [], onChange, searchPlaceholder = 'Buscar...' }) {
  const [query, setQuery] = useState('')
  const visible = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options
  const allVisibleSelected = visible.length > 0 && visible.every(o => selected.includes(o.id))

  function toggle(id) {
    onChange(selected.includes(id) ? selected.filter(v => v !== id) : [...selected, id])
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      const visibleIds = new Set(visible.map(o => o.id))
      onChange(selected.filter(id => !visibleIds.has(id)))
    } else {
      const add = visible.map(o => o.id).filter(id => !selected.includes(id))
      onChange([...selected, ...add])
    }
  }

  return (
    <div className="col-filter-menu">
      <input
        type="text"
        className="col-filter-search"
        placeholder={searchPlaceholder}
        value={query}
        onChange={e => setQuery(e.target.value)}
        autoFocus
      />
      <div className="col-filter-actions">
        <button type="button" onClick={toggleAllVisible}>{allVisibleSelected ? 'Ninguno' : 'Todos'}</button>
        {selected.length > 0 && <button type="button" onClick={() => onChange([])}>Limpiar</button>}
      </div>
      <div className="col-filter-list">
        {visible.length === 0 && <div className="col-filter-empty">Sin resultados</div>}
        {visible.map(o => (
          <label key={o.id} className="col-filter-item">
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
