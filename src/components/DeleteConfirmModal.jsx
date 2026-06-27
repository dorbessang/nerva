import { useState } from 'react'
import './DeleteConfirmModal.css'

export default function DeleteConfirmModal({ itemName, itemType = 'elemento', onConfirm, onCancel }) {
  const [typed, setTyped] = useState('')
  const matches = typed === itemName

  function handleKeyDown(e) {
    if (e.key === 'Enter' && matches) onConfirm()
    if (e.key === 'Escape') onCancel()
  }

  return (
    <div className="dcm-overlay" onClick={onCancel}>
      <div className="dcm-card" onClick={e => e.stopPropagation()}>
        <div className="dcm-icon">⚠️</div>
        <h2 className="dcm-title">Eliminar {itemType}</h2>
        <p className="dcm-body">
          Esta acción es <strong>irreversible</strong>. Se perderá todo el historial,
          notas y tareas asociadas.
        </p>
        <p className="dcm-body">
          Para confirmar, escribí el nombre exacto:
        </p>
        <div className="dcm-name-display">{itemName}</div>
        <input
          className="dcm-input"
          type="text"
          value={typed}
          onChange={e => setTyped(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Escribí "${itemName}"`}
          autoFocus
          autoComplete="off"
        />
        <div className="dcm-actions">
          <button className="dcm-btn-cancel" onClick={onCancel}>Cancelar</button>
          <button
            className="dcm-btn-confirm"
            onClick={onConfirm}
            disabled={!matches}
          >
            Sí, eliminar {itemType}
          </button>
        </div>
      </div>
    </div>
  )
}
