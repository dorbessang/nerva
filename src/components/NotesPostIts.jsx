import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { logActivity } from '../lib/activity'
// Reusa las clases .neg-note-*/.neg-add-task-btn/.detail-empty ya definidas
// en Negotiations.css — ese archivo queda cargado globalmente en cualquier
// página que importe algo de Negotiations.jsx (incluida Entities.jsx).

const NOTE_COLORS = [
  { bg: '#fef08a', border: '#fde047', date: '#854d0e' },
  { bg: '#bfdbfe', border: '#93c5fd', date: '#1e40af' },
  { bg: '#bbf7d0', border: '#86efac', date: '#166534' },
  { bg: '#fecdd3', border: '#fda4af', date: '#9f1239' },
]

// Notas tipo post-it, reusadas tanto en el detalle de proyecto como en el
// de entidad — se filtran/insertan por negotiationId o por entityId,
// exactamente uno de los dos.
export default function NotesPostIts({ negotiationId, entityId, workspaceId, canEdit, onChanged }) {
  const { user } = useAuth()
  const [notes, setNotes] = useState([])
  const [newNote, setNewNote] = useState('')
  const [newNoteDate, setNewNoteDate] = useState(new Date().toISOString().split('T')[0])
  const [savingNote, setSavingNote] = useState(false)
  const [editingNoteId, setEditingNoteId] = useState(null)
  const [editingNoteText, setEditingNoteText] = useState('')

  useEffect(() => { fetchNotes() }, [negotiationId, entityId])

  async function fetchNotes() {
    let query = supabase.from('negotiation_notes').select('*').order('note_date', { ascending: true })
    query = negotiationId ? query.eq('negotiation_id', negotiationId) : query.eq('entity_id', entityId)
    const { data, error } = await query
    if (error) console.error('fetchNotes error:', error.message)
    if (data) setNotes(data)
  }

  async function handleAddNote() {
    if (!newNote.trim()) return
    setSavingNote(true)
    const { data, error } = await supabase.from('negotiation_notes').insert({
      negotiation_id: negotiationId || null,
      entity_id: entityId || null,
      workspace_id: workspaceId,
      content: newNote.trim(),
      note_date: newNoteDate,
    }).select('id').single()
    if (error) { console.error('addNote error:', error.message); setSavingNote(false); return }
    await logActivity(supabase, {
      workspaceId, negotiationId, entityId,
      type: 'note_added', title: 'Nota agregada', actorId: user?.id,
    })
    setNewNote('')
    setNewNoteDate(new Date().toISOString().split('T')[0])
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
    await supabase.from('negotiation_notes').update({ content: text }).eq('id', noteId)
    setNotes(prev => prev.map(n => n.id === noteId ? { ...n, content: text } : n))
    setEditingNoteId(null)
    onChanged?.()
  }

  return (
    <div>
      <div className="neg-notes-list">
        {notes.length === 0 && <p className="detail-empty">Sin notas todavía.</p>}
        {notes.map((n, idx) => {
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
              {isEditing ? (
                <textarea
                  className="neg-note-edit-input"
                  value={editingNoteText}
                  autoFocus
                  onChange={e => setEditingNoteText(e.target.value)}
                  onBlur={() => handleSaveNoteEdit(n.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveNoteEdit(n.id) }
                    if (e.key === 'Escape') setEditingNoteId(null)
                  }}
                  style={{ background: 'transparent', border: 'none', outline: 'none', width: '100%', font: 'inherit', fontSize: 13, resize: 'none', lineHeight: 1.5, padding: 0, color: '#374151' }}
                  rows={3}
                />
              ) : (
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
      {canEdit && (
        <div className="neg-note-add">
          <input
            type="date"
            className="neg-note-date-input"
            value={newNoteDate}
            onChange={e => setNewNoteDate(e.target.value)}
          />
          <input
            type="text"
            className="neg-note-input"
            placeholder="Nueva nota..."
            value={newNote}
            onChange={e => setNewNote(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddNote() }}
          />
          <button className="neg-add-task-btn" onClick={handleAddNote} disabled={savingNote || !newNote.trim()}>
            + Agregar
          </button>
        </div>
      )}
    </div>
  )
}
