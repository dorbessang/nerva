import ColumnHeaderCell from './ColumnHeaderCell'
import ColumnFilterMenu from './ColumnFilterMenu'
import './TableGrid.css'

// Vista Tabla compartida por Proyectos/Entidades/Productos — encabezado con
// click-para-ordenar, ancho de columna ajustable a mano (ColumnHeaderCell)
// y filtro tipo Excel por columna (ColumnFilterMenu) cuando `getColumnFilter`
// devuelve algo para esa key. El contenido de cada celda queda 100% a cargo
// de `renderCell`, que cada página resuelve como corresponda a sus datos.
export default function TableGrid({
  rows,
  rowKey,
  cols,
  allColumns,
  renderCell,
  getColumnFilter,
  sortKey,
  sortDir,
  onSort,
  onColResize,
  showCheckbox,
  selectedIds,
  onToggleSelect,
  allVisibleSelected,
  onToggleSelectAll,
  onSelectRow,
  rowClassName,
  getNumber,
}) {
  const visibleCols = cols.filter(c => c.visible)

  return (
    <div className="neg-table-wrapper">
      <table className="neg-table">
        <thead>
          <tr>
            {getNumber && <th className="neg-th-number">#</th>}
            {showCheckbox && (
              <th className="neg-th-check">
                <input type="checkbox" checked={allVisibleSelected} onChange={onToggleSelectAll} title="Seleccionar todos los visibles" />
              </th>
            )}
            {visibleCols.map(c => {
              const def = allColumns.find(x => x.key === c.key)
              const filter = getColumnFilter ? getColumnFilter(c.key) : null
              return (
                <ColumnHeaderCell
                  key={c.key}
                  label={def?.label}
                  sortDir={sortKey === c.key ? sortDir : null}
                  onSort={() => onSort(c.key)}
                  filterable={!!filter}
                  filterActive={!!filter && filter.selected.length > 0}
                  width={c.width}
                  onResize={w => onColResize(c.key, w)}
                >
                  {filter && <ColumnFilterMenu options={filter.options} selected={filter.selected} onChange={filter.onChange} />}
                </ColumnHeaderCell>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const key = rowKey(row)
            return (
              <tr key={key} onClick={() => onSelectRow(row)} className={`neg-table-row ${rowClassName ? rowClassName(row) : ''}`}>
                {getNumber && <td className="neg-td-number">{getNumber(row)}</td>}
                {showCheckbox && (
                  <td className="neg-td-check" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(key)} onChange={() => onToggleSelect(key)} />
                  </td>
                )}
                {visibleCols.map(c => renderCell(c.key, row))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
