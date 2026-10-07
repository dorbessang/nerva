import { useState, useRef } from 'react'
import { ListFilter } from 'lucide-react'
import { useCloseOnOutsideOrEscape } from '../lib/useCloseOnOutsideOrEscape'
import ColumnFilterMenu from './ColumnFilterMenu'
import './FiltersPanelButton.css'

// Botón único "Filtros" — un panel con un ColumnFilterMenu por campo
// filtrable, visible en cualquier vista (Tabla/Mosaico/Kanban). En Tabla
// convive con el filtro rápido del propio encabezado de columna (mismo
// estado, dos caminos); en Mosaico/Kanban es la única forma de filtrar por
// algo que no sea el campo con tarjetas propias (Estado, Tipo de producto,
// etc. — esos ya tienen su fila de tarjetas siempre visible arriba).
export default function FiltersPanelButton({ groups }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useCloseOnOutsideOrEscape(ref, open, () => setOpen(false))

  const activeCount = groups.filter(g => (g.selected || []).length > 0).length

  return (
    <div className="filters-panel-wrap" ref={ref}>
      <button
        type="button"
        className={`neg-col-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Filtrar por otros campos"
      >
        <ListFilter size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
        Filtros{activeCount > 0 ? ` (${activeCount})` : ''}
      </button>
      {open && (
        <div className="filters-panel-popover">
          {groups.length === 0 ? (
            <div className="filters-panel-empty">No hay más campos filtrables configurados.</div>
          ) : groups.map(g => (
            <div key={g.key} className="filters-panel-group">
              <div className="filters-panel-group-label">{g.label}</div>
              <ColumnFilterMenu options={g.options} selected={g.selected || []} onChange={g.onChange} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
