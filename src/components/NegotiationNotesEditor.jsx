import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { logActivity } from '../lib/activity'
// Reusa .neg-note-date-input/.neg-note-input/.neg-add-task-btn/.detail-empty
// ya definidas en Negotiations.css.

export const NOTE_PAGES = [
  { value: 'bitacora', label: 'Bitácora (general)' },
  { value: 'financiero', label: 'Financiero' },
  { value: 'tareas', label: 'Tareas' },
  { value: 'documentos', label: 'Documentos' },
]

export function notePageLabel(page) {
  return NOTE_PAGES.find(p => p.value === (page || 'bitacora'))?.label || 'Bitácora (general)'
}

// Notitas de colores "pegadas" a una página puntual del proyecto (Financiero/
// Tareas/Documentos) o a la Bitácora general — a diferencia de esas mismas
// notas vistas ahí (solo lectura/edición inline, ver NotesPostIts), acá es
// donde se crean: elegís la página al agregarlas. Solo tiene sentido con un
// proyecto ya guardado (necesita negotiationId).
export default function NegotiationNotesEditor({ negotiationId, workspaceId }) {
  const { user } = useAuth()
  const [notes, setNotes] = useState([])
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0])
  const [newPage, setNewPage] = useState('bitacora')
  const [newText, setNewText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchNotes() }, [negotiationId])

  async function fetchNotes() {
    const { data, error } = await supabase.from('negotiation_notes').select('*')
      .eq('negotiation_id', negotiationId)
      .order('note_date', { ascending: false })
    if (error) console.error('fetchNegotiationNotes error:', error.message)
    if (data) setNotes(data)
  }

  async function handleAdd() {
    if (!newText.trim()) return
    setSaving(true)
    const { error } = await supabase.from('negotiation_notes').insert({
      negotiation_id: negotiationId,
      workspace_id: workspaceId,
      content: newText.trim(),
      note_date: newDate,
      page: newPage === 'bitacora' ? null : newPage,
    })
    if (error) { console.error('addNegotiationNote error:', error.message); setSaving(false); return }
    await logActivity(supabase, {
      workspaceId, negotiationId, type: 'note_added', title: 'Nota agregada', actorId: user?.id,
    })
    setNewText('')
    setSaving(false)
    fetchNotes()
  }

  async function handleRemove(id) {
    await supabase.from('negotiation_notes').delete().eq('id', id)
    setNotes(prev => prev.filter(n => n.id !== id))
  }

  return (
    <div>
      <div className="neg-note-add">
        <input type="date" className="neg-note-date-input" value={newDate} onChange={e => setNewDate(e.target.value)} />
        <select className="neg-note-page-select" value={newPage} onChange={e => setNewPage(e.target.value)}>
          {NOTE_PAGES.map(p => <option key={p.value} value={p.value}>📌 Pegar en: {p.label}</option>)}
        </select>
        <input
          type="text"
          className="neg-note-input"
          placeholder="Escribí la notita..."
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
        />
        <button className="neg-add-task-btn" onClick={handleAdd} disabled={saving || !newText.trim()}>+ Agregar</button>
      </div>

      {notes.length === 0 ? (
        <p className="detail-empty">Sin notas todavía.</p>
      ) : (
        <div className="neg-note-mini-list">
          {notes.map(n => (
            <div key={n.id} className="neg-note-mini-row">
              <span className="neg-note-page-badge">{notePageLabel(n.page)}</span>
              <span className="neg-note-mini-date">{new Date(n.note_date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}</span>
              <span className="neg-note-mini-text">{n.content}</span>
              <button className="neg-note-mini-remove" onClick={() => handleRemove(n.id)} title="Eliminar">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
