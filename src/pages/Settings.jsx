// Settings.jsx — Página de configuración del workspace

import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import Avatar from '../components/Avatar'
import { notifyRoleChanged } from '../lib/notifications'
import { computeFieldOrder, isCardFilterable } from '../lib/customFields'
import { extractFunctionError } from '../lib/edgeFunctionError'
import { FINANCIAL_FEATURES, resolveFinancialConfig } from '../lib/financialConfig'
import { isOwner as isOwnerRole, isPrivileged } from '../lib/roles'
import { APPROVAL_RULE_TYPES } from '../lib/approvals'
import { withOwnerApproval } from '../lib/staffActions'
import './Settings.css'
import * as LucideIcons from 'lucide-react'

const SETTINGS_TAB_KEYS = ['usuarios', 'proyectos', 'entidades', 'productos', 'general', 'automatizaciones', 'soporte', 'notificaciones']

export default function Settings() {
  const { workspaceId, effectiveRole, activeWorkspace } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const isPersonal = activeWorkspace?.type === 'personal'
  const isOwner = isOwnerRole(effectiveRole)
  const isAdminOrOwner = isPrivileged(effectiveRole)
  // Un workspace personal es de un solo usuario y no tiene proyectos/entidades —
  // no tiene sentido invitar gente ni configurar estados/tipos de entidad ahí.
  // Ver la lista de miembros es para cualquier rol; gestionarlos (invitar,
  // cambiar rol, desactivar/eliminar) sigue siendo exclusivo del owner —
  // TabUsuarios usa canManage para eso.
  const canViewUsuarios = !isPersonal
  const showModuleTabs = isAdminOrOwner && !isPersonal
  const urlTab = new URLSearchParams(location.search).get('tab')
  // La pestaña activa vive en la URL (?tab=...), no solo en un useState —
  // así sobrevive a cualquier remount del componente (cambio de sesión, el
  // navegador descartando la pestaña en segundo plano, etc.).
  const [activeTab, setActiveTabState] = useState(
    SETTINGS_TAB_KEYS.includes(urlTab) ? urlTab : canViewUsuarios ? 'usuarios' : showModuleTabs ? 'proyectos' : 'notificaciones'
  )

  function setActiveTab(tab) {
    setActiveTabState(tab)
    navigate(`/settings?tab=${tab}`, { replace: true })
  }

  const [pendingWorkspaceCount, setPendingWorkspaceCount] = useState(0)

  // Misma burbuja que ya tiene la solapa "Staff" en Perfil, pero acá para
  // el owner: accesos de soporte esperando confirmación + solicitudes de
  // staff pendientes, del workspace activo.
  useEffect(() => {
    if (!isOwner || !workspaceId) { setPendingWorkspaceCount(0); return }
    fetchPendingWorkspaceCount()
  }, [isOwner, workspaceId])

  async function fetchPendingWorkspaceCount() {
    const [{ count: grantsCount }, { count: requestsCount }] = await Promise.all([
      supabase.from('access_grants').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'pending_confirmation'),
      supabase.from('staff_action_requests').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).eq('status', 'pending'),
    ])
    setPendingWorkspaceCount((grantsCount || 0) + (requestsCount || 0))
  }

  useEffect(() => {
    if (activeTab === 'usuarios' && !canViewUsuarios) setActiveTab(showModuleTabs ? 'proyectos' : 'notificaciones')
    if (['proyectos', 'entidades', 'productos'].includes(activeTab) && !showModuleTabs) setActiveTab(isAdminOrOwner ? 'general' : 'notificaciones')
    if (['general', 'automatizaciones', 'soporte'].includes(activeTab) && !isAdminOrOwner) setActiveTab('notificaciones')
  }, [canViewUsuarios, showModuleTabs, isAdminOrOwner, activeTab])

  // Navegación agrupada por dominio (Workspace / Equipo / Módulos / Tu
  // cuenta) en vez de una sola tira de pestañas — reordenado 2026-08-23:
  // "Workspace" se había vuelto un cajón de sastre (nombre, alertas,
  // reglas de autorización, soporte de staff, todo junto en una pestaña).
  // Cada grupo vacío se omite entero (ej. en un workspace personal solo
  // queda "Tu cuenta").
  const NAV_GROUPS = [
    {
      label: 'Workspace', items: [
        ...(isAdminOrOwner ? [{ key: 'general', label: 'General' }] : []),
        ...(isAdminOrOwner ? [{ key: 'automatizaciones', label: 'Automatizaciones' }] : []),
      ]
    },
    {
      label: 'Equipo', items: [
        ...(canViewUsuarios ? [{ key: 'usuarios', label: 'Usuarios' }] : []),
        ...(isAdminOrOwner ? [{ key: 'soporte', label: 'Soporte', badge: pendingWorkspaceCount }] : []),
      ]
    },
    {
      label: 'Módulos', items: [
        ...(showModuleTabs ? [{ key: 'proyectos', label: 'Proyectos' }] : []),
        ...(showModuleTabs ? [{ key: 'entidades', label: 'Entidades' }] : []),
        ...(showModuleTabs ? [{ key: 'productos', label: 'Productos' }] : []),
      ]
    },
    {
      label: 'Tu cuenta', items: [
        { key: 'notificaciones', label: 'Notificaciones' },
      ]
    },
  ].filter(g => g.items.length > 0)

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1 className="settings-title">Configuración</h1>
      </div>

      <div className="settings-shell">
        <nav className="settings-subnav">
          {NAV_GROUPS.map(group => (
            <div className="settings-subnav-group" key={group.label}>
              <div className="settings-subnav-label">{group.label}</div>
              {group.items.map(item => (
                <button
                  key={item.key}
                  className={`settings-subnav-item ${activeTab === item.key ? 'active' : ''}`}
                  onClick={() => setActiveTab(item.key)}
                >
                  <span>{item.label}</span>
                  {item.badge > 0 && <span className="settings-tab-badge">{item.badge > 9 ? '9+' : item.badge}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Contenido según tab activo */}
        <div className="settings-content">
          {activeTab === 'usuarios' && canViewUsuarios && <TabUsuarios workspaceId={workspaceId} canManage={isOwner} />}
          {activeTab === 'proyectos' && showModuleTabs && <ModuloProyectos workspaceId={workspaceId} />}
          {activeTab === 'entidades' && showModuleTabs && <ModuloEntidades workspaceId={workspaceId} />}
          {activeTab === 'productos' && showModuleTabs && <ModuloProductos workspaceId={workspaceId} />}
          {activeTab === 'general' && isAdminOrOwner && <TabGeneral workspaceId={workspaceId} isOwner={isOwner} />}
          {activeTab === 'automatizaciones' && isAdminOrOwner && <TabAutomatizaciones workspaceId={workspaceId} isOwner={isOwner} />}
          {activeTab === 'soporte' && isAdminOrOwner && <TabSoporte workspaceId={workspaceId} isOwner={isOwner} />}
          {activeTab === 'notificaciones' && <TabNotificaciones workspaceId={workspaceId} />}
        </div>
      </div>
    </div>
  )
}

// ─── MÓDULOS (Proyectos / Entidades / Productos) ──────────────────────────────
// Cada módulo agrupa en un solo lugar todo lo que antes vivía repartido:
// su propia definición de tipos/estados + sus campos personalizados. La
// sub-navegación reusa el mismo widget de pastillas que ya usaban los
// selectores internos de objeto (`.settings-type-toggle`), un nivel más
// adentro.

function ModuloProyectos({ workspaceId }) {
  const [section, setSection] = useState('estados')
  return (
    <div>
      <div className="settings-type-toggle" style={{ marginBottom: 16 }}>
        <button className={`settings-toggle-btn ${section === 'estados' ? 'active' : ''}`} onClick={() => setSection('estados')}>Estados</button>
        <button className={`settings-toggle-btn ${section === 'financiero' ? 'active' : ''}`} onClick={() => setSection('financiero')}>Financiero</button>
        <button className={`settings-toggle-btn ${section === 'campos' ? 'active' : ''}`} onClick={() => setSection('campos')}>Campos</button>
      </div>
      {section === 'estados' && <TabEstados workspaceId={workspaceId} />}
      {section === 'financiero' && <TabFinanciero workspaceId={workspaceId} />}
      {section === 'campos' && <TabCamposPersonalizados workspaceId={workspaceId} objectType="negotiation" />}
    </div>
  )
}

// Financiero es parte fija de todo proyecto (como Contactos en Entidades) —
// no se prende/apaga por campo custom. Acá se elige, por workspace, qué
// piezas del módulo usar (ver src/lib/financialConfig.js). Lo que se apaga
// no borra datos ya cargados, solo deja de mostrarse.
function TabFinanciero({ workspaceId }) {
  const [config, setConfig] = useState(resolveFinancialConfig(null))
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchConfig() }, [workspaceId])

  async function fetchConfig() {
    const { data } = await supabase.from('workspaces').select('financial_config').eq('id', workspaceId).single()
    setConfig(resolveFinancialConfig(data?.financial_config))
    setLoading(false)
  }

  async function toggle(key) {
    const next = { ...config, [key]: !config[key] }
    setConfig(next)
    await supabase.from('workspaces').update({ financial_config: next }).eq('id', workspaceId)
  }

  if (loading) return <div className="settings-loading">Cargando...</div>

  return (
    <div className="settings-section">
      <div className="settings-block">
        <h2 className="settings-block-title">Financiero</h2>
        <p className="settings-hint">
          El tab Financiero está siempre disponible en todos los proyectos — acá elegís qué piezas usar. Moneda es la base de todo lo demás y siempre está activa. Lo que apagues no borra nada ya cargado, solo deja de mostrarse.
        </p>
        <div className="settings-table">
          {FINANCIAL_FEATURES.map(f => (
            <div key={f.key} className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-text">
                  <div className="settings-row-name">{f.label}</div>
                  <p className="settings-row-desc">{f.desc}</p>
                </div>
              </div>
              <label className="notif-pref-toggle">
                <input type="checkbox" checked={!!config[f.key]} onChange={() => toggle(f.key)} />
                <span className="notif-pref-slider" />
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ModuloEntidades({ workspaceId }) {
  const [section, setSection] = useState('tipos')
  return (
    <div>
      <div className="settings-type-toggle" style={{ marginBottom: 16 }}>
        <button className={`settings-toggle-btn ${section === 'tipos' ? 'active' : ''}`} onClick={() => setSection('tipos')}>Tipos de entidad</button>
        <button className={`settings-toggle-btn ${section === 'campos' ? 'active' : ''}`} onClick={() => setSection('campos')}>Campos</button>
      </div>
      {section === 'tipos' && <TabEntidades workspaceId={workspaceId} />}
      {section === 'campos' && <TabCamposPersonalizados workspaceId={workspaceId} objectType="entity" />}
    </div>
  )
}

function ModuloProductos({ workspaceId }) {
  const [section, setSection] = useState('tipos')
  return (
    <div>
      <div className="settings-type-toggle" style={{ marginBottom: 16 }}>
        <button className={`settings-toggle-btn ${section === 'tipos' ? 'active' : ''}`} onClick={() => setSection('tipos')}>Tipos de producto</button>
        <button className={`settings-toggle-btn ${section === 'campos' ? 'active' : ''}`} onClick={() => setSection('campos')}>Campos</button>
      </div>
      {section === 'tipos' && <TabProductos workspaceId={workspaceId} />}
      {section === 'campos' && <TabCamposPersonalizados workspaceId={workspaceId} objectType="product" />}
    </div>
  )
}

// ─── TAB USUARIOS ────────────────────────────────────────────────────────────

function TabUsuarios({ workspaceId, canManage }) {
  const { user: currentUser, isStaff, role } = useAuth()
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
  const [membershipLog, setMembershipLog] = useState([])
  const [showLog, setShowLog] = useState(false)
  const [requestNotice, setRequestNotice] = useState(null)

  useEffect(() => {
    fetchMembers()
    fetchInvitations()
    fetchMembershipLog()
  }, [workspaceId])

  async function fetchMembershipLog() {
    const { data } = await supabase
      .from('workspace_membership_log')
      .select('id, action, old_role, new_role, created_at, member:user_id ( full_name, email ), actor:performed_by ( full_name )')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (data) setMembershipLog(data)
  }

  async function fetchMembers() {
    const { data } = await supabase
      .from('workspace_members')
      .select(`user_id, role, status, profile:user_id ( full_name, email, avatar_url, avatar_preset )`)
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
    setRequestNotice(null)
    const member = members.find(m => m.user_id === userId)
    const targetName = member?.profile?.full_name || member?.profile?.email || 'un miembro'
    const { requested } = await withOwnerApproval(supabase, {
      isStaff, role, workspaceId, actionType: 'change_member_role',
      payload: { user_id: userId, new_role: newRole, description: `Cambiar el rol de ${targetName} a ${roleLabel(newRole)}` },
    }, async () => {
      await supabase.from('workspace_members').update({ role: newRole }).eq('workspace_id', workspaceId).eq('user_id', userId)
      await notifyRoleChanged(supabase, { workspaceId, userId, newRoleLabel: roleLabel(newRole), actingUserId: currentUser?.id })
    })
    if (requested) { setRequestNotice('Se mandó la solicitud al owner del workspace para que la apruebe.'); return }
    fetchMembers()
    fetchMembershipLog()
  }

  async function handleToggleStatus(member) {
    setRequestNotice(null)
    const newStatus = member.status === 'active' ? 'inactive' : 'active'
    const targetName = member?.profile?.full_name || member?.profile?.email || 'un miembro'
    const { requested } = await withOwnerApproval(supabase, {
      isStaff, role, workspaceId, actionType: 'toggle_member_status',
      payload: { user_id: member.user_id, new_status: newStatus, description: `${newStatus === 'active' ? 'Reactivar' : 'Desactivar'} a ${targetName}` },
    }, async () => {
      await supabase.from('workspace_members').update({ status: newStatus }).eq('workspace_id', workspaceId).eq('user_id', member.user_id)
    })
    if (requested) { setRequestNotice('Se mandó la solicitud al owner del workspace para que la apruebe.'); return }
    fetchMembers()
    fetchMembershipLog()
  }

  async function handleRemoveMember() {
    if (!confirmRemove) return
    setRequestNotice(null)
    const targetName = confirmRemove.profile?.full_name || confirmRemove.profile?.email || 'un miembro'
    const { requested } = await withOwnerApproval(supabase, {
      isStaff, role, workspaceId, actionType: 'remove_member',
      payload: { user_id: confirmRemove.user_id, description: `Eliminar a ${targetName} del workspace` },
    }, async () => {
      await supabase.from('workspace_members').delete().eq('workspace_id', workspaceId).eq('user_id', confirmRemove.user_id)
    })
    setConfirmRemove(null)
    if (requested) { setRequestNotice('Se mandó la solicitud al owner del workspace para que la apruebe.'); return }
    fetchMembers()
    fetchMembershipLog()
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
    if (data?.requested) {
      setInviteSuccess('Se mandó la solicitud al owner del workspace para que la apruebe.')
      setInviteEmail('')
      return
    }
    if (data?.direct) {
      setInviteSuccess(`${inviteEmail.trim()} ya tenía cuenta y se sumó directo al workspace.`)
      fetchMembers()
    } else if (data?.emailSent) {
      setInviteSuccess(`Invitación enviada por mail a ${inviteEmail.trim()}.`)
      setInviteLink(data?.inviteLink || null)
      fetchInvitations()
    } else {
      setInviteSuccess(`Invitación creada para ${inviteEmail.trim()}, pero no se pudo mandar el mail — copiá el link y mandáselo a mano.`)
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

  function membershipLogLabel(l) {
    const name = l.member?.full_name || l.member?.email || 'Usuario eliminado'
    switch (l.action) {
      case 'joined': return `${name} se sumó al workspace como ${roleLabel(l.new_role)}`
      case 'role_changed': return `${name} pasó de ${roleLabel(l.old_role)} a ${roleLabel(l.new_role)}`
      case 'deactivated': return `${name} fue desactivado`
      case 'reactivated': return `${name} fue reactivado`
      case 'removed': return `${name} fue eliminado del workspace (era ${roleLabel(l.old_role)})`
      default: return `${name} — ${l.action}`
    }
  }

  if (loading) return <div className="settings-loading">Cargando...</div>

  return (
    <div className="settings-section">

      {/* Lista de miembros activos */}
      <div className="settings-block">
        <div className="settings-block-header">
          <h2 className="settings-block-title">Miembros del workspace ({members.filter(m => m.status === 'active').length} activos)</h2>
          {canManage && (
            <button className="settings-btn-primary" onClick={() => setShowInviteForm(v => !v)}>
              + Invitar usuario
            </button>
          )}
        </div>

        {requestNotice && <p className="settings-success">{requestNotice}</p>}

        {/* Formulario de invitación */}
        {canManage && showInviteForm && (
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
            const isOwner = isOwnerRole(m.role)
            return (
              <div key={m.user_id} className={`settings-row ${m.status === 'inactive' ? 'settings-row--inactive' : ''}`}>
                <div className="settings-row-info">
                  <Avatar profile={m.profile} size={36} />
                  <div className="settings-row-text">
                    <div className="settings-row-name">
                      {m.profile?.full_name || 'Sin nombre'}
                      {m.status === 'inactive' && <span className="settings-inactive-badge">Desactivado</span>}
                    </div>
                    <div className="settings-row-email">{m.profile?.email}</div>
                  </div>
                </div>
                <div className="settings-row-actions">
                  {canManage ? (
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
                  ) : (
                    <span className="settings-role-readonly">{roleLabel(m.role)}</span>
                  )}
                  {canManage && !isOwner && !isSelf && (
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
                {canManage && (
                  <button className="settings-btn-danger" onClick={() => handleCancelInvitation(inv)}>
                    Cancelar
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historial de accesos — entradas/salidas de CUALQUIER miembro, no
          solo staff. Colapsado por default, no es algo que se mire seguido. */}
      <div className="settings-block">
        <div className="settings-block-header" style={{ cursor: 'pointer' }} onClick={() => setShowLog(v => !v)}>
          <h2 className="settings-block-title">Historial de accesos {showLog ? '▾' : '▸'}</h2>
        </div>
        {showLog && (
          membershipLog.length === 0 ? (
            <p className="settings-hint">Sin movimientos registrados todavía.</p>
          ) : (
            <div className="settings-table">
              {membershipLog.map(l => (
                <div key={l.id} className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-text">
                      <div className="settings-row-name">
                        {membershipLogLabel(l)}
                      </div>
                      <div className="settings-row-email">
                        {l.actor?.full_name ? `Por ${l.actor.full_name} · ` : ''}{new Date(l.created_at).toLocaleString('es-AR')}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>

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

// Estados vive exclusivamente bajo el módulo Proyectos — el pipeline de
// negociación es lo único que hoy consume `custom_states` en la app.
const STATES_OBJECT_TYPE = 'negotiation'

function TabEstados({ workspaceId }) {
  const [states, setStates] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#64748B')
  const [newBgColor, setNewBgColor] = useState('#F1F5F9')
  const [newIsTerminal, setNewIsTerminal] = useState(false)
  const [bgManual, setBgManual] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const objectType = STATES_OBJECT_TYPE
  const [editing, setEditing] = useState(null) // { id, name, color, bg_color, is_terminal }
  const [deleteError, setDeleteError] = useState(null)

  useEffect(() => {
    fetchStates()
  }, [])

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
    setDeleteError(null)
    setSaving(true)
    await supabase.from('custom_states').insert({
      workspace_id: workspaceId,
      object_type: objectType,
      name: newName.trim(),
      color: newColor,
      bg_color: newBgColor,
      sort_order: states.length,
      is_terminal: newIsTerminal,
    })
    setNewName('')
    setNewColor('#64748B')
    setNewBgColor('#F1F5F9')
    setNewIsTerminal(false)
    setSaving(false)
    fetchStates()
  }

  async function handleSaveEdit() {
    if (!editing?.name?.trim()) return
    const original = states.find(s => s.id === editing.id)
    const newName = editing.name.trim()
    // Si se le está sacando el flag "final" y era el único, no lo dejamos
    // sin ninguno — la app depende de que exista al menos un estado
    // terminal (cuenta de "completados", exclusión de las alertas de
    // inactividad, etc.)
    if (original?.is_terminal && !editing.is_terminal && states.filter(s => s.is_terminal).length === 1) {
      setDeleteError('Tiene que quedar al menos un estado marcado como "final".')
      return
    }
    setDeleteError(null)
    await supabase.from('custom_states').update({
      name: newName, color: editing.color, bg_color: editing.bg_color, is_terminal: editing.is_terminal,
    }).eq('id', editing.id)
    // El estado se guarda como texto libre en negotiations.status (matcheo
    // por nombre, no por id) — si el label cambió, hay que actualizar en
    // cascada los proyectos existentes o quedan "huérfanos" (sin matchear
    // ningún estado configurado).
    if (objectType === 'negotiation' && original && original.name !== newName) {
      await supabase.from('negotiations').update({ status: newName }).eq('workspace_id', workspaceId).eq('status', original.name)
    }
    setEditing(null)
    fetchStates()
  }

  const [confirmDeleteState, setConfirmDeleteState] = useState(null)

  function requestDelete(s) {
    if (s.is_terminal && states.filter(st => st.is_terminal).length === 1) {
      setDeleteError('No se puede eliminar: tiene que quedar al menos un estado marcado como "final".')
      return
    }
    setDeleteError(null)
    setConfirmDeleteState(s.id)
  }

  async function handleDelete(id) {
    await supabase.from('custom_states').delete().eq('id', id)
    setConfirmDeleteState(null)
    fetchStates()
  }

  return (
    <div className="settings-section">
      <div className="settings-block">
        <div className="settings-block-header">
          <h2 className="settings-block-title">Estados de proyecto</h2>
        </div>

        <p className="settings-hint">
          "Final" marca qué estado(s) cuentan como proyecto cerrado — se usa para las estadísticas de completados y para que un proyecto en ese estado no dispare las alertas de inactividad. Tiene que quedar siempre al menos uno marcado.
        </p>
        {deleteError && <p className="form-error">{deleteError}</p>}

        {loading ? <div className="settings-loading">Cargando...</div> : (
          <div className="settings-table">
            {states.map(s => {
              const isEditing = editing?.id === s.id
              return (
                <div key={s.id} className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  {isEditing ? (
                    <>
                      <div className="settings-row-info" style={{ flex: 1, flexWrap: 'wrap', gap: 8 }}>
                        <input
                          className="state-name-input"
                          style={{ maxWidth: 180 }}
                          value={editing.name}
                          onChange={e => setEditing(ed => ({ ...ed, name: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit() }
                            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null) }
                          }}
                          autoFocus
                        />
                        <div className="state-color-palette">
                          {PRESET_COLORS.map(p => (
                            <button
                              key={p.color}
                              type="button"
                              className={`state-palette-swatch ${editing.color === p.color ? 'selected' : ''}`}
                              style={{ backgroundColor: p.color }}
                              onClick={() => setEditing(ed => ({ ...ed, color: p.color, bg_color: p.bg }))}
                              title={p.color}
                            />
                          ))}
                        </div>
                        <span className="state-badge-preview" style={{ backgroundColor: editing.bg_color, color: editing.color }}>
                          {editing.name || 'Vista previa'}
                        </span>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={!!editing.is_terminal}
                            onChange={e => setEditing(ed => ({ ...ed, is_terminal: e.target.checked }))}
                          />
                          Estado final
                        </label>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="settings-btn-primary" onClick={handleSaveEdit}>Guardar</button>
                        <button className="settings-btn-secondary" onClick={() => { setEditing(null); setDeleteError(null) }}>Cancelar</button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="settings-row-info">
                        <div className="state-color-dot" style={{ backgroundColor: s.color }} />
                        <span
                          className="state-badge-preview"
                          style={{ backgroundColor: s.bg_color, color: s.color }}
                        >
                          {s.name}
                        </span>
                        {s.is_terminal && (
                          <span className="settings-state-protected" title="Estado final — cuenta como proyecto cerrado">🏁 Final</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button className="settings-btn-secondary" onClick={() => { setEditing({ id: s.id, name: s.name, color: s.color, bg_color: s.bg_color, is_terminal: s.is_terminal }); setDeleteError(null) }}>
                          Editar
                        </button>
                        {confirmDeleteState === s.id ? (
                          <div className="delete-confirm-inline">
                            <span>¿Seguro?</span>
                            <button className="settings-btn-danger" onClick={() => handleDelete(s.id)}>Sí</button>
                            <button className="settings-btn-secondary" onClick={() => setConfirmDeleteState(null)}>No</button>
                          </div>
                        ) : (
                          <button className="settings-btn-danger" onClick={() => requestDelete(s)}>Eliminar</button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Formulario para agregar nuevo estado */}
        <div className="state-add-form">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNewName('') }
            }}
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
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13 }}>
            <input type="checkbox" checked={newIsTerminal} onChange={e => setNewIsTerminal(e.target.checked)} />
            Estado final
          </label>
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
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit() }
                          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null) }
                        }}
                        placeholder="Singular"
                        autoFocus
                      />
                      <input
                        className="state-name-input"
                        style={{ maxWidth: 160 }}
                        value={editing.plural || ''}
                        onChange={e => setEditing(ed => ({ ...ed, plural: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit() }
                          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null) }
                        }}
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
            onKeyDown={e => {
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNewName(''); setNewPlural('') }
            }}
          />
          <input
            type="text"
            value={newPlural}
            onChange={e => setNewPlural(e.target.value)}
            placeholder="Plural (ej: Forwarders)"
            className="state-name-input"
            style={{ maxWidth: 180 }}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNewName(''); setNewPlural('') }
            }}
          />
          <button className="settings-btn-primary" onClick={handleAdd} disabled={saving}>
            + Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TAB TIPOS DE PRODUCTO ────────────────────────────────────────────────────

function TabProductos({ workspaceId }) {
  const [productTypes, setProductTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newPlural, setNewPlural] = useState('')
  const [newIcon, setNewIcon] = useState('Package')
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
    fetchProductTypes()
  }, [workspaceId])

  async function fetchProductTypes() {
    setLoading(true)
    const { data } = await supabase
      .from('product_types')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('sort_order')
    if (data) setProductTypes(data)
    setLoading(false)
  }

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true)
    await supabase.from('product_types').insert({
      workspace_id: workspaceId,
      name: newName.trim(),
      plural: newPlural.trim() || null,
      icon: newIcon,
      sort_order: productTypes.length,
    })
    setNewName('')
    setNewPlural('')
    setNewIcon('Package')
    setSaving(false)
    fetchProductTypes()
  }

  async function handleSaveEdit() {
    if (!editing?.name?.trim()) return
    await supabase.from('product_types').update({
      name: editing.name.trim(),
      plural: editing.plural?.trim() || null,
      icon: editing.icon,
    }).eq('id', editing.id)
    setEditing(null)
    fetchProductTypes()
  }

  async function handleDelete(id) {
    await supabase.from('product_types').delete().eq('id', id)
    setConfirmDelete(null)
    fetchProductTypes()
  }

  return (
    <div className="settings-section">
      <div className="settings-block">
        <div className="settings-block-header">
          <h2 className="settings-block-title">Tipos de producto</h2>
        </div>

        <p className="settings-hint">
          Cada tipo genera una sección en el sidebar. Al eliminar un tipo se eliminan todos los productos asociados.
        </p>

        {loading ? <div className="settings-loading">Cargando...</div> : (
          <div className="settings-table">
            {productTypes.map(pt => (
              <div key={pt.id} className="settings-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {editing?.id === pt.id ? (
                  // Modo edición inline
                  <>
                    <div className="settings-row-info" style={{ flex: 1, flexWrap: 'wrap', gap: 8 }}>
                      <div style={{ position: 'relative' }} ref={iconPickerRef}>
                        <button
                          type="button"
                          className="icon-picker-trigger"
                          onClick={() => setShowIconPicker(v => !v)}
                          title="Cambiar ícono"
                        >
                          <EntityIcon name={editing.icon || 'Package'} size={18} />
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
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit() }
                          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null) }
                        }}
                        placeholder="Singular"
                        autoFocus
                      />
                      <input
                        className="state-name-input"
                        style={{ maxWidth: 160 }}
                        value={editing.plural || ''}
                        onChange={e => setEditing(ed => ({ ...ed, plural: e.target.value }))}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit() }
                          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null) }
                        }}
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
                      {pt.icon && <span className="entity-type-icon-preview"><EntityIcon name={pt.icon} size={16} /></span>}
                      <div>
                        <div className="settings-row-name">{pt.name}</div>
                        {pt.plural && <div className="settings-row-email">plural: {pt.plural}</div>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="settings-btn-secondary" onClick={() => setEditing({ id: pt.id, name: pt.name, plural: pt.plural || '', icon: pt.icon })}>
                        Editar
                      </button>
                      {confirmDelete === pt.id ? (
                        <div className="delete-confirm-inline">
                          <span>¿Eliminar con todos sus datos?</span>
                          <button className="settings-btn-danger" onClick={() => handleDelete(pt.id)}>Sí, eliminar</button>
                          <button className="settings-btn-secondary" onClick={() => setConfirmDelete(null)}>Cancelar</button>
                        </div>
                      ) : (
                        <button className="settings-btn-danger" onClick={() => setConfirmDelete(pt.id)}>Eliminar</button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="state-add-form" style={{ flexWrap: 'wrap', gap: 10 }}>
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
            placeholder="Singular (ej: API)"
            className="state-name-input"
            onKeyDown={e => {
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNewName(''); setNewPlural('') }
            }}
          />
          <input
            type="text"
            value={newPlural}
            onChange={e => setNewPlural(e.target.value)}
            placeholder="Plural (ej: APIs)"
            className="state-name-input"
            style={{ maxWidth: 180 }}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setNewName(''); setNewPlural('') }
            }}
          />
          <button className="settings-btn-primary" onClick={handleAdd} disabled={saving}>
            + Agregar
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TAB CAMPOS PERSONALIZADOS ────────────────────────────────────────────────

const FIELD_TYPES = [
  { key: 'text', label: 'Texto libre' },
  { key: 'textarea', label: 'Texto largo' },
  { key: 'number', label: 'Numérico' },
  { key: 'date', label: 'Fecha' },
  { key: 'boolean', label: 'Casilla (sí/no)' },
  { key: 'select', label: 'Lista desplegable' },
  { key: 'multiselect', label: 'Selección múltiple' },
  { key: 'country', label: 'País' },
  { key: 'user', label: 'Usuario del workspace' },
  { key: 'link', label: 'Link' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Teléfono' },
  { key: 'tracked', label: 'Campo con seguimiento' },
]

// Tipos especiales (solo sembrados por SQL, nunca elegibles acá) — con
// label propio para que el listado de Settings no muestre la key cruda.
const SPECIAL_FIELD_TYPE_LABELS = {
  entity_type: 'Tipo de entidad', status: 'Estado del proyecto',
  entities_link: 'Entidades vinculadas', financial: 'Financiero', contacts: 'Contactos',
  product_type: 'Tipo de producto', product_entity: 'Proveedor del producto', products_link: 'Productos vinculados',
}

function fieldTypeLabel(key) {
  return FIELD_TYPES.find(t => t.key === key)?.label || SPECIAL_FIELD_TYPE_LABELS[key] || key
}

function genFieldKey() {
  return `cf_${Math.random().toString(36).slice(2, 10)}`
}

function genChoiceId() {
  return `opt_${Math.random().toString(36).slice(2, 8)}`
}

// Editor de opciones (para select/multiselect, y para tracked con
// underlying_type='select') — reusado en el alta y en la edición inline.
function ChoicesEditor({ choices, onChange }) {
  const [input, setInput] = useState('')

  function add() {
    const label = input.trim()
    if (!label) return
    onChange([...(choices || []), { id: genChoiceId(), label }])
    setInput('')
  }

  function remove(id) {
    onChange(choices.filter(c => c.id !== id))
  }

  function rename(id, label) {
    onChange(choices.map(c => c.id === id ? { ...c, label } : c))
  }

  return (
    <div className="cf-choices-editor">
      {(choices || []).map(c => (
        <div key={c.id} className="cf-choice-row">
          <input className="state-name-input" value={c.label} onChange={e => rename(c.id, e.target.value)} />
          <button type="button" className="cf-choice-remove" onClick={() => remove(c.id)}>✕</button>
        </div>
      ))}
      <div className="cf-choice-row">
        <input
          className="state-name-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Nueva opción..."
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
        />
        <button type="button" className="settings-btn-secondary" onClick={add}>+ Agregar</button>
      </div>
    </div>
  )
}

function TabCamposPersonalizados({ workspaceId, objectType }) {
  const [fields, setFields] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [saving, setSaving] = useState(false)

  const [newLabel, setNewLabel] = useState('')
  const [newType, setNewType] = useState('text')
  const [newChoices, setNewChoices] = useState([])
  const [newUnderlyingType, setNewUnderlyingType] = useState('select')
  const [newTriggerMode, setNewTriggerMode] = useState('deadline')
  const [newAlertDays, setNewAlertDays] = useState(30)
  const [newCountryMultiple, setNewCountryMultiple] = useState(false)
  const [newCountryShowFlag, setNewCountryShowFlag] = useState(true)
  const [newRequired, setNewRequired] = useState(false)
  const [fieldOrder, setFieldOrder] = useState(null)
  const [dragSrc, setDragSrc] = useState(null)
  const [dragOver, setDragOver] = useState(null)

  useEffect(() => { fetchFields() }, [objectType, workspaceId])
  useEffect(() => { fetchFieldOrder() }, [workspaceId])

  async function fetchFieldOrder() {
    const { data } = await supabase.from('workspaces').select('field_order').eq('id', workspaceId).single()
    setFieldOrder(data?.field_order || {})
  }

  // "Contactos" (Entidades) queda fijo al final de la lista, no se
  // arrastra a mitad de camino — mismo motivo que en el formulario de
  // alta: es un sub-formulario repetible, no un valor simple.
  const orderableFields = fields.filter(f => f.field_type !== 'contacts')
  const pinnedField = fields.find(f => f.field_type === 'contacts')
  const orderedKeys = fieldOrder === null
    ? orderableFields.map(f => f.key)
    : computeFieldOrder(objectType, fieldOrder, orderableFields)

  async function persistOrder(newOrderedKeys) {
    const updated = { ...(fieldOrder || {}), [objectType]: newOrderedKeys }
    setFieldOrder(updated)
    await supabase.from('workspaces').update({ field_order: updated }).eq('id', workspaceId)
  }

  function handleDragStart(e, idx) {
    setDragSrc(idx)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragOver(e, idx) {
    e.preventDefault()
    setDragOver(idx)
  }

  function handleDrop(idx) {
    if (dragSrc === null || dragSrc === idx) { setDragSrc(null); setDragOver(null); return }
    const next = [...orderedKeys]
    const [moved] = next.splice(dragSrc, 1)
    next.splice(idx, 0, moved)
    persistOrder(next)
    setDragSrc(null)
    setDragOver(null)
  }

  async function fetchFields() {
    setLoading(true)
    const { data } = await supabase
      .from('custom_field_definitions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('object_type', objectType)
      .order('sort_order')
    if (data) setFields(data)
    setLoading(false)
  }

  function resetForm() {
    setNewLabel(''); setNewType('text'); setNewChoices([])
    setNewUnderlyingType('select'); setNewTriggerMode('deadline'); setNewAlertDays(30)
    setNewCountryMultiple(false); setNewCountryShowFlag(true); setNewRequired(false)
  }

  function buildOptions(type, underlyingType, choices, triggerMode, alertDays, countryMultiple, countryShowFlag) {
    if (type === 'select' || type === 'multiselect') return { choices }
    if (type === 'country') return { multiple: countryMultiple, show_flag: countryShowFlag }
    if (type === 'tracked') {
      const opts = { underlying_type: underlyingType, trigger_mode: triggerMode, alert_days: Number(alertDays) || 30 }
      if (underlyingType === 'select') opts.choices = choices
      return opts
    }
    return {}
  }

  async function handleAdd() {
    if (!newLabel.trim()) return
    setSaving(true)
    await supabase.from('custom_field_definitions').insert({
      workspace_id: workspaceId,
      object_type: objectType,
      key: genFieldKey(),
      label: newLabel.trim(),
      field_type: newType,
      options: buildOptions(newType, newUnderlyingType, newChoices, newTriggerMode, newAlertDays, newCountryMultiple, newCountryShowFlag),
      required: newRequired,
      sort_order: fields.length,
    })
    resetForm()
    setSaving(false)
    fetchFields()
  }

  async function handleSaveEdit() {
    if (!editing?.label?.trim()) return
    // Tarjetas de filtro: solo un campo por object_type puede tenerlo activo
    // (mismo criterio que Estado en Proyectos o Tipo de producto en
    // Productos, pero acá es elegible a mano en vez de fijo por field_type).
    if (editing.card_filter) {
      const others = fields.filter(f => f.id !== editing.id && f.card_filter).map(f => f.id)
      if (others.length > 0) {
        await supabase.from('custom_field_definitions').update({ card_filter: false }).in('id', others)
      }
    }
    await supabase.from('custom_field_definitions').update({
      label: editing.label.trim(),
      options: editing.options,
      required: editing.required,
      card_filter: !!editing.card_filter,
    }).eq('id', editing.id)
    setEditing(null)
    fetchFields()
  }

  async function handleDelete(id) {
    await supabase.from('custom_field_definitions').delete().eq('id', id)
    setConfirmDelete(null)
    fetchFields()
  }

  function renderFieldRow(f, idx, draggable) {
    const isEditing = editing?.id === f.id
    const hasChoices = f.field_type === 'select' || f.field_type === 'multiselect'
    const dragProps = draggable ? {
      draggable: true,
      onDragStart: e => handleDragStart(e, idx),
      onDragOver: e => handleDragOver(e, idx),
      onDrop: () => handleDrop(idx),
      onDragEnd: () => { setDragSrc(null); setDragOver(null) },
    } : {}
    return (
      <div
        key={f.key}
        className={`settings-row cf-reorder-row ${draggable ? '' : 'cf-reorder-row--pinned'} ${dragOver === idx ? 'drag-over' : ''}`}
        style={{ flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}
        {...dragProps}
      >
        {draggable && <span className="col-drag-handle">⠿</span>}
        {isEditing ? (
          <>
            <div className="settings-row-info" style={{ flex: 1, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
              <input
                className="state-name-input"
                value={editing.label}
                onChange={e => setEditing(ed => ({ ...ed, label: e.target.value }))}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); handleSaveEdit() }
                  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null) }
                }}
                autoFocus
              />
              {hasChoices && (
                <ChoicesEditor
                  choices={editing.options.choices || []}
                  onChange={choices => setEditing(ed => ({ ...ed, options: { ...ed.options, choices } }))}
                />
              )}
              {f.field_type === 'country' && (
                <div className="cf-tracked-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={!!editing.options.show_flag}
                      onChange={e => setEditing(ed => ({ ...ed, options: { ...ed.options, show_flag: e.target.checked } }))}
                    /> Mostrar banderita
                  </label>
                </div>
              )}
              {f.field_type === 'tracked' && (
                <>
                  {editing.options.underlying_type === 'select' && (
                    <ChoicesEditor
                      choices={editing.options.choices || []}
                      onChange={choices => setEditing(ed => ({ ...ed, options: { ...ed.options, choices } }))}
                    />
                  )}
                  <div className="cf-tracked-row">
                    <label>Avisar con</label>
                    <input
                      type="number" min="1" className="state-name-input" style={{ maxWidth: 80 }}
                      value={editing.options.alert_days}
                      onChange={e => setEditing(ed => ({ ...ed, options: { ...ed.options, alert_days: e.target.value } }))}
                    />
                    <span>días de {editing.options.trigger_mode === 'deadline' ? 'anticipación' : 'inactividad'}</span>
                  </div>
                </>
              )}
              {f.field_type !== 'contacts' && (
                <div className="cf-tracked-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={f.is_structural ? true : !!editing.required}
                      disabled={f.is_structural}
                      onChange={e => setEditing(ed => ({ ...ed, required: e.target.checked }))}
                    /> Obligatorio
                  </label>
                </div>
              )}
              {isCardFilterable(f) && (
                <div className="cf-tracked-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <label style={{ minWidth: 0 }}>
                    <input
                      type="checkbox"
                      checked={!!editing.card_filter}
                      onChange={e => setEditing(ed => ({ ...ed, card_filter: e.target.checked }))}
                    /> Usar como tarjetas de filtro
                  </label>
                  <span className="cf-hint">Un solo campo por sección puede tener esto activo — al elegir uno se desactiva en cualquier otro</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="settings-btn-primary" onClick={handleSaveEdit}>Guardar</button>
              <button className="settings-btn-secondary" onClick={() => setEditing(null)}>Cancelar</button>
            </div>
          </>
        ) : (
          <>
            <div className="settings-row-info">
              <div>
                <div className="settings-row-name">{f.label}{f.required && ' *'}</div>
                <div className="settings-row-email">
                  {fieldTypeLabel(f.field_type)}
                  {f.is_structural && ' · campo base'}
                  {f.field_type === 'tracked' && ` · ${f.options.trigger_mode === 'deadline' ? 'fecha límite' : 'inactividad'}, ${f.options.alert_days} días`}
                  {f.field_type === 'country' && f.options.multiple && ' · varios países'}
                  {f.required && ' · obligatorio'}
                  {f.card_filter && ' · tarjetas de filtro'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="settings-btn-secondary" onClick={() => setEditing({ id: f.id, label: f.label, options: f.options, required: f.required, card_filter: f.card_filter })}>
                Editar
              </button>
              {!f.is_structural && (
                confirmDelete === f.id ? (
                  <div className="delete-confirm-inline">
                    <span>¿Seguro?</span>
                    <button className="settings-btn-danger" onClick={() => handleDelete(f.id)}>Sí</button>
                    <button className="settings-btn-secondary" onClick={() => setConfirmDelete(null)}>No</button>
                  </div>
                ) : (
                  <button className="settings-btn-danger" onClick={() => setConfirmDelete(f.id)}>Eliminar</button>
                )
              )}
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="settings-section">
      <div className="settings-block">
        <div className="settings-block-header">
          <h2 className="settings-block-title">Campos personalizados</h2>
        </div>

        <p className="settings-hint">
          El nombre de cada campo es libre — vos decidís cómo llamarlo, el tipo define cómo se guarda y se muestra.
          Eliminar un campo no borra los valores ya cargados, solo deja de mostrarlo.
        </p>

        {loading ? <div className="settings-loading">Cargando...</div> : (
          <div className="settings-table">
            <p className="settings-hint" style={{ marginBottom: 6 }}>Arrastrá para reordenar cómo se ven en el formulario de alta.</p>
            {orderedKeys.map((key, idx) => {
              const f = orderableFields.find(x => x.key === key)
              if (!f) return null
              return renderFieldRow(f, idx, true)
            })}
            {pinnedField && renderFieldRow(pinnedField, null, false)}
          </div>
        )}

        <div className="state-add-form" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); handleAdd() }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); resetForm() }
              }}
              placeholder="Nombre del campo..."
              className="state-name-input"
            />
            <select className="neg-select" value={newType} onChange={e => setNewType(e.target.value)}>
              {FIELD_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>

          {(newType === 'select' || newType === 'multiselect') && (
            <ChoicesEditor choices={newChoices} onChange={setNewChoices} />
          )}

          {newType === 'country' && (
            <div className="cf-tracked-config">
              <div className="cf-tracked-row">
                <label><input type="checkbox" checked={newCountryMultiple} onChange={e => setNewCountryMultiple(e.target.checked)} /> Permite varios países</label>
              </div>
              <div className="cf-tracked-row">
                <label><input type="checkbox" checked={newCountryShowFlag} onChange={e => setNewCountryShowFlag(e.target.checked)} /> Mostrar banderita</label>
              </div>
            </div>
          )}

          {newType === 'tracked' && (
            <div className="cf-tracked-config">
              <div className="cf-tracked-row">
                <label>Valor del campo</label>
                <select className="neg-select" value={newUnderlyingType} onChange={e => setNewUnderlyingType(e.target.value)}>
                  <option value="select">Lista desplegable</option>
                  <option value="text">Texto</option>
                  <option value="date">Fecha</option>
                </select>
              </div>
              {newUnderlyingType === 'select' && (
                <ChoicesEditor choices={newChoices} onChange={setNewChoices} />
              )}
              <div className="cf-tracked-row">
                <label>Disparador</label>
                <select className="neg-select" value={newTriggerMode} onChange={e => setNewTriggerMode(e.target.value)}>
                  <option value="deadline">Fecha límite (avisa antes de vencer)</option>
                  <option value="inactivity">Inactividad (avisa si no cambia)</option>
                </select>
              </div>
              <div className="cf-tracked-row">
                <label>Avisar con</label>
                <input type="number" min="1" className="state-name-input" style={{ maxWidth: 80 }} value={newAlertDays} onChange={e => setNewAlertDays(e.target.value)} />
                <span>días de {newTriggerMode === 'deadline' ? 'anticipación' : 'inactividad'}</span>
              </div>
            </div>
          )}

          <div className="cf-tracked-row">
            <label><input type="checkbox" checked={newRequired} onChange={e => setNewRequired(e.target.checked)} /> Obligatorio</label>
          </div>

          <button className="settings-btn-primary" style={{ alignSelf: 'flex-start' }} onClick={handleAdd} disabled={saving}>
            + Agregar campo
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── TAB GENERAL ──────────────────────────────────────────────────────────────
// Lo básico del workspace: nombre + alertas de inactividad. Antes vivía
// junto con reglas de autorización y todo lo de soporte en una sola
// pestaña "Workspace" que se había vuelto un cajón de sastre — separado
// a pedido del usuario (2026-08-23).

function TabGeneral({ workspaceId, isOwner }) {
  const { refreshWorkspaces, isStaff, role } = useAuth()
  const [workspace, setWorkspace] = useState(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [alertDays, setAlertDays] = useState('')
  const [inactiveDays, setInactiveDays] = useState('')
  const [activityError, setActivityError] = useState('')
  const [savingActivity, setSavingActivity] = useState(false)
  const [savedActivity, setSavedActivity] = useState(false)
  const [requestNotice, setRequestNotice] = useState(null)

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
      setAlertDays(String(data.low_activity_alert_days ?? 90))
      setInactiveDays(String(data.low_activity_inactive_days ?? 120))
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

  // Mismo criterio que el check de la base (workspaces_low_activity_days_check)
  // — se valida acá también para dar el error al toque, sin esperar el
  // viaje a la base.
  async function handleSaveActivityLimits() {
    setActivityError('')
    const alert = parseInt(alertDays, 10)
    const inactive = parseInt(inactiveDays, 10)
    if (!Number.isInteger(alert) || alert <= 0) { setActivityError('El aviso tiene que ser un número mayor a 0'); return }
    if (!Number.isInteger(inactive) || inactive <= alert) { setActivityError('El límite de "inactivo" tiene que ser mayor al del aviso'); return }
    setSavingActivity(true)
    let saveError = null
    const { requested } = await withOwnerApproval(supabase, {
      isStaff, role, workspaceId, actionType: 'update_inactivity_alerts',
      payload: { low_activity_alert_days: alert, low_activity_inactive_days: inactive, description: `Cambiar alertas de inactividad a ${alert}/${inactive} días` },
    }, async () => {
      const { error } = await supabase
        .from('workspaces')
        .update({ low_activity_alert_days: alert, low_activity_inactive_days: inactive })
        .eq('id', workspaceId)
      saveError = error
    })
    setSavingActivity(false)
    if (requested) { setRequestNotice('Se mandó la solicitud al owner del workspace para que la apruebe.'); return }
    if (saveError) { setActivityError('No se pudo guardar. Intentá de nuevo.'); return }
    setSavedActivity(true)
    await refreshWorkspaces()
    setTimeout(() => setSavedActivity(false), 2000)
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

      {isOwner && (
        <div className="settings-block">
          <h2 className="settings-block-title">Alertas de inactividad</h2>
          <p className="settings-hint">
            Pasados los días de "aviso", un proyecto activo sin novedades aparece en el banner de baja actividad. Pasados los días de "inactivo", se marca inactivo solo y aparece en su propio aviso. Solo el owner puede cambiar estos dos números.
          </p>
          <div className="form-row">
            <div className="form-group" style={{ maxWidth: 180 }}>
              <label>AVISO (DÍAS)</label>
              <input type="number" min="1" value={alertDays} onChange={e => setAlertDays(e.target.value)} />
            </div>
            <div className="form-group" style={{ maxWidth: 180 }}>
              <label>INACTIVO (DÍAS)</label>
              <input type="number" min="1" value={inactiveDays} onChange={e => setInactiveDays(e.target.value)} />
            </div>
          </div>
          {requestNotice && <p className="settings-success">{requestNotice}</p>}
          {activityError && <p className="form-error">{activityError}</p>}
          <button className="settings-btn-primary" onClick={handleSaveActivityLimits} disabled={savingActivity}>
            {savingActivity ? 'Guardando...' : savedActivity ? '✓ Guardado' : 'Guardar cambios'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── TAB AUTOMATIZACIONES ─────────────────────────────────────────────────────
// Gobernanza de negocio — hoy solo reglas de autorización, pensada para
// que sea donde vaya cayendo lo que se sume en esa línea más adelante.

function TabAutomatizaciones({ workspaceId, isOwner }) {
  const { refreshWorkspaces, isStaff, role } = useAuth()
  const [members, setMembers] = useState([])
  const [rules, setRules] = useState([])
  const [rulesError, setRulesError] = useState('')
  const [savingRules, setSavingRules] = useState(false)
  const [savedRules, setSavedRules] = useState(false)
  const [requestNotice, setRequestNotice] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchMembers()
    fetchRules()
  }, [workspaceId])

  async function fetchMembers() {
    const { data } = await supabase
      .from('workspace_members')
      .select('user_id, profile:user_id ( full_name )')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
    if (data) setMembers(data)
  }

  async function fetchRules() {
    const { data } = await supabase.from('approval_rules').select('*').eq('workspace_id', workspaceId)
    setRules(
      APPROVAL_RULE_TYPES.map(t => {
        const existing = (data ?? []).find(r => r.rule_type === t.key)
        return {
          rule_type: t.key,
          enabled: existing?.enabled ?? false,
          approver_id: existing?.approver_id ?? '',
          threshold_numeric: existing?.threshold_numeric !== null && existing?.threshold_numeric !== undefined ? String(existing.threshold_numeric) : '',
        }
      })
    )
    setLoading(false)
  }

  function updateRule(ruleType, patch) {
    setRules(prev => prev.map(r => r.rule_type === ruleType ? { ...r, ...patch } : r))
  }

  async function handleSaveRules() {
    setRulesError('')
    for (const r of rules) {
      if (r.enabled && !r.approver_id) {
        setRulesError(`"${APPROVAL_RULE_TYPES.find(t => t.key === r.rule_type)?.label}" necesita un aprobador para poder activarse`)
        return
      }
    }
    setSavingRules(true)
    let saveError = null
    const { requested } = await withOwnerApproval(supabase, {
      isStaff, role, workspaceId, actionType: 'update_approval_rules',
      payload: {
        rules: rules.map(r => ({
          rule_type: r.rule_type,
          enabled: r.enabled,
          approver_id: r.approver_id || null,
          threshold_numeric: r.threshold_numeric.trim() ? parseFloat(r.threshold_numeric) : null,
        })),
        description: 'Actualizar reglas de autorización',
      },
    }, async () => {
      const { error } = await supabase.from('approval_rules').upsert(
        rules.map(r => ({
          workspace_id: workspaceId,
          rule_type: r.rule_type,
          enabled: r.enabled,
          approver_id: r.approver_id || null,
          threshold_numeric: r.threshold_numeric.trim() ? parseFloat(r.threshold_numeric) : null,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'workspace_id,rule_type' }
      )
      saveError = error
    })
    setSavingRules(false)
    if (requested) { setRequestNotice('Se mandó la solicitud al owner del workspace para que la apruebe.'); return }
    if (saveError) { setRulesError('No se pudo guardar. Intentá de nuevo.'); return }
    setSavedRules(true)
    await refreshWorkspaces()
    setTimeout(() => setSavedRules(false), 2000)
  }

  if (loading) return <div className="settings-loading">Cargando...</div>

  return (
    <div className="settings-section">
      {isOwner && (
        <div className="settings-block">
          <h2 className="settings-block-title">Reglas de autorización</h2>
          <p className="settings-hint">
            Cada regla es independiente — activá solo las que te sirvan. Ninguna bloquea el trabajo del equipo: cuando algo queda pendiente, se marca y se le avisa a la persona designada, pero se puede seguir usando con normalidad mientras se resuelve. Sin aprobador designado, la regla no se puede activar. Solo el owner puede cambiar esto.
          </p>
          <div className="approval-rules-list">
            {rules.map(r => {
              const def = APPROVAL_RULE_TYPES.find(t => t.key === r.rule_type)
              if (!def) return null
              return (
                <div key={r.rule_type} className="approval-rule-row">
                  <label className="approval-rule-toggle">
                    <input
                      type="checkbox"
                      checked={r.enabled}
                      onChange={e => updateRule(r.rule_type, { enabled: e.target.checked })}
                    />
                    <span>{def.label}</span>
                  </label>
                  {r.enabled && (
                    <div className="approval-rule-config">
                      <div className="form-group" style={{ maxWidth: 240 }}>
                        <label>APROBADOR</label>
                        <select value={r.approver_id} onChange={e => updateRule(r.rule_type, { approver_id: e.target.value })}>
                          <option value="">Sin designar</option>
                          {members.map(m => (
                            <option key={m.user_id} value={m.user_id}>{m.profile?.full_name || 'Sin nombre'}</option>
                          ))}
                        </select>
                      </div>
                      {def.hasThreshold && (
                        <div className="form-group" style={{ maxWidth: 260 }}>
                          <label>{def.thresholdLabel}</label>
                          <input
                            type="number" min="0" max={def.thresholdMax || undefined} step="0.01"
                            value={r.threshold_numeric}
                            onChange={e => updateRule(r.rule_type, { threshold_numeric: e.target.value })}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {requestNotice && <p className="settings-success">{requestNotice}</p>}
          {rulesError && <p className="form-error">{rulesError}</p>}
          <button className="settings-btn-primary" onClick={handleSaveRules} disabled={savingRules}>
            {savingRules ? 'Guardando...' : savedRules ? '✓ Guardado' : 'Guardar cambios'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── TAB SOPORTE ──────────────────────────────────────────────────────────────
// Todo lo que involucra al equipo de Nerva: solicitudes de staff
// pendientes de aprobar + acceso de soporte. Antes mezclado con lo demás
// en "Workspace" — separado porque es un tipo de acción distinto (no es
// configuración del negocio, es dejar entrar a alguien de afuera).

function TabSoporte({ workspaceId, isOwner }) {
  const [grants, setGrants] = useState([])
  const [showGrantForm, setShowGrantForm] = useState(false)
  const [grantRole, setGrantRole] = useState('admin')
  const [grantDuration, setGrantDuration] = useState('24')
  const [grantIsTicket, setGrantIsTicket] = useState(false)
  const [grantProblem, setGrantProblem] = useState('')
  const [creatingGrant, setCreatingGrant] = useState(false)
  const [grantError, setGrantError] = useState('')
  const [lastCode, setLastCode] = useState(null)
  const [revokingGrantId, setRevokingGrantId] = useState(null)
  const [revokeMessage, setRevokeMessage] = useState('')
  const [staffRequests, setStaffRequests] = useState([])
  const [requestNotice, setRequestNotice] = useState(null)
  const [rejectingRequestId, setRejectingRequestId] = useState(null)
  const [rejectMessage, setRejectMessage] = useState('')

  useEffect(() => {
    fetchGrants()
    if (isOwner) fetchStaffRequests()
  }, [workspaceId, isOwner])

  async function fetchStaffRequests() {
    const { data } = await supabase
      .from('staff_action_requests')
      .select('*, requester:requested_by ( full_name, email )')
      .eq('workspace_id', workspaceId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    if (data) setStaffRequests(data)
  }

  async function handleApproveRequest(req) {
    if (req.action_type === 'invite_member') {
      const { data, error } = await supabase.functions.invoke('invite-user', {
        body: { action: 'approve_staff_invite', requestId: req.id },
      })
      if (error || data?.error) { setRequestNotice(data?.error || 'No se pudo aprobar la invitación.'); return }
    } else {
      const { error } = await supabase.rpc('approve_staff_action', { p_request_id: req.id })
      if (error) { setRequestNotice('No se pudo aprobar la solicitud.'); return }
    }
    fetchStaffRequests()
  }

  async function handleRejectRequest(id, message) {
    const { error } = await supabase.rpc('reject_staff_action', { p_request_id: id, p_message: message?.trim() || null })
    if (error) { setRequestNotice('No se pudo rechazar la solicitud.'); return }
    setRejectingRequestId(null)
    setRejectMessage('')
    fetchStaffRequests()
  }

  async function fetchGrants() {
    const { data } = await supabase
      .from('access_grants')
      .select('*, claimant:claimed_by ( full_name, email )')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
    if (data) setGrants(data)
  }

  async function handleCreateGrant() {
    setGrantError('')
    setCreatingGrant(true)
    const { data, error } = await supabase.rpc('create_access_grant', {
      p_workspace_id: workspaceId,
      p_role: grantRole,
      p_duration_hours: grantDuration === 'unlimited' ? null : parseInt(grantDuration, 10),
      p_is_ticket: grantIsTicket,
      p_problem_description: grantIsTicket ? grantProblem.trim() || null : null,
    })
    setCreatingGrant(false)
    if (error) { setGrantError('No se pudo generar el código. Intentá de nuevo.'); return }
    setLastCode(data.code)
    setShowGrantForm(false)
    setGrantProblem('')
    fetchGrants()
  }

  async function handleConfirmGrant(id) {
    const { error } = await supabase.rpc('confirm_access_grant', { p_grant_id: id })
    if (!error) fetchGrants()
  }

  async function handleDeclineGrant(id) {
    await supabase.rpc('decline_access_grant', { p_grant_id: id })
    fetchGrants()
  }

  async function handleRevokeGrant(id, message) {
    const { error } = await supabase.rpc('revoke_access_grant', { p_grant_id: id, p_message: message?.trim() || null })
    if (!error) { fetchGrants(); setRevokingGrantId(null); setRevokeMessage('') }
  }

  async function handleCancelGrant(id) {
    await supabase.rpc('cancel_access_grant', { p_grant_id: id })
    fetchGrants()
  }

  async function handleCopyCode(code) {
    await navigator.clipboard.writeText(code)
  }

  return (
    <div className="settings-section">
      {isOwner && staffRequests.length > 0 && (
        <div className="settings-block">
          <h2 className="settings-block-title">Solicitudes de staff pendientes</h2>
          <p className="settings-hint">
            Un miembro del staff con un acceso de soporte de rol más bajo pidió hacer algo que necesita ser owner. No se ejecuta hasta que lo aprobás.
          </p>
          {requestNotice && <p className="form-error">{requestNotice}</p>}
          <div className="settings-table">
            {staffRequests.map(r => (
              <div key={r.id} className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <div className="settings-row-info">
                    <div className="settings-row-text">
                      <div className="settings-row-name">{r.payload?.description || r.action_type}</div>
                      <div className="settings-row-email">
                        {r.requester?.full_name || r.requester?.email || 'Alguien del staff'} · {new Date(r.created_at).toLocaleString('es-AR')}
                      </div>
                    </div>
                  </div>
                  <div className="settings-row-actions">
                    <button className="settings-btn-primary" onClick={() => handleApproveRequest(r)}>✓ Aprobar</button>
                    <button className="settings-btn-danger" onClick={() => { setRejectingRequestId(r.id); setRejectMessage('') }}>✕ Rechazar</button>
                  </div>
                </div>
                {rejectingRequestId === r.id && (
                  <div style={{ marginTop: 10 }}>
                    <div className="form-group">
                      <label>MOTIVO (OPCIONAL)</label>
                      <textarea rows={2} value={rejectMessage} onChange={e => setRejectMessage(e.target.value)} placeholder="Ej: Todavía no, esperemos a..." />
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button className="settings-btn-secondary" onClick={() => setRejectingRequestId(null)}>Cancelar</button>
                      <button className="settings-btn-danger" onClick={() => handleRejectRequest(r.id, rejectMessage)}>Confirmar rechazo</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isOwner && (
        <div className="settings-block">
          <h2 className="settings-block-title">Acceso de soporte</h2>
          <p className="settings-hint">
            Le das acceso temporal a alguien del equipo de Nerva para que te ayude — siempre por código, y siempre con tu confirmación activa en el momento en que esa persona entra, aunque ya hayas generado el código antes. Podés mandarlo como ticket (aparece en la cola del staff, con el problema que cuentes) o pasarlo vos mismo directamente a alguien.
          </p>

          {lastCode && (
            <div className="access-grant-code-box">
              <span>Código generado:</span>
              <strong className="access-grant-code">{lastCode}</strong>
              <button className="settings-btn-secondary" onClick={() => handleCopyCode(lastCode)}>Copiar</button>
            </div>
          )}

          {!showGrantForm ? (
            <button className="settings-btn-primary" onClick={() => setShowGrantForm(true)}>+ Generar código de acceso</button>
          ) : (
            <div className="invite-form">
              <div className="form-row">
                <div className="form-group">
                  <label>ROL</label>
                  <select value={grantRole} onChange={e => setGrantRole(e.target.value)}>
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>DURACIÓN</label>
                  <select value={grantDuration} onChange={e => setGrantDuration(e.target.value)}>
                    <option value="24">24 horas</option>
                    <option value="48">48 horas</option>
                    <option value="72">72 horas</option>
                    <option value="unlimited">Ilimitado (máximo 30 días)</option>
                  </select>
                </div>
              </div>
              <label className="approval-rule-toggle" style={{ marginTop: 8 }}>
                <input type="checkbox" checked={grantIsTicket} onChange={e => setGrantIsTicket(e.target.checked)} />
                <span>Mandar como ticket a la cola del staff (en vez de pasar el código yo mismo)</span>
              </label>
              {grantIsTicket && (
                <div className="form-group" style={{ marginTop: 8 }}>
                  <label>CONTANOS EL PROBLEMA</label>
                  <textarea rows={3} value={grantProblem} onChange={e => setGrantProblem(e.target.value)} placeholder="¿Qué necesitás que revisemos?" />
                </div>
              )}
              {grantError && <p className="form-error">{grantError}</p>}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="settings-btn-secondary" onClick={() => setShowGrantForm(false)}>Cancelar</button>
                <button className="settings-btn-primary" onClick={handleCreateGrant} disabled={creatingGrant}>
                  {creatingGrant ? 'Generando...' : 'Generar código'}
                </button>
              </div>
            </div>
          )}

          {grants.length > 0 && (
            <div className="settings-table" style={{ marginTop: 16 }}>
              {grants.map(g => (
                <div key={g.id} className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    <div className="settings-row-info">
                      <div className="settings-row-text">
                        <div className="settings-row-name">
                          Ticket #{g.ticket_number} · {roleLabelForGrant(g.role)} · {g.is_ticket ? 'Ticket' : 'Código directo'}
                          {g.status === 'pending_confirmation' && <span className="settings-inactive-badge" style={{ background: '#FEF3C7', color: '#92400E' }}> Esperando tu confirmación</span>}
                          {g.status === 'active' && <span className="settings-inactive-badge" style={{ background: '#DCFCE7', color: '#166534' }}> Activo</span>}
                        </div>
                        <div className="settings-row-email">
                          {g.status === 'open' && `Código ${g.code} — sin tomar todavía`}
                          {g.status === 'pending_confirmation' && `${g.claimant?.full_name || g.claimant?.email || 'Alguien del staff'} está esperando que confirmes`}
                          {g.status === 'active' && `${g.claimant?.full_name || g.claimant?.email || ''} · vence ${g.expires_at ? new Date(g.expires_at).toLocaleString('es-AR') : '—'}`}
                          {['expired', 'revoked', 'declined', 'cancelled'].includes(g.status) && `${g.status} · ${new Date(g.created_at).toLocaleDateString('es-AR')}`}
                        </div>
                        {g.status === 'revoked' && g.resolution_message && (
                          <div className="settings-row-email" style={{ marginTop: 4, fontStyle: 'italic' }}>"{g.resolution_message}"</div>
                        )}
                      </div>
                    </div>
                    <div className="settings-row-actions">
                      {g.status === 'open' && <button className="settings-btn-danger" onClick={() => handleCancelGrant(g.id)}>Cancelar</button>}
                      {g.status === 'pending_confirmation' && (
                        <>
                          <button className="settings-btn-primary" onClick={() => handleConfirmGrant(g.id)}>✓ Confirmar</button>
                          <button className="settings-btn-danger" onClick={() => handleDeclineGrant(g.id)}>✕ Rechazar</button>
                        </>
                      )}
                      {g.status === 'active' && <button className="settings-btn-danger" onClick={() => { setRevokingGrantId(g.id); setRevokeMessage('') }}>Revocar</button>}
                    </div>
                  </div>
                  {revokingGrantId === g.id && (
                    <div style={{ marginTop: 10 }}>
                      <div className="form-group">
                        <label>MENSAJE PARA EL STAFF (OPCIONAL)</label>
                        <textarea rows={2} value={revokeMessage} onChange={e => setRevokeMessage(e.target.value)} placeholder="Ej: Ya no hace falta, gracias." />
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                        <button className="settings-btn-secondary" onClick={() => setRevokingGrantId(null)}>Cancelar</button>
                        <button className="settings-btn-danger" onClick={() => handleRevokeGrant(g.id, revokeMessage)}>Confirmar revocación</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function roleLabelForGrant(role) {
  const map = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }
  return map[role] || role
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
  { key: 'custom_field_due', label: 'Un campo con seguimiento necesita atención' },
  { key: 'mentioned', label: 'Me mencionan con @ en una nota' },
  { key: 'task_approval_requested', label: 'Soy aprobador y hay una tarea esperando mi autorización' },
  { key: 'task_approval_resolved', label: 'Se resuelve la autorización de una tarea mía' },
  { key: 'negotiation_close_requested', label: 'Soy aprobador y hay un cierre de proyecto esperando confirmación' },
  { key: 'access_grant_pending_confirmation', label: 'Alguien del staff tomó un código de acceso y espera que lo confirme' },
  { key: 'access_grant_closed', label: 'Se cierra un acceso de soporte que di' },
  { key: 'staff_action_requested', label: 'Un miembro del staff pide autorización para hacer algo por encima de su rol' },
  { key: 'staff_action_resolved', label: 'Se resuelve algo que pedí como staff (autorización o invitación)' },
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