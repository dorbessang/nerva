import { useState } from 'react'
import './SearchableSelect.css'

// Reemplazo genérico de un <select> plano para listas que pueden ser largas
// (proyectos, productos, entidades) — un input de texto que filtra las
// opciones a medida que se tipea, en vez de tener que scrollear un
// desplegable nativo. Mismo patrón de interacción que ya usaba
// EntityTypeCombobox (Negotiations.jsx) para vincular entidades a un
// proyecto, generalizado acá para cualquier lista simple de {value, label}.
export default function SearchableSelect({ value, onChange, options, placeholder = 'Buscar...', emptyLabel = 'Sin asignar', disabled = false, style }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const selected = options.find(o => o.value === value)
  const matching = search.trim()
    ? options.filter(o => o.label.toLowerCase().includes(search.trim().toLowerCase()))
    : options
  // Mientras no se esté buscando activamente, el input muestra la opción
  // elegida como VALOR real (no como placeholder) -- antes usaba
  // selected.label de placeholder, que el navegador siempre pinta en gris
  // apagado, como si el campo estuviera vacío. Al enfocar se limpia para
  // arrancar la búsqueda con la lista completa a la vista.
  const displayValue = open ? search : (selected ? selected.label : search)

  return (
    <div className={`searchable-select ${selected && !open ? 'searchable-select--filled' : ''}`} style={style}>
      <input
        type="text"
        className="searchable-select-input"
        placeholder={placeholder}
        value={displayValue}
        autoComplete="off"
        disabled={disabled}
        onChange={e => setSearch(e.target.value)}
        onFocus={() => { setOpen(true); setSearch('') }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="searchable-select-dropdown">
          <div
            className="searchable-select-option searchable-select-option--empty"
            onMouseDown={() => { onChange(''); setSearch(''); setOpen(false) }}
          >
            {emptyLabel}
          </div>
          {matching.map(o => (
            <div
              key={o.value}
              className="searchable-select-option"
              onMouseDown={() => { onChange(o.value); setSearch(''); setOpen(false) }}
            >
              {o.label}
            </div>
          ))}
          {matching.length === 0 && <div className="searchable-select-empty">Sin resultados</div>}
        </div>
      )}
    </div>
  )
}
