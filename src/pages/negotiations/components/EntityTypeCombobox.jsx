import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { entityHasType } from '../../../lib/entityTypes'
import { matchEntity } from '../../../lib/entityMatching'
import '../../Negotiations.css'

export default function EntityTypeCombobox({ entityType, allEntities, workspaceId, value, onSelect, onEntityUpserted }) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [resolving, setResolving] = useState(null) // { name, exact, fuzzy }
  const [saving, setSaving] = useState(false)

  const selected = allEntities.find(e => e.id === value)
  const optionsOfType = allEntities.filter(e => entityHasType(e, entityType.id) && e.id !== value)
  const matching = optionsOfType.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
  const hasExactMatch = optionsOfType.some(e => e.name.toLowerCase() === search.trim().toLowerCase())

  async function createNew(name) {
    setSaving(true)
    const { data, error } = await supabase.from('entities')
      .insert({ workspace_id: workspaceId, name: name.trim(), entity_type_id: entityType.id, status: 'active', needs_review: true })
      .select('*').single()
    setSaving(false)
    if (error) { console.error('createEntityQuick error:', error.message); return }
    onEntityUpserted(data)
    onSelect(data.id)
    setSearch('')
    setOpen(false)
    setResolving(null)
  }

  async function selectExistingEntity(entity, addAsSecondary) {
    if (addAsSecondary && !entity.secondary_entity_type_id && entity.entity_type_id !== entityType.id) {
      const { error } = await supabase.from('entities').update({ secondary_entity_type_id: entityType.id }).eq('id', entity.id)
      if (!error) onEntityUpserted({ ...entity, secondary_entity_type_id: entityType.id })
    }
    onSelect(entity.id)
    setSearch('')
    setOpen(false)
    setResolving(null)
  }

  function startCreate(name) {
    const { exact, fuzzy } = matchEntity(name, allEntities, e => e.name)
    if (exact || fuzzy.length > 0) { setResolving({ name, exact, fuzzy }); return }
    createNew(name)
  }

  return (
    <div className="entity-combobox">
      {selected && (
        <div className="entity-combobox-selected">
          <span className="entity-combobox-selected-name">✓ {selected.name}</span>
          <button type="button" className="entity-combobox-clear" onMouseDown={() => onSelect('')} title="Quitar">✕</button>
        </div>
      )}
      <input
        type="text"
        className="entity-search-input"
        placeholder={selected ? 'Cambiar...' : 'Buscar o crear...'}
        value={search}
        autoComplete="off"
        onChange={e => setSearch(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="entity-dropdown">
          <div className="entity-dropdown-option" onMouseDown={() => { onSelect(''); setSearch(''); setOpen(false) }}>Sin asignar</div>
          {matching.slice(0, 6).map(e => (
            <div key={e.id} className="entity-dropdown-option" onMouseDown={() => { onSelect(e.id); setSearch(''); setOpen(false) }}>
              {e.name}
            </div>
          ))}
          {matching.length === 0 && !search && (
            <div className="entity-dropdown-empty">Sin más opciones de este tipo</div>
          )}
          {search.trim() && !hasExactMatch && (
            <div className="entity-dropdown-option entity-dropdown-option--create" onMouseDown={() => startCreate(search.trim())}>
              + Crear "{search.trim()}"
            </div>
          )}
        </div>
      )}
      {resolving && (
        <div className="quick-create-resolver">
          <p className="quick-create-resolver-title">
            {resolving.exact ? `Ya existe "${resolving.exact.name}"` : 'Encontramos algo parecido:'}
          </p>
          {[...(resolving.exact ? [resolving.exact] : []), ...resolving.fuzzy.map(f => f.candidate)].map(candidate => (
            <button key={candidate.id} type="button" className="quick-create-resolver-option" onClick={() => selectExistingEntity(candidate, candidate.entity_type_id !== entityType.id)}>
              {candidate.entity_type_id === entityType.id
                ? `Usar "${candidate.name}"`
                : `Usar "${candidate.name}" + agregarle ${entityType.name} como tipo secundario`}
            </button>
          ))}
          <button type="button" className="quick-create-resolver-option" onClick={() => createNew(resolving.name)} disabled={saving}>
            Crear "{resolving.name}" de todos modos
          </button>
          <button type="button" className="quick-create-resolver-cancel" onClick={() => setResolving(null)}>Cancelar</button>
        </div>
      )}
    </div>
  )
}
