import { getCustomFieldValue, renderCustomFieldDisplay, resolveMemberNames, isFieldFilterable, filterChoicesFor } from '../../../lib/customFields'
import { entityHasType } from '../../../lib/entityTypes'
import TableGrid from '../../../components/TableGrid'
import { getProductName, getEntitiesOfType } from '../helpers'
import StatusDaysBadge from './StatusDaysBadge'
import '../../../components/CustomFieldInput.css'
import '../../Negotiations.css'

// Render de una celda según el key de columna
function renderCell(key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members, refLists) {
  const cfg = getStateConfig(neg.status)

  if (key.startsWith('entity_type:')) {
    const ents = getEntitiesOfType(neg, key.slice('entity_type:'.length))
    if (ents.length === 0) return <td key={key}>—</td>
    return (
      <td key={key} className="neg-td-entity">
        <span className="neg-entity-name">
          {ents[0].country_code && <img src={`https://flagcdn.com/w20/${ents[0].country_code.toLowerCase()}.png`} alt="" className="neg-flag" />}
          {ents.map(e => e.name).join(', ')}
        </span>
      </td>
    )
  }

  switch (key) {
    case 'product': {
      const actIcon = neg.activity_status === 'inactive' ? '💤' : neg.activity_status === 'paused' ? '⏸' : null
      return (
        <td key={key} className="neg-td-product">
          {actIcon && <span className={`neg-paused-icon ${neg.activity_status === 'inactive' ? 'neg-icon-inactive' : 'neg-icon-paused'}`}>{actIcon}</span>}
          {neg.product || neg.title}
        </td>
      )
    }
    case 'products':
      return <td key={key}>{getProductName(neg)}</td>
    case 'status':
      return <td key={key}><span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span> <StatusDaysBadge neg={neg} /></td>
    case 'target_date':
      return <td key={key} className="neg-td-date">{neg.target_date || '—'}</td>
    case 'participants': {
      const names = resolveMemberNames(members, neg.participants)
      return (
        <td key={key}>
          <div className="neg-chips">
            {names.slice(0, 2).map(n => <span key={n} className="neg-chip neg-chip-blue">{n}</span>)}
            {names.length > 2 && <span className="neg-chip neg-chip-gray">+{names.length - 2}</span>}
          </div>
        </td>
      )
    }
    case 'notes': {
      const list = neg.notes_list || []
      if (!list.length) return <td key={key} className="neg-td-text" style={{ color: '#d1d5db' }}>Sin notas</td>
      const preview = list.map(n => `${new Date(n.note_date + 'T00:00:00').toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' })}: ${n.content}`).join(' · ')
      return <td key={key} className="neg-td-text">{preview}</td>
    }
    case 'description':
      return <td key={key} className="neg-td-text">{neg.description ? neg.description : '—'}</td>
    case 'observations':
      return <td key={key} className="neg-td-text">{neg.observations ? neg.observations : '—'}</td>
    case 'activity_status': {
      const map = { active: 'En curso', paused: '⏸ Pausado', inactive: '💤 Inactivo' }
      return <td key={key}><span className="neg-nda-badge">{map[neg.activity_status] || '—'}</span></td>
    }
    case 'last_activity_at': {
      if (!neg.last_activity_at) return <td key={key}>—</td>
      const days = Math.floor((Date.now() - new Date(neg.last_activity_at)) / 86400000)
      const label = days === 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days}d`
      return <td key={key} className="neg-td-date">{label}</td>
    }
    default: {
      const def = customFieldDefs?.find(d => d.key === key)
      if (!def) return <td key={key}>—</td>
      return <td key={key} className="neg-td-text">{renderCustomFieldDisplay(def, getCustomFieldValue(neg.custom_fields, key), members, refLists)}</td>
    }
  }
}

export default function TableView({ negotiations, allRows, getFacetRows, getStateConfig, getEntityName, getEntityFlag, onSelect, cols, allColumns, customFieldDefs, members, selectedIds, onToggleSelect, allVisibleSelected, onToggleSelectAll, sortKey, sortDir, onSort, customStates, customFilterValues, onFilterChange, entities, entityTypeFilters, onEntityTypeFilterChange, onColResize, refLists }) {
  function getColumnFilter(key) {
    if (key.startsWith('entity_type:')) {
      const typeId = key.slice('entity_type:'.length)
      return {
        options: entities.filter(en => entityHasType(en, typeId)).map(en => ({ id: en.id, label: en.name })),
        selected: entityTypeFilters?.[typeId] || [],
        onChange: v => onEntityTypeFilterChange(typeId, v),
      }
    }
    const fieldDef = customFieldDefs.find(d => d.key === key)
    if (!fieldDef || !isFieldFilterable(fieldDef)) return null
    const filterValue = customFilterValues?.[key]
    return {
      options: filterChoicesFor(fieldDef, { customStates, members, rows: getFacetRows ? getFacetRows(key) : (allRows || negotiations) }),
      selected: Array.isArray(filterValue) ? filterValue : (filterValue ? [filterValue] : []),
      onChange: v => onFilterChange(key, v),
    }
  }

  return (
    <TableGrid
      rows={negotiations}
      rowKey={neg => neg.id}
      cols={cols}
      allColumns={allColumns}
      renderCell={(key, neg) => renderCell(key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members, refLists)}
      getColumnFilter={getColumnFilter}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      onColResize={onColResize}
      showCheckbox
      selectedIds={selectedIds}
      onToggleSelect={onToggleSelect}
      allVisibleSelected={allVisibleSelected}
      onToggleSelectAll={onToggleSelectAll}
      onSelectRow={onSelect}
      rowClassName={neg => neg.activity_status === 'paused' ? 'neg-row-paused' : neg.activity_status === 'inactive' ? 'neg-row-inactive' : ''}
      getNumber={neg => neg.display_number}
    />
  )
}
