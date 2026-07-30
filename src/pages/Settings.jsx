// Settings.jsx — Página de configuración del workspace

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { notifyRoleChanged } from '../lib/notifications'
import './Settings.css'
import * as LucideIcons from 'lucide-react'

// supabase.functions.invoke() devuelve data: null cuando la función responde
// con status != 2xx — el body real (con el mensaje de error de la función)
// solo queda accesible vía error.context, que es el Response crudo.
async function extractFunctionError(error) {
  try {
    const body = await error?.context?.json()
    return body?.error || null
  } catch {
    return null
  }
}

export default function Settings() {
  const { workspaceId, effectiveRole, activeWorkspace } = useAuth()
  const isPersonal = activeWorkspace?.type === 'personal'
  const isOwner = effectiveRole === 'owner'
  const isAdminOrOwner = effectiveRole === 'owner' || effectiveRole === 'admin'
  // Un workspace personal es de un solo usuario y no tiene proyectos/entidades —
  // no tiene sentido invitar gente ni configurar estados/tipos de entidad ahí
  const canInvite = isOwner && !isPersonal
  const showModuleTabs = isAdminOrOwner && !isPersonal
  const [activeTab, setActiveTab] = useState(canInvite ? 'usuarios' : showModuleTabs ? 'estados' : 'notificaciones')

  useEffect(() => {
    if (activeTab === 'usuarios' && !canInvite) setActiveTab(showModuleTabs ? 'estados' : 'notificaciones')
    if (['estados', 'entidades'].includes(activeTab) && !showModuleTabs) setActiveTab(isAdminOrOwner ? 'workspace' : 'notificaciones')
    if (activeTab === 'workspace' && !isAdminOrOwner) setActiveTab('notificaciones')
  }, [canInvite, showModuleTabs, isAdminOrOwner, activeTab])

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1 className="settings-title">Configuración</h1>
      </div>

      {/* Tabs de navegación interna — en un workspace personal (de un solo
          usuario, sin proyectos/entidades) no tiene sentido invitar gente ni
          configurar estados/tipos de entidad */}
      <div className="settings-tabs">
        {[
          ...(canInvite ? [{ key: 'usuarios', label: 'Usuarios' }] : []),
          ...(showModuleTabs ? [{ key: 'estados', label: 'Estados' }] : []),
          ...(showModuleTabs ? [{ key: 'entidades', label: 'Tipos de entidad' }] : []),
          ...(isAdminOrOwner ? [{ key: 'workspace', label: 'Workspace' }] : []),
          { key: 'notificaciones', label: 'Notificaciones' },
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
        {activeTab === 'usuarios' && canInvite && <TabUsuarios workspaceId={workspaceId} />}
        {activeTab === 'estados' && showModuleTabs && <TabEstados workspaceId={workspaceId} />}
        {activeTab === 'entidades' && showModuleTabs && <TabEntidades workspaceId={workspaceId} />}
        {activeTab === 'workspace' && isAdminOrOwner && <TabWorkspace workspaceId={workspaceId} />}
        {activeTab === 'notificaciones' && <TabNotificaciones workspaceId={workspaceId} />}
      </div>
    </div>
  )
}

// ─── TAB USUARIOS ────────────────────────────────────────────────────────────

function TabUsuarios({ workspaceId }) {
  const { user: currentUser } = useAuth()
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('editor')
  const [inviting, setInviting] = useState(false)
  const [inviteError, setInviteError] = useState(null)
  const [inviteSuccess, setInviteSuccess] = useState(null)
  const [inviteLink, setInviteLink] = useState(null)
  const [confirmRemove, setConfirmRemove] = useState(null) // miembro a eliminar

  useEffect(() => {
    fetchMembers()
    fetchInvitations()
  }, [workspaceId])

  async function fetchMembers() {
    const { data } = await supabase
      .from('workspace_members')
      .select(`user_id, role, status, profile:user_id ( full_name, email )`)
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
      .order('created_at', { ascending: false })
    if (data) setInvitations(data)
  }

  async function handleChangeRole(userId, newRole) {
    await supabase
      .from('workspace_members')
      .update({ role: newRole })
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
    await notifyRoleChanged(supabase, { workspaceId, userId, newRoleLabel: roleLabel(newRole), actingUserId: currentUser?.id })
    fetchMembers()
  }

  async function handleToggleStatus(member) {
    const newStatus = member.status === 'active' ? 'inactive' : 'active'
    await supabase
      .from('workspace_members')
      .update({ status: newStatus })
      .eq('workspace_id', workspaceId)
      .eq('user_id', member.user_id)
    fetchMembers()
  }

  async function handleRemoveMember() {
    if (!confirmRemove) return
    await supabase
      .from('workspace_members')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', confirmRemove.user_id)
    setConfirmRemove(null)
    fetchMembers()
  }

  async function handleInvite() {
    setInviteError(null)
    setInviteSuccess(null)
    setInviteLink(null)
    if (!inviteEmail.trim()) { setInviteError('El email es obligatorio'); return }
    setInviting(true)

    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: { action: 'invite', email: inviteEmail.trim().toLowerCase(), role: inviteRole, workspaceId },
    })

    setInviting(false)
    if (error || data?.error) {
      setInviteError(data?.error || (await extractFunctionError(error)) || 'Error al enviar la invitación. Verificá que el email no esté ya invitado.')
      return
    }
    if (data?.direct) {
      setInviteSuccess(`${inviteEmail.trim()} ya tenía cuenta y se sumó directo al workspace.`)
      fetchMembers()
    } else {
      setInviteSuccess(`Invitación creada para ${inviteEmail.trim()}. Copiá el link y mandáselo (todavía no se manda mail automático).`)
      setInviteLink(data?.inviteLink || null)
      fetchInvitations()
    }
    setInviteEmail('')
  }

  async function handleCopyLink() {
    if (!inviteLink) return
    await navigator.clipboard.writeText(inviteLink)
    setInviteSuccess('Link copiado al portapapeles.')
  }

  async function handleCancelInvitation(inv) {
    await supabase.functions.invoke('invite-user', {
      body: { action: 'cancel', email: inv.email, workspaceId },
    })
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
          <h2 className="settings-block-title">Miembros del workspace ({members.filter(m => m.status === 'active').length} activos)</h2>
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
            {inviteLink && (
              <div className="invite-link-row">
                <input className="invite-link-input" type="text" readOnly value={inviteLink} onFocus={e => e.target.select()} />
                <button className="settings-btn-secondary" onClick={handleCopyLink}>Copiar</button>
              </div>
            )}
          </div>
        )}

        {/* Tabla de miembros */}
        <div className="settings-table">
          {members.map(m => {
            const isSelf = m.user_id === currentUser?.id
            const isOwner = m.role === 'owner'
            return (
              <div key={m.user_id} className={`settings-row ${m.status === 'inactive' ? 'settings-row--inactive' : ''}`}>
                <div className="settings-row-info">
                  <div className="settings-avatar">
                    {(m.profile?.full_name || m.profile?.email || '?')[0].toUpperCase()}
                  </div>
                  <div className="settings-row-text">
                    <div className="settings-row-name">
                      {m.profile?.full_name || 'Sin nombre'}
                      {m.status === 'inactive' && <span className="settings-inactive-badge">Desactivado</span>}
                    </div>
                    <div className="settings-row-email">{m.profile?.email}</div>
                  </div>
                </div>
                <div className="settings-row-actions">
                  <select
                    className="settings-role-select"
                    value={m.role}
                    onChange={e => handleChangeRole(m.user_id, e.target.value)}
                    disabled={isOwner}
                  >
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  {!isOwner && !isSelf && (
                    <>
                      <button className="settings-btn-secondary" onClick={() => handleToggleStatus(m)}>
                        {m.status === 'active' ? 'Desactivar' : 'Reactivar'}
                      </button>
                      <button className="settings-btn-danger" onClick={() => setConfirmRemove(m)}>
                        Eliminar
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
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
                  <div className="settings-row-text">
                    <div className="settings-row-name">{inv.email}</div>
                    <div className="settings-row-email">Rol: {roleLabel(inv.role)} · Expira: {new Date(inv.expires_at).toLocaleDateString('es-AR')}</div>
                  </div>
                </div>
                <button className="settings-btn-danger" onClick={() => handleCancelInvitation(inv)}>
                  Cancelar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmRemove && (
        <DeleteConfirmModal
          itemName={confirmRemove.profile?.full_name || confirmRemove.profile?.email}
          itemType="miembro"
          warningText="Esta persona pierde acceso inmediato al workspace. Sus tareas ya asignadas y proyectos no se borran, pero quedan sin ese responsable visible."
          onConfirm={handleRemoveMember}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  )
}

// ─── TAB ESTADOS ─────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  { color: '#1D4ED8', bg: '#EFF6FF' }, // azul
  { color: '#7C3AED', bg: '#F5F3FF' }, // violeta
  { color: '#059669', bg: '#ECFDF5' }, // verde
  { color: '#D97706', bg: '#FFFBEB' }, // amarillo
  { color: '#DC2626', bg: '#FEF2F2' }, // rojo
  { color: '#DB2777', bg: '#FDF2F8' }, // rosa
  { color: '#0891B2', bg: '#ECFEFF' }, // cyan
  { color: '#64748B', bg: '#F1F5F9' }, // gris
  { color: '#0B1F3A', bg: '#F0F2F5' }, // marino
]

function TabEstados({ workspaceId }) {
  const [states, setStates] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#64748B')
  const [newBgColor, setNewBgColor] = useState('#F1F5F9')
  const [bgManual, setBgManual] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
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

  const [confirmDeleteState, setConfirmDeleteState] = useState(null)

  async function handleDelete(id) {
    await supabase.from('custom_states').delete().eq('id', id)
    setConfirmDeleteState(null)
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
                {s.name === 'Completado' ? (
                  <span className="settings-state-protected" title="Este estado es requerido por el sistema">🔒 Protegido</span>
                ) : confirmDeleteState === s.id ? (
                  <div className="delete-confirm-inline">
                    <span>¿Seguro?</span>
                    <button className="settings-btn-danger" onClick={() => handleDelete(s.id)}>Sí</button>
                    <button className="settings-btn-secondary" onClick={() => setConfirmDeleteState(null)}>No</button>
                  </div>
                ) : (
                  <button className="settings-btn-danger" onClick={() => setConfirmDeleteState(s.id)}>Eliminar</button>
                )}
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

          {/* Paleta de colores preestablecidos */}
          <div className="state-color-palette">
            {PRESET_COLORS.map(p => (
              <button
                key={p.color}
                type="button"
                className={`state-palette-swatch ${newColor === p.color ? 'selected' : ''}`}
                style={{ backgroundColor: p.color }}
                onClick={() => {
                  setNewColor(p.color)
                  if (!bgManual) setNewBgColor(p.bg)
                }}
                title={p.color}
              />
            ))}
            <button
              type="button"
              className="state-palette-more"
              onClick={() => setShowAdvanced(v => !v)}
            >
              {showAdvanced ? 'Menos' : '+ Colores'}
            </button>
          </div>

          {showAdvanced && (
            <div className="state-advanced-colors">
              <div className="color-picker-group">
                <label>Color texto</label>
                <input type="color" value={newColor} onChange={e => {
                  setNewColor(e.target.value)
                  if (!bgManual) setNewBgColor(e.target.value + '1a')
                }} />
              </div>
              <div className="color-picker-group">
                <label>Color fondo</label>
                <input type="color" value={newBgColor} onChange={e => {
                  setNewBgColor(e.target.value)
                  setBgManual(true)
                }} />
              </div>
            </div>
          )}

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

// Íconos disponibles para tipos de entidad
const ENTITY_ICONS = [
  'Building2','Factory','Store','Truck','FlaskConical','Pill','Stethoscope',
  'ShoppingBag','Briefcase','Globe','Users','UserCheck','Landmark','Package',
  'Layers','Network','CircleDot','Tag','Star','Shield',
]

function EntityIcon({ name, size = 16, ...props }) {
  const Icon = LucideIcons[name]
  return Icon ? <Icon size={size} {...props} /> : null
}

function TabEntidades({ workspaceId }) {
  const [entityTypes, setEntityTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newPlural, setNewPlural] = useState('')
  const [newIcon, setNewIcon] = useState('Building2')
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [editing, setEditing] = useState(null) // { id, name, plural, icon }
  const iconPickerRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (iconPickerRef.current && !iconPickerRef.current.contains(e.target)) {
        setShowIconPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    fetchEntityTypes()
  }, [workspaceId])

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
      plural: newPlural.trim() || null,
      icon: newIcon,
      sort_order: entityTypes.length,
    })
    setNewName('')
    setNewPlural('')
    setNewIcon('Building2')
    setSaving(false)
    fetchEntityTypes()
  }

  async function handleSaveEdit() {
    if (!editing?.name?.trim()) return
    await supabase.from('entity_types').update({
      name: editing.name.trim(),
      plural: editing.plural?.trim() || null,
      icon: editing.icon,
    }).eq('id', editing.id)
    setEditing(null)
    fetchEntityTypes()
  }

  async function handleDelete(id) {
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
              <div key={et.id} className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {editing?.id === et.id ? (
                  // Modo edición inline
                  <>
                    <div className="settings-row-info" style={{ flex: 1, flexWrap: 'wrap', gap: 8 }}>
                      {/* Icon picker en modo edición */}
                      <div style={{ position: 'relative' }} ref={iconPickerRef}>
                        <button
                          type="button"
                          className="icon-picker-trigger"
                          onClick={() => setShowIconPicker(v => !v)}
                          title="Cambiar ícono"
                        >
                          <EntityIcon name={editing.icon || 'Building2'} size={18} />
                        </button>
                        {showIconPicker && (
                          <div className="icon-picker-dropdown">
                            {ENTITY_ICONS.map(iconName => (
                              <button
                                key={iconName}
                                type="button"
                                className={`icon-picker-option ${editing.icon === iconName ? 'selected' : ''}`}
                                onClick={() => { setEditing(ed => ({ ...ed, icon: iconName })); setShowIconPicker(false) }}
                                title={iconName}
                              >
                                <EntityIcon name={iconName} size={18} />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <input
                        className="state-name-input"
                        style={{ maxWidth: 160 }}
                        value={editing.name}
                        onChange={e => setEditing(ed => ({ ...ed, name: e.target.value }))}
                        placeholder="Singular"
                        autoFocus
                      />
                      <input
                        className="state-name-input"
                        style={{ maxWidth: 160 }}
                        value={editing.plural || ''}
                        onChange={e => setEditing(ed => ({ ...ed, plural: e.target.value }))}
                        placeholder="Plural (opcional)"
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="settings-btn-primary" onClick={handleSaveEdit}>Guardar</button>
                      <button className="settings-btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
                    </div>
                  </>
                ) : (
                  // Modo vista
                  <>
                    <div className="settings-row-info">
                      {et.icon && <span className="entity-type-icon-preview"><EntityIcon name={et.icon} size={16} /></span>}
                      <div>
                        <div className="settings-row-name">{et.name}</div>
                        {et.plural && <div className="settings-row-email">plural: {et.plural}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="settings-btn-secondary" onClick={() => setEditing({ id: et.id, name: et.name, plural: et.plural || '', icon: et.icon })}>
                        Editar
                      </button>
                      {confirmDelete === et.id ? (
                        <div className="delete-confirm-inline">
                          <span>¿Eliminar con todos sus datos?</span>
                          <button className="settings-btn-danger" onClick={() => handleDelete(et.id)}>Sí, eliminar</button>
                          <button className="settings-btn-secondary" onClick={() => setConfirmDelete(null)}>Cancelar</button>
                        </div>
                      ) : (
                        <button className="settings-btn-danger" onClick={() => setConfirmDelete(et.id)}>Eliminar</button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="state-add-form" style={{ flexWrap: 'wrap', gap: 10 }}>
          {/* Selector de ícono */}
          <div style={{ position: 'relative' }} ref={iconPickerRef}>
            <button
              type="button"
              className="icon-picker-trigger"
              onClick={() => setShowIconPicker(v => !v)}
              title="Elegir ícono"
            >
              <EntityIcon name={newIcon} size={18} />
            </button>
            {showIconPicker && (
              <div className="icon-picker-dropdown">
                {ENTITY_ICONS.map(iconName => (
                  <button
                    key={iconName}
                    type="button"
                    className={`icon-picker-option ${newIcon === iconName ? 'selected' : ''}`}
                    onClick={() => { setNewIcon(iconName); setShowIconPicker(false) }}
                    title={iconName}
                  >
                    <EntityIcon name={iconName} size={18} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Singular (ej: Forwarder)"
            className="state-name-input"
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <input
            type="text"
            value={newPlural}
            onChange={e => setNewPlural(e.target.value)}
            placeholder="Plural (ej: Forwarders)"
            className="state-name-input"
            style={{ maxWidth: 180 }}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
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
  const { refreshWorkspaces } = useAuth()
  const [workspace, setWorkspace] = useState(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetchWorkspace()
  }, [workspaceId])

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
    await refreshWorkspaces()
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

// ─── TAB NOTIFICACIONES ───────────────────────────────────────────────────────
// A diferencia de las demás pestañas, esta es personal: cualquier rol puede
// verla y editarla, elige solo por sí mismo, no afecta a nadie más del WS.

const NOTIF_TYPES = [
  { key: 'task_assigned', label: 'Me asignan una tarea' },
  { key: 'task_unblocked', label: 'Se desbloquea una tarea que tengo asignada' },
  { key: 'role_changed', label: 'Cambia mi rol en este workspace' },
  { key: 'negotiation_status_changed', label: 'Cambia el estado de un proyecto con tareas mías' },
  { key: 'task_due_soon', label: 'Una tarea mía vence mañana' },
  { key: 'task_overdue', label: 'Una tarea mía está vencida' },
  { key: 'negotiation_inactive', label: 'Un proyecto con tareas mías se marca inactivo' },
  { key: 'mentioned', label: 'Me mencionan con @ en una nota' },
]

function TabNotificaciones({ workspaceId }) {
  const { user } = useAuth()
  const [prefs, setPrefs] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPrefs()
  }, [workspaceId])

  async function fetchPrefs() {
    setLoading(true)
    const { data } = await supabase
      .from('notification_preferences')
      .select('type, enabled')
      .eq('user_id', user.id)
      .eq('workspace_id', workspaceId)
    const map = {}
    NOTIF_TYPES.forEach(t => { map[t.key] = true })
    ;(data || []).forEach(p => { map[p.type] = p.enabled })
    setPrefs(map)
    setLoading(false)
  }

  async function toggle(type) {
    const newVal = !prefs[type]
    setPrefs(p => ({ ...p, [type]: newVal }))
    await supabase
      .from('notification_preferences')
      .upsert({ user_id: user.id, workspace_id: workspaceId, type, enabled: newVal }, { onConflict: 'user_id,workspace_id,type' })
  }

  if (loading) return <div className="settings-loading">Cargando...</div>

  return (
    <div className="settings-section">
      <div className="settings-block">
        <h2 className="settings-block-title">Notificaciones</h2>
        <p className="settings-hint">
          Elegí qué avisos in-app querés recibir en este workspace. Esto es personal, no afecta a nadie más.
          Por ahora solo hay notificaciones dentro de la app — mail/WhatsApp están planeados para más adelante.
        </p>
        <div className="settings-table">
          {NOTIF_TYPES.map(t => (
            <div key={t.key} className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-name">{t.label}</div>
              </div>
              <label className="notif-pref-toggle">
                <input type="checkbox" checked={!!prefs[t.key]} onChange={() => toggle(t.key)} />
                <span className="notif-pref-slider" />
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}