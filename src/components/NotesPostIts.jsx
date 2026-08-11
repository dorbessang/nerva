import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { logActivity } from '../lib/activity'
import { notifyMentioned } from '../lib/notifications'
// Reusa las clases .neg-note-*/.neg-add-task-btn/.detail-empty/.mention-*
// ya definidas en Negotiations.css — ese archivo queda cargado
// globalmente en cualquier página que importe algo de Negotiations.jsx
// (incluida Entities.jsx).

const NOTE_COLORS = [
  { bg: '#fef08a', border: '#fde047', date: '#854d0e' },
  { bg: '#bfdbfe', border: '#93c5fd', date: '#1e40af' },
  { bg: '#bbf7d0', border: '#86efac', date: '#166534' },
  { bg: '#fecdd3', border: '#fda4af', date: '#9f1239' },
]

// Busca el "@algo" que queda pegado al cursor, si lo hay — dispara el
// autocompletado de menciones mientras se sigue tipeando ese nombre.
function caretMentionQuery(text, caret) {
  const upToCaret = text.slice(0, caret)
  const match = upToCaret.match(/@([^\s@]*)$/)
  return match ? match[1] : null
}

// Reemplaza el "@algo" en curso por "@Nombre Completo " y devuelve dónde
// queda el cursor después de insertarlo.
function applyMention(text, caret, fullName) {
  const upToCaret = text.slice(0, caret)
  const at = upToCaret.lastIndexOf('@')
  const before = text.slice(0, at)
  const after = text.slice(caret)
  const inserted = `@${fullName} `
  return { text: before + inserted + after, caret: (before + inserted).length }
}

// A quién menciona el texto final — matchea por nombre completo literal
// contra los miembros del workspace (no hay @user_id embebido, es texto
// plano legible), evitando falsos positivos de nombres que son substring
// de otros más largos.
function extractMentionedUserIds(text, members) {
  const sorted = [...members].sort((a, b) => (b.name?.length || 0) - (a.name?.length || 0))
  const ids = new Set()
  let remaining = text
  for (const m of sorted) {
    if (!m.name) continue
    if (remaining.includes(`@${m.name}`)) {
      ids.add(m.user_id)
      remaining = remaining.split(`@${m.name}`).join('')
    }
  }
  return [...ids]
}

