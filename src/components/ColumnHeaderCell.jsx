import { useState, useRef } from 'react'
import { useCloseOnOutsideOrEscape } from '../lib/useCloseOnOutsideOrEscape'

// <th> con click-para-ordenar (label) + filtro opcional en popover (▾) —
// el filtro convive con los de la toolbar, no los reemplaza: ambos escriben
// al mismo estado de filtros del padre, así que quedan siempre en sync.
export default function ColumnHeaderCell({ label, sortDir, onSort, filterable, filterActive, children }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useCloseOnOutsideOrEscape(ref, open, () => setOpen(false))

  return (
    <th className="sortable-th">
      <div className="sortable-th-inner">
        <span className="sortable-th-label" onClick={onSort} role="button" tabIndex={0}>
          {label}
          <span className={`sortable-th-arrow ${sortDir ? 'visible' : ''}`}>{sortDir === 'desc' ? '▼' : '▲'}</span>
        </span>
        {filterable && (
          <div className="sortable-th-filter" ref={ref}>
            <button
              type="button"
              className={`sortable-th-filter-btn ${open ? 'open' : ''} ${filterActive ? 'active' : ''}`}
              onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
              title="Filtrar por esta columna"
            >
              ▾
            </button>
            {open && (
              <div className="sortable-th-filter-popover" onClick={e => e.stopPropagation()}>
                {children}
              </div>
            )}
          </div>
        )}
      </div>
    </th>
  )
}
