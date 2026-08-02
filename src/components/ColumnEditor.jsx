import { useState, useEffect } from 'react'

// Preferencias de columnas visibles/orden por usuario — compartido entre
// Proyectos y Entidades. `staticColumns` son las que no son un campo custom
// (calculadas o legacy, ver ALL_COLUMNS en Negotiations.jsx); `customFieldDefs`
// se mergea encima y siempre tiene prioridad de label sobre `staticColumns`
// para que un campo renombrado en Settings nunca quede "tapado" por un label
// viejo hardcodeado (bug real que hubo en Proyectos, ver CHANGELOG).
export function useColumnPrefs({ storageKey, staticColumns, defaultVisible, customFieldDefs }) {
  const [cols, setCols] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) return JSON.parse(saved)
    } catch {}
    return staticColumns.map(c => ({ key: c.key, visible: defaultVisible.includes(c.key) }))
  })

  // Mergea cualquier columna que falte en las prefs guardadas — tanto las
  // estáticas como los campos custom fetcheados del workspace (que llegan
  // async, después del primer render). Las que están en `defaultVisible`
  // arrancan visibles, para que un workspace nuevo no vea la tabla vacía.
  useEffect(() => {
    const allKnown = [...staticColumns, ...customFieldDefs.map(d => ({ key: d.key }))]
    setCols(prev => {
      const known = new Set(prev.map(c => c.key))
      const missing = allKnown.filter(c => !known.has(c.key)).map(c => ({ key: c.key, visible: defaultVisible.includes(c.key) }))
      return missing.length > 0 ? [...prev, ...missing] : prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customFieldDefs])

  function saveCols(newCols) {
    setCols(newCols)
    localStorage.setItem(storageKey, JSON.stringify(newCols))
  }

  return [cols, saveCols]
}

export function ColumnEditor({ cols, allColumns, onChange, onClose }) {
  const [dragSrc, setDragSrc] = useState(null)
  const [dragOver, setDragOver] = useState(null)

  function toggleVisible(key) {
    const col = allColumns.find(c => c.key === key)
    if (col?.alwaysVisible) return
    onChange(cols.map(c => c.key === key ? { ...c, visible: !c.visible } : c))
  }

  function handleDragStart(e, idx) {
    setDragSrc(idx)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e, idx) {
    e.preventDefault()
    setDragOver(idx)
  }

  function handleDrop(idx) {
    if (dragSrc === null || dragSrc === idx) { setDragSrc(null); setDragOver(null); return }
    const next = [...cols]
    const [moved] = next.splice(dragSrc, 1)
    next.splice(idx, 0, moved)
    onChange(next)
    setDragSrc(null)
    setDragOver(null)
  }

  return (
    <div className="col-editor">
      <div className="col-editor-header">
        <span className="col-editor-title">Campos visibles</span>
        <span className="col-editor-hint">Arrastrá para reordenar · Clic para mostrar/ocultar · Aplica a las 3 vistas</span>
        <button className="col-editor-close" onClick={onClose}>✕</button>
      </div>
      <div className="col-editor-list">
        {cols.map((c, idx) => {
          const def = allColumns.find(x => x.key === c.key)
          if (!def) return null
          return (
            <div
              key={c.key}
              className={`col-editor-item ${dragOver === idx ? 'drag-over' : ''} ${!c.visible ? 'hidden' : ''}`}
              draggable
              onDragStart={e => handleDragStart(e, idx)}
              onDragOver={e => handleDragOver(e, idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={() => { setDragSrc(null); setDragOver(null) }}
            >
              <span className="col-drag-handle">⠿</span>
              <input
                type="checkbox"
                checked={c.visible}
                onChange={() => toggleVisible(c.key)}
                disabled={def.alwaysVisible}
              />
              <span className="col-editor-label">{def.label}</span>
              {def.alwaysVisible && <span className="col-always">siempre</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
