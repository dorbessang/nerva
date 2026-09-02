// Widget de edición para un campo custom — el tipo (o `underlying_type` si
// es un campo "con seguimiento") define qué se renderiza, el label es
// puramente decorativo y lo define el workspace.

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { isPrivileged } from '../lib/roles'
import CountrySelector, { getAllCountries, getCountryName } from './CountrySelector'
import { renderCustomFieldDisplay } from '../lib/customFields'

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

// Roster de "personas sin cuenta" del workspace (gente del equipo que no
// usa Nerva pero se quiere poder marcar como participante de un proyecto).
// `bump` fuerza un refetch después de crear una nueva.
function useWorkspaceNamedParticipants() {
  const { workspaceId } = useAuth()
  const [named, setNamed] = useState([])
  const [bump, setBump] = useState(0)
  useEffect(() => {
    if (!workspaceId) return
    supabase
      .from('workspace_named_participants')
      .select('id, name')
      .eq('workspace_id', workspaceId)
      .order('name')
      .then(({ data }) => setNamed(data || []))
  }, [workspaceId, bump])
  return [named, () => setBump(b => b + 1)]
}

// `allowNamedParticipants` solo se prende para el campo "Participantes"
// (storage_column fijo) — no para cualquier campo custom tipo usuario que
// un workspace arme por su cuenta, donde no necesariamente tiene sentido
// mezclar gente sin cuenta.
function UserMultiSelect({ value, onChange, allowNamedParticipants }) {
  const members = useWorkspaceMembers()
  const { workspaceId, user, effectiveRole } = useAuth()
  const [namedParticipants, refetchNamed] = useWorkspaceNamedParticipants()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const selected = Array.isArray(value) ? value : []
  const canCreateNamed = allowNamedParticipants && isPrivileged(effectiveRole)
  const name = m => m.profile?.full_name || 'Usuario'

  const memberOptions = members
    .filter(m => !selected.includes(m.user_id))
    .filter(m => name(m).toLowerCase().includes(query.toLowerCase()))
    .map(m => ({ id: m.user_id, label: name(m), hasAccount: true }))
  const namedOptions = allowNamedParticipants
    ? namedParticipants
      .filter(np => !selected.includes(np.id))
      .filter(np => np.name.toLowerCase().includes(query.toLowerCase()))
      .map(np => ({ id: np.id, label: np.name, hasAccount: false }))
    : []
  const options = [...memberOptions, ...namedOptions].slice(0, 8)
  const queryTrimmed = query.trim().toLowerCase()
  const hasExactMatch = [...members.map(name), ...namedParticipants.map(np => np.name)]
    .some(n => n.toLowerCase() === queryTrimmed)

  function add(id) {
    if (!selected.includes(id)) onChange([...selected, id])
    setQuery('')
    setOpen(false)
  }
  function remove(id) {
    onChange(selected.filter(x => x !== id))
  }
  function resolve(id) {
    const m = members.find(m => m.user_id === id)
    if (m) return { label: name(m), hasAccount: true }
    const np = namedParticipants.find(np => np.id === id)
    if (np) return { label: np.name, hasAccount: false }
    return { label: 'Usuario', hasAccount: true }
  }
  async function createNamed() {
    const trimmed = query.trim()
    if (!trimmed) return
    setCreating(true)
    const { data, error } = await supabase.from('workspace_named_participants')
      .insert({ workspace_id: workspaceId, name: trimmed, created_by: user?.id })
      .select('id, name').single()
    setCreating(false)
    if (error) { console.error('createNamedParticipant error:', error.message); return }
    refetchNamed()
    add(data.id)
  }

  return (
    <div className="cf-country-multi">
      {selected.length > 0 && (
        <div className="cf-country-chips">
          {selected.map(id => {
            const r = resolve(id)
            return (
              <span key={id} className={`neg-chip neg-chip-blue ${!r.hasAccount ? 'neg-chip-dashed' : ''}`}>
                {r.label}{!r.hasAccount ? ' · sin cuenta' : ''}
                <button type="button" className="cf-chip-remove" onClick={() => remove(id)}>✕</button>
              </span>
            )
          })}
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
        {open && (options.length > 0 || (canCreateNamed && queryTrimmed && !hasExactMatch)) && (
          <div className="country-dropdown">
            <div className="country-list">
              {options.map(o => (
                <div key={o.id} className="country-option" onMouseDown={e => { e.preventDefault(); add(o.id) }}>
                  <span>{o.label}{!o.hasAccount ? ' · sin cuenta' : ''}</span>
                </div>
              ))}
              {canCreateNamed && queryTrimmed && !hasExactMatch && (
                <div className="country-option" onMouseDown={e => { e.preventDefault(); createNamed() }}>
                  <span>{creating ? 'Creando...' : `+ Crear "${query.trim()}" (sin cuenta)`}</span>
                </div>
              )}
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
    if (def.options?.multiple) return <UserMultiSelect value={value} onChange={onChange} allowNamedParticipants={def.storage_column === 'participants'} />
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
// Valida que un valor de campo tipo "link" sea un http(s) real antes de
// usarlo como href — si no trae esquema (ej. "gmail.com", lo más común al
// tipear a mano) se le agrega https:// solo; si trae un esquema explícito
// que no sea http/https (ej. "javascript:...") se descarta, se muestra como
// texto plano. Sin esto, cualquiera con permiso de edición podía cargar un
// link trampa que se ejecutara al clickearlo.
function safeLinkHref(raw) {
  if (!raw) return null
  const trimmed = String(raw).trim()
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  const candidate = hasScheme ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.href
  } catch {
    return null
  }
}

// mismo texto que renderCustomFieldDisplay, pero link/email/teléfono salen
// clickeables (mismo patrón que ya usan los Contactos de una entidad).
export function CustomFieldReadOnly({ def, value: rawValue, members }) {
  const text = renderCustomFieldDisplay(def, rawValue, members)
  if (text === '—') return <>{text}</>
  if (def.field_type === 'link') {
    const href = safeLinkHref(rawValue)
    return href ? <a href={href} target="_blank" rel="noreferrer">{rawValue}</a> : <>{text}</>
  }
  if (def.field_type === 'email') return <a href={`mailto:${rawValue}`}>{rawValue}</a>
  if (def.field_type === 'phone') return <a href={`tel:${rawValue}`}>{rawValue}</a>
  return <>{text}</>
}
