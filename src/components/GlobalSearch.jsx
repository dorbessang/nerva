import { useState, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useCloseOnOutsideOrEscape } from '../lib/useCloseOnOutsideOrEscape'
import './GlobalSearch.css'

const MIN_CHARS = 2
const DEBOUNCE_MS = 300
const LIMIT = 5

function truncate(text, max) {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

// Igual que el fallback ya usado en Negotiations.jsx: si no hay primary_entity_id
// seteado, usa el primer proveedor vinculado.
function primaryEntityName(n) {
  return n.primary_entity?.name || n.negotiation_entities?.[0]?.entity?.name || null
}

// Subtítulo de contexto para una tarea/nota: si cuelga de un proyecto, el
// proyecto + su proveedor (para desambiguar proyectos homónimos); si cuelga
// directo de una entidad, el nombre de la entidad.
function contextLabel(item) {
  if (item.negotiation) {
    const title = item.negotiation.product || item.negotiation.title
    const entityName = primaryEntityName(item.negotiation)
    return entityName ? `${title} · ${entityName}` : title
  }
  if (item.entity) return item.entity.name
  return null
}

export default function GlobalSearch() {
  const { workspaceId, activeWorkspace } = useAuth()
  const navigate = useNavigate()
  const isPersonal = activeWorkspace?.type === 'personal'
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState({ negotiations: [], entities: [], tasks: [], notes: [] })
  const boxRef = useRef(null)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  const close = useCallback(() => { setOpen(false); setMobileOpen(false) }, [])
  useCloseOnOutsideOrEscape(boxRef, open || mobileOpen, close)

  useEffect(() => {
    if (mobileOpen) inputRef.current?.focus()
  }, [mobileOpen])

  // El valor de un .or() de PostgREST es una lista separada por comas, así
  // que una coma o paréntesis sueltos en lo que el usuario tipeó romperían
  // el filtro (o lo estirarían a condiciones no intencionadas). Envolver el
  // valor entre comillas dobles (con \ y " propias escapadas) neutraliza
  // esos caracteres — es la forma que PostgREST espera para un valor literal.
  function orValue(v) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }

  async function runSearch(q) {
    setLoading(true)
    const like = `%${q}%`
    const safeLike = orValue(like)

    if (isPersonal) {
      const [tasksRes, notesRes] = await Promise.all([
        supabase.from('tasks').select('id, title, status')
          .eq('workspace_id', workspaceId).is('negotiation_id', null).is('entity_id', null)
          .ilike('title', like).limit(LIMIT),
        supabase.from('negotiation_notes').select('id, content')
          .eq('workspace_id', workspaceId).is('negotiation_id', null).is('entity_id', null)
          .ilike('content', like).limit(LIMIT),
      ])
      setResults({
        negotiations: [], entities: [],
        tasks: tasksRes.data || [],
        notes: notesRes.data || [],
      })
      setLoading(false)
      return
    }

    const [negRes, entRes, taskRes, noteRes] = await Promise.all([
      supabase.from('negotiations')
        .select('id, product, title, primary_entity:primary_entity_id(name), negotiation_entities(entity:entity_id(name))')
        .eq('workspace_id', workspaceId)
        .or(`product.ilike.${safeLike},title.ilike.${safeLike}`).limit(LIMIT),
      supabase.from('entities').select('id, name, entity_type_id')
        .eq('workspace_id', workspaceId)
        .ilike('name', like).limit(LIMIT),
      supabase.from('tasks')
        .select(`
          id, title, negotiation_id, entity_id,
          negotiation:negotiation_id(id, product, title, primary_entity:primary_entity_id(name), negotiation_entities(entity:entity_id(name))),
          entity:entity_id(id, name, entity_type_id)
        `)
        .eq('workspace_id', workspaceId)
        .ilike('title', like).limit(LIMIT),
      supabase.from('negotiation_notes')
        .select(`
          id, content, negotiation_id, entity_id,
          negotiation:negotiation_id(id, product, title, primary_entity:primary_entity_id(name), negotiation_entities(entity:entity_id(name))),
          entity:entity_id(id, name, entity_type_id)
        `)
        .eq('workspace_id', workspaceId)
        .ilike('content', like).limit(LIMIT),
    ])

    setResults({
      negotiations: negRes.data || [],
      entities: entRes.data || [],
      tasks: taskRes.data || [],
      notes: noteRes.data || [],
    })
    setLoading(false)
  }

  function handleChange(e) {
    const value = e.target.value
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = value.trim()
    if (trimmed.length < MIN_CHARS) {
      setOpen(false)
      setResults({ negotiations: [], entities: [], tasks: [], notes: [] })
      return
    }
    setOpen(true)
    debounceRef.current = setTimeout(() => runSearch(trimmed), DEBOUNCE_MS)
  }

  function goTo(path) {
    setOpen(false)
    setQuery('')
    navigate(path)
  }

  function goToTask(task) {
    if (task.negotiation_id) return goTo(`/negotiations?openNeg=${task.negotiation_id}&openTask=${task.id}`)
    if (task.entity_id) return goTo(`/entities/${task.entity?.entity_type_id}?openEntity=${task.entity_id}`)
    return goTo(isPersonal ? '/agenda' : `/tasks?openTask=${task.id}`)
  }

  function goToNote(note) {
    if (note.negotiation_id) return goTo(`/negotiations?openNeg=${note.negotiation_id}`)
    if (note.entity_id) return goTo(`/entities/${note.entity?.entity_type_id}?openEntity=${note.entity_id}`)
    return goTo('/agenda')
  }

  const hasResults = results.negotiations.length || results.entities.length || results.tasks.length || results.notes.length

  return (
    <div className={`global-search ${mobileOpen ? 'is-mobile-open' : ''}`} ref={boxRef}>
      <button
        type="button"
        className="global-search-mobile-btn"
        aria-label="Buscar"
        onClick={() => setMobileOpen(o => !o)}
      >
        <Search size={16} strokeWidth={1.8} />
      </button>
      <Search className="global-search-icon" size={14} strokeWidth={1.8} />
      <input
        ref={inputRef}
        className="global-search-input"
        type="text"
        placeholder={isPersonal ? 'Buscar tareas o notas…' : 'Buscar proyectos, entidades, tareas…'}
        value={query}
        onChange={handleChange}
        onFocus={() => { if (query.trim().length >= MIN_CHARS) setOpen(true) }}
      />
      {open && (
        <div className="global-search-panel">
          {loading && <div className="global-search-empty">Buscando…</div>}
          {!loading && !hasResults && <div className="global-search-empty">Sin resultados para "{query.trim()}"</div>}
          {!loading && hasResults && (
            <>
              {results.negotiations.length > 0 && (
                <div className="global-search-group">
                  <div className="global-search-group-label">Proyectos</div>
                  {results.negotiations.map(n => (
                    <button key={n.id} className="global-search-item" onClick={() => goTo(`/negotiations?openNeg=${n.id}`)}>
                      <span className="global-search-item-note">{n.product || n.title}</span>
                      {primaryEntityName(n) && (
                        <span className="global-search-item-sub">con {primaryEntityName(n)}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {results.entities.length > 0 && (
                <div className="global-search-group">
                  <div className="global-search-group-label">Entidades</div>
                  {results.entities.map(e => (
                    <button key={e.id} className="global-search-item" onClick={() => goTo(`/entities/${e.entity_type_id}?openEntity=${e.id}`)}>
                      {e.name}
                    </button>
                  ))}
                </div>
              )}
              {results.tasks.length > 0 && (
                <div className="global-search-group">
                  <div className="global-search-group-label">Tareas</div>
                  {results.tasks.map(t => (
                    <button key={t.id} className="global-search-item" onClick={() => goToTask(t)}>
                      <span className="global-search-item-note">{t.title}</span>
                      {contextLabel(t) && (
                        <span className="global-search-item-sub">en {contextLabel(t)}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {results.notes.length > 0 && (
                <div className="global-search-group">
                  <div className="global-search-group-label">Notas</div>
                  {results.notes.map(n => (
                    <button key={n.id} className="global-search-item" onClick={() => goToNote(n)}>
                      <span className="global-search-item-note">{truncate(n.content, 70)}</span>
                      {contextLabel(n) && (
                        <span className="global-search-item-sub">en {contextLabel(n)}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
