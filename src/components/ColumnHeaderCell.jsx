import { useState, useRef } from 'react'
import { ListFilter } from 'lucide-react'
import { useCloseOnOutsideOrEscape } from '../lib/useCloseOnOutsideOrEscape'
import './ColumnHeaderCell.css'

export const DEFAULT_COL_WIDTH = 170
const MIN_COL_WIDTH = 70

// <th> con click-para-ordenar (label), filtro opcional en popover (▾) y
// ancho ajustable a mano (arrastrando el borde derecho, estilo Excel) — una
// vez fijado el ancho queda igual pase lo que pase con el contenido de la
// tabla, hasta que el usuario lo vuelva a mover. El ancho se persiste vía
// `onResize`, que el padre guarda en las mismas prefs de columnas por
// usuario (useColumnPrefs) — nunca se recalcula solo por el contenido.
export default function ColumnHeaderCell({ label, sortDir, onSort, filterable, filterActive, width, onResize, children }) {
  const [open, setOpen] = useState(false)
  const [dragWidth, setDragWidth] = useState(null)
  const ref = useRef(null)
  const thRef = useRef(null)
  useCloseOnOutsideOrEscape(ref, open, () => setOpen(false))

  function startResize(e) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = thRef.current?.offsetWidth || width || DEFAULT_COL_WIDTH

    function onMove(ev) {
      setDragWidth(Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX)))
    }
    function onUp(ev) {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      const next = Math.max(MIN_COL_WIDTH, startWidth + (ev.clientX - startX))
      setDragWidth(null)
      onResize?.(next)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const effectiveWidth = dragWidth ?? width ?? DEFAULT_COL_WIDTH

  return (
    <th className="sortable-th" ref={thRef} style={{ width: effectiveWidth, minWidth: effectiveWidth, maxWidth: effectiveWidth }}>
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
              <ListFilter size={14} strokeWidth={2.2} />
            </button>
            {open && (
              <div className="sortable-th-filter-popover" onClick={e => e.stopPropagation()}>
                {children}
              </div>
            )}
          </div>
        )}
      </div>
      {onResize && (
        <span
          className="col-resize-handle"
          onMouseDown={startResize}
          onClick={e => e.stopPropagation()}
          title="Arrastrar para cambiar el ancho"
        />
      )}
    </th>
  )
}
