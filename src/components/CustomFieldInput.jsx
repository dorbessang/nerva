// Widget de edición para un campo custom — el tipo (o `underlying_type` si
// es un campo "con seguimiento") define qué se renderiza, el label es
// puramente decorativo y lo define el workspace.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import CountrySelector, { getAllCountries, getCountryName } from './CountrySelector'
import { renderCustomFieldDisplay, filterChoicesFor, isMultiValueFilter } from '../lib/customFields'

function CountryMultiSelect({ value, onChange }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = Array.isArray(value) ? value : []
  const countries = getAllCountries()
  const filtered = (query
    ? countries.filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
    : countries.filter(c => !selected.includes(c.code))
  ).slice(0, 8)

  function add(code) {
    if (!selected.includes(code)) onChange([...selected, code])
    setQuery('')
    setOpen(false)
  }
  function remove(code) {
    onChange(selected.filter(c => c !== code))
  }

  return (
    <div className="cf-country-multi">
      {selected.length > 0 && (
        <div className="cf-country-chips">
          {selected.map(code => (
            <span key={code} className="neg-chip neg-chip-green">
              {getCountryName(code)}
              <button type="button" className="cf-chip-remove" onClick={() => remove(code)}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="cf-country-combobox">
        <input
          type="text"
          placeholder="Buscar y agregar país..."
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && filtered.length > 0 && (
          <div className="country-dropdown">
            <div className="country-list">
              {filtered.map(c => (
                <div key={c.code} className="country-option" onMouseDown={e => { e.preventDefault(); add(c.code) }}>
                  <span>{c.name}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function useWorkspaceMembers() {
  const { workspaceId } = useAuth()
  const [members, setMembers] = useState([])
  useEffect(() => {
    if (!workspaceId) return
    supabase
      .from('workspace_members')
      .select('user_id, profile:user_id ( full_name )')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .then(({ data }) => setMembers(data || []))
  }, [workspaceId])
  return members
}

function UserMultiSelect({ value, onChange }) {
  const members = useWorkspaceMembers()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = Array.isArray(value) ? value : []
  const name = m => m.profile?.full_name || 'Usuario'
  const filtered = members
    .filter(m => !selected.includes(m.user_id))
    .filter(m => name(m).toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8)

  function add(userId) {
    if (!selected.includes(userId)) onChange([...selected, userId])
    setQuery('')
    setOpen(false)
  }
  function remove(userId) {
    onChange(selected.filter(id => id !== userId))
  }

  return (
    <div className="cf-country-multi">
      {selected.length > 0 && (
        <div className="cf-country-chips">
          {selected.map(userId => (
            <span key={userId} className="neg-chip neg-chip-blue">
              {members.find(m => m.user_id === userId)?.profile?.full_name || 'Usuario'}
              <button type="button" className="cf-chip-remove" onClick={() => remove(userId)}>✕</button>
            </span>
          ))}
        </div>
      )}
      <div className="cf-country-combobox">
        <input
          type="text"
          placeholder="Buscar y agregar participante..."
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && filtered.length > 0 && (
          <div className="country-dropdown">
            <div className="country-list">
              {filtered.map(m => (
                <div key={m.user_id} className="country-option" onMouseDown={e => { e.preventDefault(); add(m.user_id) }}>
                  <span>{name(m)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function UserFieldSelect({ value, onChange }) {
  const members = useWorkspaceMembers()
  return (
    <select className="neg-select" value={value || ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">—</option>
      {members.map(m => <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || 'Usuario'}</option>)}
    </select>
  )
}

export function CustomFieldInput({ def, value, onChange }) {
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type
  const choices = def.options?.choices || []

  if (type === 'textarea') {
    return <textarea rows={3} value={value || ''} onChange={e => onChange(e.target.value)} />
  }
  if (type === 'number') {
    return <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  }
  if (type === 'date') {
    return <input type="date" value={value || ''} onChange={e => onChange(e.target.value || null)} />
  }
  if (type === 'boolean') {
    return <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
  }
  if (type === 'select') {
    return (
      <select className="neg-select" value={value || ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">—</option>
        {choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    )
  }
  if (type === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    function toggle(id) {
      onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
    }
    return (
      <div className="cf-multiselect">
        {choices.map(c => (
          <label key={c.id} className="cf-multiselect-option">
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.label}
          </label>
        ))}
      </div>
    )
  }
  if (type === 'country') {
    if (def.options?.multiple) return <CountryMultiSelect value={value} onChange={onChange} />
    return <CountrySelector value={value || ''} onChange={onChange} />
  }
  if (type === 'user') {
    if (def.options?.multiple) return <UserMultiSelect value={value} onChange={onChange} />
    return <UserFieldSelect value={value} onChange={onChange} />
  }
  if (type === 'link') {
    return <input type="url" value={value || ''} onChange={e => onChange(e.target.value)} placeholder="https://..." />
  }
  if (type === 'email') {
    return <input type="email" value={value || ''} onChange={e => onChange(e.target.value)} placeholder="nombre@empresa.com" />
  }
  if (type === 'phone') {
    return <input type="tel" value={value || ''} onChange={e => onChange(e.target.value)} placeholder="+54 11 1234-5678" />
  }
  return <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} />
}

// Render de solo lectura de un campo custom (detalle de proyecto/entidad) —
// mismo texto que renderCustomFieldDisplay, pero link/email/teléfono salen
// clickeables (mismo patrón que ya usan los Contactos de una entidad).
// Widget de filtro para toolbars (Proyectos/Entidades) — un <select> con
// las opciones que correspondan al tipo (choices configurados, estados,
// países, miembros del workspace, o Sí/No), múltiple si el campo lo es.
export function CustomFieldFilter({ def, value, onChange, customStates, members }) {
  const choices = filterChoicesFor(def, { customStates, members })
  if (isMultiValueFilter(def)) {
    const selected = Array.isArray(value) ? value : []
    return (
      <select
        className="neg-select"
        multiple
        value={selected}
        onChange={e => onChange(Array.from(e.target.selectedOptions).map(o => o.value))}
      >
        {choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    )
  }
  return (
    <select className="neg-select" value={value || ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">Todos</option>
      {choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
    </select>
  )
}

export function CustomFieldReadOnly({ def, value: rawValue, members }) {
  const text = renderCustomFieldDisplay(def, rawValue, members)
  if (text === '—') return <>{text}</>
  if (def.field_type === 'link') return <a href={rawValue} target="_blank" rel="noreferrer">{rawValue}</a>
  if (def.field_type === 'email') return <a href={`mailto:${rawValue}`}>{rawValue}</a>
  if (def.field_type === 'phone') return <a href={`tel:${rawValue}`}>{rawValue}</a>
  return <>{text}</>
}
