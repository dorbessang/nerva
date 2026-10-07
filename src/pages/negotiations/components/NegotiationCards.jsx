import { CardGrid, CardTile } from '../../../components/CardGrid'
import { renderCardField } from '../renderCardField'
import StatusDaysBadge from './StatusDaysBadge'
import '../../Negotiations.css'

export default function CardsView({ negotiations, getStateConfig, getEntityName, getEntityFlag, onSelect, cols, customFieldDefs, members, selectedIds, onToggleSelect, entityTypes, refLists }) {
  // Columnas visibles excluyendo product y status (que van hardcodeados en el header)
  const visibleFields = cols.filter(c => c.visible && c.key !== 'product' && c.key !== 'status')

  return (
    <CardGrid>
      {negotiations.map(neg => {
        const cfg = getStateConfig(neg.status)
        const actIcon = neg.activity_status === 'inactive' ? '💤' : neg.activity_status === 'paused' ? '⏸' : null
        const cardClass = neg.activity_status === 'paused' ? 'card-tile-paused' : neg.activity_status === 'inactive' ? 'card-tile-inactive' : ''
        const title = neg.product || neg.title
        const fields = visibleFields.map(c => renderCardField(c.key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members, entityTypes, refLists)).filter(Boolean)
        return (
          <CardTile
            key={neg.id}
            avatarLabel={title}
            title={title}
            titlePrefix={<>
              <span className="card-tile-number">#{neg.display_number}</span>
              {actIcon && <span className={`neg-paused-icon ${neg.activity_status === 'inactive' ? 'neg-icon-inactive' : 'neg-icon-paused'}`}>{actIcon}</span>}
            </>}
            headerRight={<>
              <span className="neg-status-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span>
              <StatusDaysBadge neg={neg} />
            </>}
            footer={fields.length > 0 ? fields : null}
            selected={selectedIds.has(neg.id)}
            showCheckbox
            onToggleSelect={() => onToggleSelect(neg.id)}
            onClick={() => onSelect(neg)}
            className={cardClass}
          />
        )
      })}
    </CardGrid>
  )
}
