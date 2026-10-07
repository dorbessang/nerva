import { useState } from 'react'
import { renderCardField } from '../renderCardField'
import '../../../components/CardGrid.css'
import '../../Negotiations.css'

export default function KanbanView({ negotiations, customStates, getStateConfig, getEntityName, getEntityFlag, onSelect, canEdit, onMove, cols, customFieldDefs, members, entityTypes, refLists }) {
  const [dragOverCol, setDragOverCol] = useState(null)
  // Mismos campos configurables que Tabla/Cards ("⚙ Vista"), product y status
  // van hardcodeados en el título de la card / la columna en la que cae.
  const visibleFields = cols.filter(c => c.visible && c.key !== 'product' && c.key !== 'status')

  return (
    <div className="neg-kanban-board">
      {customStates.map((state, colIdx) => {
        const colNegs = negotiations.filter(n => n.status === state.name)
        return (
          <div
            key={state.name}
            className={`neg-kanban-col ${dragOverCol === state.name ? 'drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOverCol(state.name) }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={e => {
              e.preventDefault()
              setDragOverCol(null)
              const negId = e.dataTransfer.getData('text/plain')
              if (negId) onMove(negId, state.name)
            }}
          >
            <div className="neg-kanban-col-header">
              <span className="neg-kanban-col-dot" style={{ backgroundColor: state.color || '#64748B' }} />
              {state.name}
              <span className="neg-kanban-col-count">{colNegs.length}</span>
            </div>
            <div className="neg-kanban-col-body">
              {colNegs.map(neg => {
                const actIcon = neg.activity_status === 'inactive' ? '💤' : neg.activity_status === 'paused' ? '⏸' : null
                return (
                  <div
                    key={neg.id}
                    className="neg-kanban-card"
                    draggable={canEdit}
                    onDragStart={e => e.dataTransfer.setData('text/plain', neg.id)}
                    onClick={() => onSelect(neg)}
                  >
                    <div className="neg-kanban-card-title">
                      <span className="card-tile-number">#{neg.display_number}</span>
                      {actIcon && <span className="neg-kanban-card-icon">{actIcon}</span>}
                      {neg.product || neg.title}
                    </div>
                    {visibleFields.map(c => renderCardField(c.key, neg, getStateConfig, getEntityName, getEntityFlag, customFieldDefs, members, entityTypes, refLists))}
                    {canEdit && (
                      <div className="neg-kanban-card-actions" onClick={e => e.stopPropagation()}>
                        {colIdx > 0 && (
                          <button title="Mover a la izquierda" onClick={() => onMove(neg.id, customStates[colIdx - 1].name)}>‹</button>
                        )}
                        {colIdx < customStates.length - 1 && (
                          <button title="Mover a la derecha" onClick={() => onMove(neg.id, customStates[colIdx + 1].name)}>›</button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {colNegs.length === 0 && <p className="neg-kanban-empty">Sin proyectos.</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