// Notas tipo post-it, reusadas en el detalle de proyecto, el de entidad, y
// como notepad suelto del workspace personal — se filtran/insertan por
// negotiationId, por entityId, o si no se pasa ninguno de los dos, quedan
// sueltas (solo scoped por workspaceId). `contextLabel` es el nombre del
// proyecto/entidad (si aplica), solo para el texto de la notificación de
// @mención.
//
// `page` (solo tiene sentido junto con negotiationId) filtra/asigna en qué
// "página" del proyecto vive cada nota. '__log__' es un valor especial que
// significa "el renglón cronológico de la Bitácora en sí" (page NULL en la
// base) — no un post-it, es el registro que se escribe ahí mismo. Cualquier
// otro valor ('bitacora', 'financiero', 'tareas', 'documentos') es un post-it
// FIJADO a esa página (page = ese valor literal en la base) — un recordatorio
// que se ve aparte, no un renglón más del log. Antes 'bitacora' colapsaba a
// NULL y se mezclaba con el log; ahora queda su propio valor para poder
// separarlos en el render. `variant` cambia el renderizado: 'postit'
// (default, el collage de siempre) o 'timeline' (lista cronológica prolija,
// usada por la Bitácora — mismo dato, sin la estética de post-it).
// `hideComposer` oculta el input de alta (las notas con página se crean
// desde el modal de Editar del proyecto, no inline en cada tab — salvo el
// log de Bitácora, '__log__', que sí se carga inline ahí mismo).
export default function NotesPostIts({ negotiationId, entityId, workspaceId, canEdit, onChanged, contextLabel, page, variant = 'postit', hideComposer = false }) {
  const { user, profile } = useAuth()
  const [notes, setNotes] = useState([])
  const [newNote, setNewNote] = useState('')
  const [newNoteDate, setNewNoteDate] = useState(new Date().toISOString().split('T')[0])
  const [savingNote, setSavingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [members, setMembers] = useState([])
  const [mention, setMention] = useState(null) // { field: 'new'|'edit', items: [...] }

  const newNoteInputRef = useRef(null)
  const editTextareaRef = useRef(null)

  useEffect(() => { fetchNotes() }, [negotiationId, entityId, page])
  useEffect(() => { fetchMembers() }, [workspaceId])

  async function fetchNotes() {
    let query = supabase.from('negotiation_notes').select('*')
    if (negotiationId) {
      query = query.eq('negotiation_id', negotiationId)
      if (page) query = page === '__log__' ? query.is('page', null) : query.eq('page', page)
    } else if (entityId) {
      query = query.eq('entity_id', entityId)
    } else {
      query = query.is('negotiation_id', null).is('entity_id', null).eq('workspace_id', workspaceId)
    }
    query = query.order('note_date', { ascending: variant !== 'timeline' })
    const { data, error } = await query
    if (error) console.error('fetchNotes error:', error.message)
    if (data) setNotes(data)
  }

  async function fetchMembers() {
    if (!workspaceId) return
    const { data } = await supabase.from('workspace_members')
      .select('user_id, profile:user_id ( full_name )')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
    setMembers((data || [])
      .filter(m => m.user_id !== user?.id)
      .map(m => ({ user_id: m.user_id, name: m.profile?.full_name })))
  }

  function handleFieldChange(field, value, caret) {
    if (field === 'new') setNewNote(value)
    else setEditingNoteText(value)

    const query = caretMentionQuery(value, caret)
    if (query === null || members.length === 0) { setMention(null); return }
    const items = members.filter(m => m.name?.toLowerCase().includes(query.toLowerCase()))
    setMention(items.length > 0 ? { field, items } : null)
  }

  function selectMention(member) {
    const isNew = mention.field === 'new'
    const ref = isNew ? newNoteInputRef.current : editTextareaRef.current
    const value = isNew ? newNote : editingNoteText
    const { text, caret } = applyMention(value, ref.selectionStart, member.name)
    if (isNew) setNewNote(text)
    else setEditingNoteText(text)
    setMention(null)
    requestAnimationFrame(() => { ref.focus(); ref.setSelectionRange(caret, caret) })
  }

  async function notifyNoteMentions(content, previousContent) {
    if (members.length === 0) return
    const before = previousContent ? extractMentionedUserIds(previousContent, members) : []
    const after = extractMentionedUserIds(content, members)
    const newlyMentioned = after.filter(id => !before.includes(id))
    if (newlyMentioned.length === 0) return
    await notifyMentioned(supabase, {
      workspaceId, mentionedUserIds: newlyMentioned, actorId: user?.id,
      actorName: profile?.full_name, negotiationId, entityId, contextLabel,
    })
  }

  async function handleAddNote() {
    if (!newNote.trim()) return
    setSavingNote(true)
    const content = newNote.trim()
    const { data, error } = await supabase.from('negotiation_notes').insert({
      negotiation_id: negotiationId || null,
      entity_id: entityId || null,
      workspace_id: workspaceId,
      content,
      note_date: newNoteDate,
      page: negotiationId && page && page !== '__log__' ? page : null,
    }).select('id').single()
    if (error) { console.error('addNote error:', error.message); setSavingNote(false); return }
    await logActivity(supabase, {
      workspaceId, negotiationId, entityId,
      type: 'note_added', title: 'Nota agregada', actorId: user?.id,
    })
    await notifyNoteMentions(content, null)
    setNewNote('')
    setNewNoteDate(new Date().toISOString().split('T')[0])
    setMention(null)
    setSavingNote(false)
    fetchNotes()
    onChanged?.()
  }

  async function handleDeleteNote(noteId) {
    await supabase.from('negotiation_notes').delete().eq('id', noteId)
    setNotes(prev => prev.filter(n => n.id !== noteId))
    onChanged?.()
  }

  async function handleSaveNoteEdit(noteId) {
    const text = editingNoteText.trim()
    if (!text) return
    const previous = notes.find(n => n.id === noteId)?.content || ''
    await supabase.from('negotiation_notes').update({ content: text }).eq('id', noteId)
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, content: text } : n))
    await notifyNoteMentions(text, previous)
    setEditingNoteId(null)
    setMention(null)
    onChanged?.()
  }

  function renderEditInput(n, className) {
    return (
      <div style={{ position: 'relative' }}>
        <textarea
          ref={editTextareaRef}
          className={className}
          value={editingNoteText}
          autoFocus
          onChange={e => handleFieldChange('edit', e.target.value, e.target.selectionStart)}
          onBlur={() => { if (!mention) handleSaveNoteEdit(n.id) }}
          onKeyDown={e => {
            if (mention?.field === 'edit') {
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null) }
              return
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveNoteEdit(n.id) }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditingNoteId(null) }
          }}
          style={{ background: 'transparent', border: 'none', outline: 'none', width: '100%', font: 'inherit', fontSize: 13, resize: 'none', lineHeight: 1.5, padding: 0, color: '#374151' }}
          rows={3}
        />
        {mention?.field === 'edit' && (
          <div className="mention-dropdown">
            {mention.items.map(m => (
              <div key={m.user_id} className="mention-dropdown-item" onMouseDown={e => { e.preventDefault(); selectMention(m) }}>
                @{m.name}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className={variant === 'timeline' ? 'neg-bitacora-list' : 'neg-notes-list'}>
        {notes.length === 0 && !hideComposer && <p className="detail-empty">Sin notas todavía.</p>}
        {variant === 'timeline' ? notes.map((n, idx) => {
          const isEditing = editingNoteId === n.id
          return (
            <div key={n.id} className="neg-bitacora-row">
              <div className="neg-bitacora-rail">
                <span className="neg-bitacora-date">
                  {new Date(n.note_date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}
                </span>
                {idx < notes.length - 1 && <span className="neg-bitacora-line"></span>}
              </div>
              <span className="neg-bitacora-dot"></span>
              <div className="neg-bitacora-content">
                {isEditing ? renderEditInput(n, 'neg-bitacora-edit-input') : (
                  <p
                    className="neg-bitacora-text"
                    onDoubleClick={canEdit ? () => { setEditingNoteId(n.id); setEditingNoteText(n.content) } : undefined}
                    title={canEdit ? 'Doble click para editar' : undefined}
                  >{n.content}</p>
                )}
                {!isEditing && canEdit && (
                  <button className="neg-bitacora-remove" onClick={() => handleDeleteNote(n.id)} title="Eliminar">✕</button>
                )}
              </div>
            </div>
          )
        }) : notes.map((n, idx) => {
          const hash = n.id ? n.id.charCodeAt(0) + n.id.charCodeAt(4) : idx
          const col = NOTE_COLORS[hash % NOTE_COLORS.length]
          const rotations = [-3, -1.5, 0, 1.5, 3]
          const rot = rotations[(hash + idx) % rotations.length]
          const isEditing = editingNoteId === n.id
          return (
            <div key={n.id} className="neg-note-item" style={{
              background: col.bg,
              borderLeft: `3px solid ${col.border}`,
              transform: isEditing ? 'rotate(0deg) scale(1.03)' : `rotate(${rot}deg)`,
              marginLeft: idx % 2 === 0 ? 0 : 8,
              zIndex: isEditing ? 20 : idx,
            }}>
              <span className="neg-note-date" style={{ color: col.date }}>
                {new Date(n.note_date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
              </span>
              {isEditing ? renderEditInput(n, 'neg-note-edit-input') : (
                <span
                  className="neg-note-content"
                  onDoubleClick={canEdit ? () => { setEditingNoteId(n.id); setEditingNoteText(n.content) } : undefined}
                  title={canEdit ? 'Doble click para editar' : undefined}
                >{n.content}</span>
              )}
              {!isEditing && canEdit && (
                <button className="neg-note-delete" onClick={() => handleDeleteNote(n.id)} title="Eliminar nota">✕</button>
              )}
            </div>
          )
        })}
      </div>
      {canEdit && !hideComposer && (
        <div className="neg-note-add">
          <input
            type="date"
            className="neg-note-date-input"
            value={newNoteDate}
            onChange={e => setNewNoteDate(e.target.value)}
          />
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              ref={newNoteInputRef}
              type="text"
              className="neg-note-input"
              style={{ width: '100%' }}
              placeholder="Nueva nota... (@ para mencionar a alguien)"
              value={newNote}
              onChange={e => handleFieldChange('new', e.target.value, e.target.selectionStart)}
              onKeyDown={e => {
                if (mention?.field === 'new') {
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMention(null) }
                  return
                }
                if (e.key === 'Enter') handleAddNote()
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNewNote(''); setNewNoteDate(new Date().toISOString().split('T')[0]) }
              }}
            />
            {mention?.field === 'new' && (
              <div className="mention-dropdown">
                {mention.items.map(m => (
                  <div key={m.user_id} className="mention-dropdown-item" onMouseDown={e => { e.preventDefault(); selectMention(m) }}>
                    @{m.name}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="neg-add-task-btn" onClick={handleAddNote} disabled={savingNote || !newNote.trim()}>
            + Agregar
          </button>
        </div>
      )}
    </div>
  )
}
