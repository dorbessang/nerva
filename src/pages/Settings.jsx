// Settings.jsx — Página de configuración del workspace

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import './Settings.css'

export default function Settings() {
  const { workspaceId, role } = useAuth()
  const [activeTab, setActiveTab] = useState('usuarios')

  // Solo owner y admin pueden acceder a Settings
  if (role !== 'owner' && role !== 'admin') {
    return (
      <div className="settings-container">
        <p className="settings-unauthorized">No tenés permisos para acceder a esta sección.</p>
      </div>
    )
  }

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1 className="settings-title">Configuración</h1>
      </div>

      {/* Tabs de navegación interna */}
      <div className="settings-tabs">
        {[
          { key: 'usuarios', label: 'Usuarios' },
          { key: 'estados', label: 'Estados' },
          { key: 'entidades', label: 'Tipos de entidad' },
          { key: 'workspace', label: 'Workspace' },
        ].map(tab => (
          <button
            key={tab.key}
            className={`settings-tab ${activeTab === tab.key ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Contenido según tab activo */}
      <div className="settings-content">
        {activeTab === 'usuarios' && <TabUsuarios workspaceId={workspaceId} />}
        {activeTab === 'estados' && <TabEstados workspaceId={workspaceId} />}
        {activeTab === 'entidades' && <TabEntidades workspaceId={workspaceId} />}
        {activeTab === 'workspace' && <TabWorkspace workspaceId={workspaceId} />}
      </div>
    </div>
  )
}

// ─── TAB USUARIOS ────────────────────────────────────────────────────────────

function TabUsuarios({ workspaceId }) {
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('editor')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState(null)
  const [inviteSuccess, setInviteSuccess] = useState(null)

  useEffect(() => {
    fetchMembers()
    fetchInvitations()
  }, [])

  async function fetchMembers() {
    const { data } = await supabase
      .from('workspace_members')
      .select(`user_id, role, profile:user_id ( full_name, email )`)
      .eq('workspace_id', workspaceId)
      .order('role')
    if (data) setMembers(data)
    setLoading(false)
  }

  async function fetchInvitations() {
    const { data } = await supabase
      .from('invitations')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('accepted', false)
      .order('created_at', { ascending: false })
    if (data) setInvitations(data)
  }

  async function handleChangeRole(userId, newRole) {
    await supabase
      .from('workspace_members')
      .update({ role: newRole })
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
    fetchMembers()
  }

  async function handleInvite() {
    setInviteError(null)
    setInviteSuccess(null)
    if (!inviteEmail.trim()) { setInviteError('El email es obligatorio'); return }
    setInviting(true)

    // Generamos un token único para la invitación
    const token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, '0')).join('')

    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 3) // 3 días de expiración

    const { error } = await supabase.from('invitations').insert({
      workspace_id: workspaceId,
      email: inviteEmail.trim().toLowerCase(),
      role: inviteRole,
      token,
      expires_at: expiresAt.toISOString(),
    })

    setInviting(false)
    if (error) {
      setInviteError('Error al crear la invitación. Verificá que el email no esté ya invitado.')
      return
    }
    setInviteSuccess(`Invitación creada. Token: ${token}`)
    setInviteEmail('')
    fetchInvitations()
  }

  async function handleCancelInvitation(id) {
    await supabase.from('invitations').delete().eq('id', id)
    fetchInvitations()
  }

  function roleLabel(role) {
    const map = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }
    return map[role] || role
  }

  if (loading) return <div className="settings-loading">Cargando...</div>

  return (
    <div className="settings-section">

      {/* Lista de miembros activos */}
      <div className="settings-block">
        <div className="settings-block-header">
          <h2 className="settings-block-title">Miembros del workspace</h2>
          <button className="settings-btn-primary" onClick={() => setShowInviteForm(v => !v)}>
            + Invitar usuario
          </button>
        </div>

        {/* Formulario de invitación */}
        {showInviteForm && (
          <div className="invite-form">
            <div className="form-row">
              <div className="form-group">
                <label>EMAIL</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  placeholder="usuario@empresa.com"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>ROL</label>
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <button className="settings-btn-primary" onClick={handleInvite} disabled={inviting}>
                {inviting ? 'Invitando...' : 'Enviar'}
              </button>
            </div>
            {inviteError && <p className="settings-error">{inviteError}</p>}
            {inviteSuccess && <p className="settings-success">{inviteSuccess}</p>}
          </div>
        )}

        {/* Tabla de miembros */}
        <div className="settings-table">
          {members.map(m => (
            <div key={m.user_id} className="settings-row">
              <div className="settings-row-info">
                <div className="settings-avatar">
                  {(m.profile?.full_name || m.profile?.email || '?')[0].toUpperCase()}
                </div>
                <div>
                  <div className="settings-row-name">{m.profile?.full_name || 'Sin nombre'}</div>
                  <div className="settings-row-email">{m.profile?.email}</div>
                </div>
              </div>
              <select
                className="settings-role-select"
                value={m.role}
                onChange={e => handleChangeRole(m.user_id, e.target.value)}
                disabled={m.role === 'owner'}
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      {/* Invitaciones pendientes */}
      {invitations.length > 0 && (
        <div className="settings-block">
          <h2 className="settings-block-title">Invitaciones pendientes</h2>
          <div className="settings-table">
            {invitations.map(inv => (
              <div key={inv.id} className="settings-row">
                <div className="settings-row-info">
                  <div className="settings-avatar inv">✉</div>
                  <div>
                    <div className="settings-row-name">{inv.email}</div>
                    <div className="settings-row-email">Rol: {roleLabel(inv.role)} · Expira: {new Date(inv.expires_at).toLocaleDateString('es-AR')}</div>
                  </div>
                </div>
                <button className="settings-btn-danger" onClick={() => handleCancelInvitation(inv.id)}>
                  Cancelar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── TAB ESTADOS ─────────────────────────────────────────────────────────────

function TabEstados({ workspaceId }) {
  const [states, setStates] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#64748B')
  const [newBgColor, setNewBgColor] = useState('#F1F5F9')
  const [saving, setSaving] = useState(false)
  const [objectType, setObjectType] = useState('negotiation')

  useEffect(() => {
    fetchStates()
  }, [objectType])

  async function fetchStates() {
    setLoading(true)
    const { data } = await supabase
      .from('custom_states')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('object_type', objectType)
      .order('sort_order')
    if (data) setStates(data)
    setLoading(false)
  }

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true)
    await supabase.from('custom_states').insert({
      workspace_id: workspaceId,
      object_type: objectType,
      name: newName.trim(),
      color: newColor,
      bg_color: newBgColor,
      sort_order: states.length,
    })
    setNewName('')
    setNewColor('#64748B')
    setNewBgColor('#F1F5F9')
    setSaving(false)
    fetchStates()
  }

  async function handleDelete(id) {
    await supabase.from('custom_states').delete().eq('id', id)
    fetchStates()
  }

  return (
    <div className="settings-section">
      <div className="settings-block">
        <div className="settings-block-header">
          <h2 className="settings-block-title">Estados personalizados</h2>
          <div className="settings-type-toggle">
            {[
              { key: 'negotiation', label: 'Proyectos' },
              { key: 'entity', label: 'Entidades' },
              { key: 'task', label: 'Tareas' },
            ].map(t => (
              <button
                key={t.key}
                className={`settings-toggle-btn ${objectType === t.key ? 'active' : ''}`}
                onClick={() => setObjectType(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? <div className="settings-loading">Cargando...</div> : (
          <div className="settings-table">
            {states.map(s => (
              <div key={s.id} className="settings-row">
                <div className="settings-row-info">
                  <div className="state-color-dot" style={{ backgroundColor: s.color }} />
                  <span
                    className="state-badge-preview"
                    style={{ backgroundColor: s.bg_color, color: s.color }}
                  >
                    {s.name}
                  </span>
                </div>
                <button className="settings-btn-danger" onClick={() => handleDelete(s.id)}>
                  Eliminar
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Formulario para agregar nuevo estado */}
        <div className="state-add-form">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nombre del estado..."
            className="state-name-input"
          />
          <div className="color-picker-group">
            <label>Color texto</label>
            <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} />
          </div>
          <div className="color-picker-group">
            <label>Color fondo</label>
            <input type="color" value={newBgColor} onChange={e => setNewBgColor(e.target.value)} />
          </div>
          <div className="state-preview" style={{ backgroundColor: newBgColor, color: newColor }}>
            {newName || 'Vista previa'}
          </div>
          <button className="settings-btn-primary" onClick={handleAdd} disabled={saving}>
            + Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TAB TIPOS DE ENTIDAD ─────────────────────────────────────────────────────

function TabEntidades({ workspaceId }) {
  const [entityTypes, setEntityTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)

  useEffect(() => {
    fetchEntityTypes()
  }, [])

  async function fetchEntityTypes() {
    setLoading(true)
    const { data } = await supabase
      .from('entity_types')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('sort_order')
    if (data) setEntityTypes(data)
    setLoading(false)
  }

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true)
    await supabase.from('entity_types').insert({
      workspace_id: workspaceId,
      name: newName.trim(),
      sort_order: entityTypes.length,
    })
    setNewName('')
    setSaving(false)
    fetchEntityTypes()
  }

  async function handleDelete(id) {
    // Triple confirmación para evitar borrado accidental
    await supabase.from('entity_types').delete().eq('id', id)
    setConfirmDelete(null)
    fetchEntityTypes()
  }

  return (
    <div className="settings-section">
      <div className="settings-block">
        <div className="settings-block-header">
          <h2 className="settings-block-title">Tipos de entidad</h2>
        </div>

        <p className="settings-hint">
          Cada tipo genera una sección en el sidebar. Al eliminar un tipo se eliminan todas las entidades asociadas.
        </p>

        {loading ? <div className="settings-loading">Cargando...</div> : (
          <div className="settings-table">
            {entityTypes.map(et => (
              <div key={et.id} className="settings-row">
                <div className="settings-row-info">
                  <span className="settings-row-name">{et.name}</span>
                </div>
                {confirmDelete === et.id ? (
                  <div className="delete-confirm-inline">
                    <span>¿Eliminar con todos sus datos?</span>
                    <button className="settings-btn-danger" onClick={() => handleDelete(et.id)}>Sí, eliminar</button>
                    <button className="settings-btn-secondary" onClick={() => setConfirmDelete(null)}>Cancelar</button>
                  </div>
                ) : (
                  <button className="settings-btn-danger" onClick={() => setConfirmDelete(et.id)}>
                    Eliminar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="state-add-form">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Nombre del tipo (ej: Fabricantes)..."
            className="state-name-input"
          />
          <button className="settings-btn-primary" onClick={handleAdd} disabled={saving}>
            + Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TAB WORKSPACE ────────────────────────────────────────────────────────────

function TabWorkspace({ workspaceId }) {
  const [workspace, setWorkspace] = useState(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchWorkspace()
  }, [])

  async function fetchWorkspace() {
    const { data } = await supabase
      .from('workspaces')
      .select('*')
      .eq('id', workspaceId)
      .single()
    if (data) {
      setWorkspace(data)
      setName(data.name)
    }
  }

  async function handleSave() {
    setSaving(true)
    await supabase
      .from('workspaces')
      .update({ name: name.trim() })
      .eq('id', workspaceId)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!workspace) return <div className="settings-loading">Cargando...</div>

  return (
    <div className="settings-section">
      <div className="settings-block">
        <h2 className="settings-block-title">Información del workspace</h2>
        <div className="form-group" style={{ maxWidth: 400 }}>
          <label>NOMBRE DEL WORKSPACE</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>
        <button className="settings-btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Guardando...' : saved ? '✓ Guardado' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  )
}