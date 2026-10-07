import { getCustomFieldValue, renderCustomFieldDisplay, resolveMemberNames } from '../../lib/customFields'
import { getProductName, getEntitiesOfType } from './helpers'
import '../../components/CustomFieldInput.css'
import '../Negotiations.css'

// Usada por CardsView (mosaico) y KanbanView — separada de ambos componentes
// en su propio módulo para que ninguno de los dos mezcle export de
// componente + export de función (rompe el fast-refresh de Vite).
export function renderCardField(key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members, entityTypes, refLists) {
  if (key.startsWith('entity_type:')) {
    const typeId = key.slice('entity_type:'.length)
    const ents = getEntitiesOfType(neg, typeId)
    if (ents.length === 0) return null
    const typeLabel = entityTypes?.find(et => et.id === typeId)?.name
    return (
      <div key={key} className="neg-card-entity">
        {typeLabel && <span className="neg-card-entity-type">{typeLabel}:</span>}
        {ents[0].country_code && <img src={`https://flagcdn.com/w20/${ents[0].country_code.toLowerCase()}.png`} alt="" className="neg-flag" />}
        {ents.map(e => e.name).join(', ')}
      </div>
    )
  }
  switch (key) {
    case 'products': {
      const name = getProductName(neg)
      if (name === '—') return null
      return <div key={key} className="neg-card-entity">{name}</div>
    }
    case 'participants': {
      const names = resolveMemberNames(members, neg.participants)
      if (!names.length) return null
      return (
        <div key={key} className="neg-chips neg-card-field">
          {names.slice(0, 2).map(n => <span key={n} className="neg-chip neg-chip-blue">{n}</span>)}
          {names.length > 2 && <span className="neg-chip neg-chip-gray">+{names.length - 2}</span>}
        </div>
      )
    }
    case 'target_date':
      if (!neg.target_date) return null
      return <div key={key} className="neg-card-date neg-card-field">{neg.target_date}</div>
    case 'notes': {
      const list = neg.notes_list || []
      if (!list.length) return null
      const preview = list.map(n => `${new Date(n.note_date + 'T00:00:00').toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit' })}: ${n.content}`).join(' · ')
      return <div key={key} className="neg-card-text neg-card-field">{preview}</div>
    }
    case 'description':
      if (!neg.description) return null
      return <div key={key} className="neg-card-text neg-card-field">{neg.description}</div>
    case 'observations':
      if (!neg.observations) return null
      return <div key={key} className="neg-card-text neg-card-field">{neg.observations}</div>
    case 'activity_status': {
      const map = { active: 'En curso', paused: '⏸ Pausado', inactive: '💤 Inactivo' }
      return <div key={key} className="neg-card-field"><span className="neg-nda-badge">{map[neg.activity_status] || '—'}</span></div>
    }
    case 'last_activity_at': {
      if (!neg.last_activity_at) return null
      const days = Math.floor((Date.now() - new Date(neg.last_activity_at)) / 86400000)
      const label = days === 0 ? 'hoy' : days === 1 ? 'ayer' : `hace ${days}d`
      return <div key={key} className="neg-card-date neg-card-field">{label}</div>
    }
    default: {
      const def = customFieldDefs?.find(d => d.key === key)
      if (!def) return null
      const rendered = renderCustomFieldDisplay(def, getCustomFieldValue(neg.custom_fields, key), members, refLists)
      if (rendered === '—') return null
      return <div key={key} className="neg-card-text neg-card-field">{rendered}</div>
    }
  }
}
