import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { logActivity } from '../lib/activity'
// Reusa clases .neg-add-task-btn/.detail-empty ya definidas en Negotiations.css.

const MAX_SIZE_BYTES = 20 * 1024 * 1024 // 20MB

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function iconFor(mimeType) {
  if (!mimeType) return '📎'
  if (mimeType === 'application/pdf') return '📄'
  if (mimeType.startsWith('image/')) return '🖼️'
  if (mimeType.includes('word')) return '📝'
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊'
  return '📎'
}

// Documentos adjuntos (NDA, contrato, propuesta, etc.) de un proyecto o
// entidad — igual que notas/tareas/actividad, cuelga de negotiationId O
// entityId (exactamente uno de los dos). Archivos en el bucket privado
// 'documents' de Supabase Storage, bajo `${workspaceId}/${negotiationId||entityId}/...`.
export default function Documents({ negotiationId, entityId, workspaceId, canEdit, onChanged }) {
  const { user } = useAuth()
  const [documents, setDocuments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const dragCounter = useRef(0)

  useEffect(() => { fetchDocuments() }, [negotiationId, entityId])

  async function fetchDocuments() {
    let query = supabase.from('documents').select('*, uploader:uploaded_by ( full_name )').order('created_at', { ascending: false })
    query = negotiationId ? query.eq('negotiation_id', negotiationId) : query.eq('entity_id', entityId)
    const { data, error } = await query
    if (error) console.error('fetchDocuments error:', error.message)
    if (data) setDocuments(data)
  }

  async function uploadFile(file) {
    if (!file) return
    setError(null)
    if (file.size > MAX_SIZE_BYTES) { setError('El archivo supera el límite de 20MB'); return }
    setUploading(true)
    const path = `${workspaceId}/${negotiationId || entityId}/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('documents').upload(path, file)
    if (uploadError) { console.error('upload error:', uploadError.message); setError('No se pudo subir el archivo'); setUploading(false); return }
    const { error: insertError } = await supabase.from('documents').insert({
      workspace_id: workspaceId,
      negotiation_id: negotiationId || null,
      entity_id: entityId || null,
      name: file.name,
      storage_path: path,
      size_bytes: file.size,
      mime_type: file.type || null,
      uploaded_by: user?.id,
    })
    if (insertError) { console.error('insert document error:', insertError.message); setError('No se pudo guardar el documento'); setUploading(false); return }
    await logActivity(supabase, {
      workspaceId, negotiationId, entityId, type: 'document_uploaded',
      title: `Documento subido: "${file.name}"`, actorId: user?.id,
    })
    setUploading(false)
    fetchDocuments()
    onChanged?.()
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    await uploadFile(file)
  }

  // Suelta un archivo desde el mail, el Finder/Explorer, o donde sea — convive
  // con el botón "Examinar" de siempre, no lo reemplaza. Sube de a uno (el
  // primero soltado) para no complicar el manejo de errores parciales.
  function handleDragEnter(e) {
    e.preventDefault()
    if (!canEdit) return
    dragCounter.current += 1
    if (e.dataTransfer.types?.includes('Files')) setDragOver(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    if (!canEdit) return
    dragCounter.current -= 1
    if (dragCounter.current <= 0) { dragCounter.current = 0; setDragOver(false) }
  }

  function handleDragOver(e) {
    e.preventDefault()
  }

  async function handleDrop(e) {
    e.preventDefault()
    dragCounter.current = 0
    setDragOver(false)
    if (!canEdit) return
    const file = e.dataTransfer.files?.[0]
    await uploadFile(file)
  }

  async function handleDownload(doc) {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(doc.storage_path, 60)
    if (error) { console.error('signed url error:', error.message); return }
    window.open(data.signedUrl, '_blank')
  }

  async function handleDelete(doc) {
    setError(null)
    const { error: deleteError } = await supabase.from('documents').delete().eq('id', doc.id)
    if (deleteError) { console.error('delete document error:', deleteError.message); setError('No se pudo eliminar el documento. Intentá de nuevo.'); return }
    await supabase.storage.from('documents').remove([doc.storage_path])
    setDocuments(prev => prev.filter(d => d.id !== doc.id))
    onChanged?.()
  }

  return (
    <div
      className={`doc-dropzone ${dragOver ? 'doc-dropzone--over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {dragOver && <div className="doc-dropzone-overlay">Soltá el archivo para subirlo</div>}
      {documents.length === 0 ? (
        <p className="detail-empty">Sin documentos todavía.</p>
      ) : (
        <div className="neg-tasks-list">
          {documents.map(doc => (
            <div key={doc.id} className="neg-task-row">
              <span className="doc-icon">{iconFor(doc.mime_type)}</span>
              <div className="neg-task-body">
                <span className="neg-task-title">{doc.name}</span>
                <span className="doc-meta">
                  {formatSize(doc.size_bytes)}{doc.uploader?.full_name ? ` · ${doc.uploader.full_name}` : doc.uploaded_by ? ' · Usuario eliminado' : ''} · {new Date(doc.created_at).toLocaleDateString('es-AR')}
                </span>
              </div>
              <button className="doc-download" onClick={() => handleDownload(doc)} title="Descargar">⬇</button>
              {canEdit && (
                <button className="neg-milestone-delete" onClick={() => handleDelete(doc)} title="Eliminar documento">✕</button>
              )}
            </div>
          ))}
        </div>
      )}
      {error && <p className="form-error" style={{ marginTop: 8 }}>{error}</p>}
      {canEdit && (
        <div style={{ marginTop: 10 }}>
          <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFileChange} />
          <button className="neg-add-task-btn" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Subiendo...' : '+ Subir documento'}
          </button>
          <span className="doc-meta" style={{ marginLeft: 8 }}>o arrastrá el archivo acá</span>
        </div>
      )}
    </div>
  )
}
