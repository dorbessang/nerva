// Profile.jsx — Perfil del usuario logueado (datos propios, no de workspace)

import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { extractFunctionError } from '../lib/edgeFunctionError'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import Avatar from '../components/Avatar'
import InfoTooltip from '../components/InfoTooltip'
import { AVATAR_PRESETS } from '../lib/avatarPresets'
import '../styles/forms.css'
import './Settings.css'
import './Profile.css'

const PROFILE_TAB_KEYS = ['perfil', 'seguridad', 'staff']

export default function Profile() {
  const { user, profile, isStaff, refreshProfile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  // La pestaña activa vive en la URL (?tab=...), no solo en un useState
  // -- así sobrevive a cualquier remount del componente (cambio de sesión,
  // el navegador descartando la pestaña en segundo plano, etc.), no solo
  // al caso puntual de TOKEN_REFRESHED que ya se arregló en AuthContext.
  // Mismo patrón de nav agrupada que Configuración (2026-08-25): esta
  // página creció (foto, datos personales ampliados, seguridad, staff) y
  // ya no entra cómoda en una tira de 2 pestañas.
  const urlTab = new URLSearchParams(location.search).get('tab')
  const [activeTab, setActiveTabState] = useState(PROFILE_TAB_KEYS.includes(urlTab) ? urlTab : 'perfil')

  function setActiveTab(tab) {
    setActiveTabState(tab)
    navigate(`/profile?tab=${tab}`, { replace: true })
  }

  useEffect(() => {
    if (activeTab === 'staff' && !isStaff) setActiveTab('perfil')
  }, [activeTab, isStaff])

  const [fullName, setFullName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameSuccess, setNameSuccess] = useState(false)
  const [nameError, setNameError] = useState(null)

  const [phone, setPhone] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [department, setDepartment] = useState('')
  const [birthday, setBirthday] = useState('')
  const [city, setCity] = useState('')
  const [timezone, setTimezone] = useState('')
  const [linkedinUrl, setLinkedinUrl] = useState('')
  const [bio, setBio] = useState('')
  const [language, setLanguage] = useState('es')
  const [savingExtended, setSavingExtended] = useState(false)
  const [extendedSuccess, setExtendedSuccess] = useState(false)
  const [extendedError, setExtendedError] = useState(null)

  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [avatarError, setAvatarError] = useState(null)
  const [showAvatarGallery, setShowAvatarGallery] = useState(false)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState(null)

  const [clientWsName, setClientWsName] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [creatingClient, setCreatingClient] = useState(false)
  const [clientError, setClientError] = useState(null)
  const [clientSuccess, setClientSuccess] = useState(null)
  const [clientInviteLink, setClientInviteLink] = useState(null)

  const [deleteEmail, setDeleteEmail] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)
  const [deleteSuccess, setDeleteSuccess] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [accessCode, setAccessCode] = useState('')
  const [claimingCode, setClamingCode] = useState(false)
  const [codeError, setCodeError] = useState(null)
  const [codeSuccess, setCodeSuccess] = useState(null)
  const [openTickets, setOpenTickets] = useState([])
  const [myClaims, setMyClaims] = useState([])
  const [closingId, setClosingId] = useState(null)
  const [closeMessage, setCloseMessage] = useState('')
  const [closingBusy, setClosingBusy] = useState(false)
  const [myRequests, setMyRequests] = useState([])

  useEffect(() => {
    setFullName(profile?.full_name || '')
    setPhone(profile?.phone || '')
    setJobTitle(profile?.job_title || '')
    setDepartment(profile?.department || '')
    setBirthday(profile?.birthday || '')
    setCity(profile?.city || '')
    setTimezone(profile?.timezone || '')
    setLinkedinUrl(profile?.linkedin_url || '')
    setBio(profile?.bio || '')
    setLanguage(profile?.language || 'es')
  }, [profile])

  // Se trae en cualquier pestaña (no solo "staff") para que el número de
  // tickets abiertos esté disponible para el badge de la solapa apenas
  // entra a Perfil, sin tener que cambiar de pestaña primero.
  useEffect(() => {
    if (isStaff) { fetchAccessQueue(); fetchMyRequests() }
  }, [isStaff])

  async function fetchMyRequests() {
    const { data } = await supabase
      .from('staff_action_requests')
      .select('*, ws:workspace_id ( name )')
      .eq('requested_by', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setMyRequests(data || [])
  }

  async function fetchAccessQueue() {
    const { data: tickets } = await supabase
      .from('access_grants')
      .select('*, ws:workspace_id ( name )')
      .eq('is_ticket', true)
      .eq('status', 'open')
      .order('created_at', { ascending: true })
    setOpenTickets(tickets || [])

    const { data: claims } = await supabase
      .from('access_grants')
      .select('*, ws:workspace_id ( name )')
      .eq('claimed_by', user.id)
      .in('status', ['pending_confirmation', 'active'])
      .order('claimed_at', { ascending: false })
    setMyClaims(claims || [])
  }

  async function claimCode(code) {
    setCodeError(null)
    setCodeSuccess(null)
    setClamingCode(true)
    const { data, error } = await supabase.rpc('claim_access_grant', { p_code: code })
    setClamingCode(false)
    if (error) { setCodeError(error.message?.includes('inválido') || error.message?.includes('usado') ? 'Código inválido o ya usado.' : 'No se pudo tomar el código. Intentá de nuevo.'); return }
    setCodeSuccess('Código tomado — esperando que alguien del workspace confirme tu ingreso ahora.')
    setAccessCode('')
    fetchAccessQueue()
  }

  async function handleClaimTypedCode() {
    if (!accessCode.trim()) return
    await claimCode(accessCode.trim())
  }

  async function handleCancelRequest(id) {
    await supabase.rpc('cancel_staff_action_request', { p_request_id: id })
    fetchMyRequests()
  }

  function requestStatusLabel(r) {
    if (r.status === 'pending') return 'Esperando al owner'
    if (r.status === 'approved') return 'Aprobada'
    if (r.status === 'rejected') return r.resolution_message ? `Rechazada — "${r.resolution_message}"` : 'Rechazada'
    if (r.status === 'cancelled') return 'Cancelada'
    return r.status
  }

  async function handleCloseAccess(id) {
    setClosingBusy(true)
    const { error } = await supabase.rpc('revoke_access_grant', {
      p_grant_id: id,
      p_message: closeMessage.trim() || null,
    })
    setClosingBusy(false)
    if (error) return
    setClosingId(null)
    setCloseMessage('')
    fetchAccessQueue()
  }

  async function handleSaveName() {
    setNameError(null)
    setNameSuccess(false)
    if (!fullName.trim()) { setNameError('El nombre no puede estar vacío'); return }
    setSavingName(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() })
      .eq('id', user.id)
    setSavingName(false)
    if (error) { setNameError('No se pudo guardar. Intentá de nuevo.'); return }
    setNameSuccess(true)
    await refreshProfile()
    setTimeout(() => setNameSuccess(false), 2000)
  }

  async function handleSaveExtended() {
    setExtendedError(null)
    setExtendedSuccess(false)
    setSavingExtended(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        phone: phone.trim() || null,
        job_title: jobTitle.trim() || null,
        department: department.trim() || null,
        birthday: birthday || null,
        city: city.trim() || null,
        timezone: timezone.trim() || null,
        linkedin_url: linkedinUrl.trim() || null,
        bio: bio.trim() || null,
        language,
      })
      .eq('id', user.id)
    setSavingExtended(false)
    if (error) { setExtendedError('No se pudo guardar. Intentá de nuevo.'); return }
    setExtendedSuccess(true)
    await refreshProfile()
    setTimeout(() => setExtendedSuccess(false), 2000)
  }

  async function handleUploadAvatar(file) {
    if (!file) return
    setAvatarError(null)
    if (!file.type.startsWith('image/')) { setAvatarError('Elegí un archivo de imagen'); return }
    if (file.size > 5 * 1024 * 1024) { setAvatarError('La imagen no puede superar 5MB'); return }
    setUploadingAvatar(true)
    const path = `${user.id}/${Date.now()}-${file.name}`
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true })
    if (uploadError) {
      setUploadingAvatar(false)
      setAvatarError('No se pudo subir la imagen. Intentá de nuevo.')
      return
    }
    const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path)
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_url: pub.publicUrl, avatar_preset: null })
      .eq('id', user.id)
    setUploadingAvatar(false)
    if (error) { setAvatarError('No se pudo guardar. Intentá de nuevo.'); return }
    setShowAvatarGallery(false)
    await refreshProfile()
  }

  async function handlePickPreset(key) {
    setAvatarError(null)
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_preset: key, avatar_url: null })
      .eq('id', user.id)
    if (error) { setAvatarError('No se pudo guardar. Intentá de nuevo.'); return }
    setShowAvatarGallery(false)
    await refreshProfile()
  }

  async function handleUseInitials() {
    setAvatarError(null)
    const { error } = await supabase
      .from('profiles')
      .update({ avatar_preset: null, avatar_url: null })
      .eq('id', user.id)
    if (error) { setAvatarError('No se pudo guardar. Intentá de nuevo.'); return }
    setShowAvatarGallery(false)
    await refreshProfile()
  }

  async function handleChangePassword() {
    setPasswordError(null)
    setPasswordSuccess(false)
    if (newPassword.length < 8) { setPasswordError('La contraseña debe tener al menos 8 caracteres'); return }
    if (newPassword !== confirmPassword) { setPasswordError('Las contraseñas no coinciden'); return }
    setSavingPassword(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setSavingPassword(false)
    if (error) { setPasswordError('No se pudo cambiar la contraseña. Intentá de nuevo.'); return }
    setPasswordSuccess(true)
    setNewPassword('')
    setConfirmPassword('')
    setTimeout(() => setPasswordSuccess(false), 2000)
  }

  async function handleCreateClient() {
    setClientError(null)
    setClientSuccess(null)
    setClientInviteLink(null)
    if (!clientWsName.trim()) { setClientError('El nombre del workspace es obligatorio'); return }
    if (!clientEmail.trim()) { setClientError('El email es obligatorio'); return }
    setCreatingClient(true)

    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: { action: 'invite_client', email: clientEmail.trim().toLowerCase(), workspaceName: clientWsName.trim() },
    })

    setCreatingClient(false)
    if (error || data?.error) {
      setClientError(data?.error || (await extractFunctionError(error)) || 'Error al crear el cliente.')
      return
    }
    if (data?.direct) {
      setClientSuccess(`${clientEmail.trim()} ya tenía cuenta — se creó "${clientWsName.trim()}" y se lo sumó directo como owner.`)
    } else if (data?.emailSent) {
      setClientSuccess(`Workspace "${clientWsName.trim()}" creado. Invitación enviada por mail a ${clientEmail.trim()}.`)
      setClientInviteLink(data?.inviteLink || null)
    } else {
      setClientSuccess(`Workspace "${clientWsName.trim()}" creado, pero no se pudo mandar el mail — copiá el link y mandáselo a mano a ${clientEmail.trim()}.`)
      setClientInviteLink(data?.inviteLink || null)
    }
    setClientWsName('')
    setClientEmail('')
  }

  async function handleCopyClientLink() {
    if (!clientInviteLink) return
    await navigator.clipboard.writeText(clientInviteLink)
    setClientSuccess('Link copiado al portapapeles.')
  }

  async function handleDeleteUser() {
    setConfirmDelete(false)
    setDeleteError(null)
    setDeleteSuccess(null)
    setDeleting(true)

    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: { action: 'delete_user', email: deleteEmail.trim().toLowerCase() },
    })

    setDeleting(false)
    if (error || data?.error) {
      setDeleteError(data?.error || (await extractFunctionError(error)) || 'Error al eliminar la cuenta.')
      return
    }
    setDeleteSuccess(`Cuenta ${deleteEmail.trim()} eliminada por completo.`)
    setDeleteEmail('')
  }

  const NAV_GROUPS = [
    {
      label: 'Tu cuenta', items: [
        { key: 'perfil', label: 'Perfil' },
        { key: 'seguridad', label: 'Seguridad' },
      ]
    },
    ...(isStaff ? [{
      label: 'Staff', items: [
        { key: 'staff', label: 'Staff', badge: openTickets.length },
      ]
    }] : []),
  ]

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1 className="settings-title">Mi perfil</h1>
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

        <div className="settings-content">

      {activeTab === 'perfil' && (
      <div className="settings-section">
        <div className="settings-block">
          <h2 className="settings-block-title">Foto de perfil</h2>
          <div className="profile-avatar-row">
            <Avatar profile={profile} size={72} />
            <div className="profile-avatar-actions">
              <label className="settings-btn-primary profile-avatar-upload-btn">
                {uploadingAvatar ? 'Subiendo...' : 'Subir foto'}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  disabled={uploadingAvatar}
                  onChange={e => handleUploadAvatar(e.target.files?.[0])}
                />
              </label>
              <button className="settings-btn-secondary" onClick={() => setShowAvatarGallery(v => !v)}>
                Elegir un ícono
              </button>
              {(profile?.avatar_url || profile?.avatar_preset) && (
                <button className="settings-btn-secondary" onClick={handleUseInitials}>
                  Usar inicial
                </button>
              )}
            </div>
          </div>
          {avatarError && <p className="settings-error">{avatarError}</p>}
          {showAvatarGallery && (
            <div className="profile-avatar-gallery">
              {AVATAR_PRESETS.map(p => (
                <button
                  key={p.key}
                  className={`profile-avatar-preset-btn ${profile?.avatar_preset === p.key ? 'active' : ''}`}
                  style={{ background: p.bg }}
                  onClick={() => handlePickPreset(p.key)}
                  title={p.key}
                >
                  {p.emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="settings-block">
          <h2 className="settings-block-title">Datos personales</h2>
          <div className="form-group" style={{ maxWidth: 400 }}>
            <label>EMAIL</label>
            <input type="email" value={user?.email || ''} disabled />
          </div>
          <div className="form-group" style={{ maxWidth: 400 }}>
            <label>NOMBRE COMPLETO</label>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
            />
          </div>
          {nameError && <p className="settings-error">{nameError}</p>}
          {nameSuccess && <p className="settings-success">Guardado.</p>}
          <button className="settings-btn-primary" onClick={handleSaveName} disabled={savingName}>
            {savingName ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>

        <div className="settings-block">
          <div className="settings-block-title-row">
            <h2 className="settings-block-title">Perfil personal</h2>
            <InfoTooltip text="Nada de esto es obligatorio ni se comparte fuera de tu equipo — es para tener un perfil más completo de cara al resto (y para funciones que vamos a ir sumando más adelante: cumpleaños, directorio por área, horarios según zona, etc.)." />
          </div>
          <div className="form-row">
            <div className="form-group" style={{ maxWidth: 240 }}>
              <label>TELÉFONO</label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+54 9 11 ..." />
            </div>
            <div className="form-group" style={{ maxWidth: 240 }}>
              <label>CARGO / PUESTO</label>
              <input type="text" value={jobTitle} onChange={e => setJobTitle(e.target.value)} placeholder="Ej: Gerente de Ventas" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ maxWidth: 240 }}>
              <label>ÁREA / DEPARTAMENTO</label>
              <input type="text" value={department} onChange={e => setDepartment(e.target.value)} placeholder="Ej: Business Development" />
            </div>
            <div className="form-group" style={{ maxWidth: 240 }}>
              <label>CUMPLEAÑOS</label>
              <input type="date" value={birthday} onChange={e => setBirthday(e.target.value)} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ maxWidth: 240 }}>
              <label>CIUDAD</label>
              <input type="text" value={city} onChange={e => setCity(e.target.value)} placeholder="Ej: Buenos Aires" />
            </div>
            <div className="form-group" style={{ maxWidth: 240 }}>
              <label>ZONA HORARIA</label>
              <input type="text" value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="Ej: GMT-3" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group" style={{ maxWidth: 400 }}>
              <label>LINKEDIN</label>
              <input type="url" value={linkedinUrl} onChange={e => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/..." />
            </div>
            <div className="form-group" style={{ maxWidth: 200 }}>
              <label>IDIOMA PREFERIDO</label>
              <select value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="es">Español</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label>SOBRE VOS</label>
            <textarea rows={3} value={bio} onChange={e => setBio(e.target.value)} placeholder="Una descripción corta, lo que quieras contar." />
          </div>
          {extendedError && <p className="settings-error">{extendedError}</p>}
          {extendedSuccess && <p className="settings-success">Guardado.</p>}
          <button className="settings-btn-primary" onClick={handleSaveExtended} disabled={savingExtended}>
            {savingExtended ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
      )}

      {activeTab === 'seguridad' && (
      <div className="settings-section">
        <div className="settings-block">
          <h2 className="settings-block-title">Cambiar contraseña</h2>
          <div className="form-group" style={{ maxWidth: 400 }}>
            <label>NUEVA CONTRASEÑA</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
          </div>
          <div className="form-group" style={{ maxWidth: 400 }}>
            <label>CONFIRMAR CONTRASEÑA</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
            />
          </div>
          {passwordError && <p className="settings-error">{passwordError}</p>}
          {passwordSuccess && <p className="settings-success">Contraseña actualizada.</p>}
          <button className="settings-btn-primary" onClick={handleChangePassword} disabled={savingPassword}>
            {savingPassword ? 'Guardando...' : 'Cambiar contraseña'}
          </button>
        </div>
      </div>
      )}

      {activeTab === 'staff' && isStaff && (
      <div className="settings-section">
          <div className="settings-block">
            <h2 className="settings-block-title">Acceso de soporte</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: -8, marginBottom: 16 }}>
              Ingresá un código que te haya pasado directamente un owner/admin, o tomá un ticket de la cola de abajo. En los dos casos, tomar el código no te da acceso todavía — alguien del workspace tiene que confirmar tu ingreso en ese momento antes de que puedas entrar.
            </p>
            <div className="form-row">
              <div className="form-group" style={{ maxWidth: 220 }}>
                <label>CÓDIGO</label>
                <input
                  type="text"
                  value={accessCode}
                  onChange={e => setAccessCode(e.target.value.toUpperCase())}
                  placeholder="Ej: A1B2C3D4"
                  maxLength={8}
                />
              </div>
              <button className="settings-btn-primary" style={{ alignSelf: 'flex-end', height: 38 }} onClick={handleClaimTypedCode} disabled={claimingCode || !accessCode.trim()}>
                {claimingCode ? 'Tomando...' : 'Tomar código'}
              </button>
            </div>
            {codeError && <p className="settings-error">{codeError}</p>}
            {codeSuccess && <p className="settings-success">{codeSuccess}</p>}

            {myClaims.length > 0 && (
              <div className="settings-table" style={{ marginTop: 16 }}>
                {myClaims.map(c => (
                  <div key={c.id} className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                      <div className="settings-row-info">
                        <div className="settings-row-text">
                          <div className="settings-row-name">Ticket #{c.ticket_number} · {c.ws?.name || 'Workspace'}</div>
                          <div className="settings-row-email">
                            {c.status === 'pending_confirmation' ? 'Esperando confirmación del workspace...' : `Activo · vence ${c.expires_at ? new Date(c.expires_at).toLocaleString('es-AR') : '—'}`}
                          </div>
                        </div>
                      </div>
                      {c.status === 'active' && (
                        <div className="settings-row-actions">
                          <button className="settings-btn-danger" onClick={() => { setClosingId(c.id); setCloseMessage('') }}>Finalizar acceso</button>
                        </div>
                      )}
                    </div>
                    {closingId === c.id && (
                      <div style={{ marginTop: 10 }}>
                        <div className="form-group">
                          <label>MENSAJE PARA EL WORKSPACE (OPCIONAL)</label>
                          <textarea rows={2} value={closeMessage} onChange={e => setCloseMessage(e.target.value)} placeholder="Ej: Ya quedó resuelto el problema de X." />
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                          <button className="settings-btn-secondary" onClick={() => setClosingId(null)}>Cancelar</button>
                          <button className="settings-btn-primary" onClick={() => handleCloseAccess(c.id)} disabled={closingBusy}>
                            {closingBusy ? 'Finalizando...' : 'Confirmar y salir'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginTop: 20, marginBottom: 8 }}>Cola de tickets abiertos</h3>
            {openTickets.length === 0 ? (
              <p style={{ fontSize: 13, color: '#9ca3af' }}>No hay tickets esperando.</p>
            ) : (
              <div className="settings-table">
                {openTickets.map(t => (
                  <div key={t.id} className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-text">
                        <div className="settings-row-name">Ticket #{t.ticket_number} · {t.ws?.name || 'Workspace'}</div>
                        <div className="settings-row-email">{t.problem_description || 'Sin descripción'}</div>
                      </div>
                    </div>
                    <div className="settings-row-actions">
                      <button className="settings-btn-primary" onClick={() => claimCode(t.code)} disabled={claimingCode}>Tomar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {myRequests.length > 0 && (
            <div className="settings-block">
              <h2 className="settings-block-title">Mis solicitudes</h2>
              <p style={{ fontSize: 13, color: '#6b7280', marginTop: -8, marginBottom: 16 }}>
                Acciones que pediste hacer por encima de tu rol en un workspace — quedan pendientes hasta que un owner las aprueba o rechaza.
              </p>
              <div className="settings-table">
                {myRequests.map(r => (
                  <div key={r.id} className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-text">
                        <div className="settings-row-name">{r.payload?.description || r.action_type} · {r.ws?.name || 'Workspace'}</div>
                        <div className="settings-row-email">{requestStatusLabel(r)}</div>
                      </div>
                    </div>
                    {r.status === 'pending' && (
                      <div className="settings-row-actions">
                        <button className="settings-btn-secondary" onClick={() => handleCancelRequest(r.id)}>Retirar</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="settings-block">
            <h2 className="settings-block-title">Dar de alta un cliente nuevo</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: -8, marginBottom: 16 }}>
              Crea un workspace de equipo nuevo y a esa persona como su owner — distinto de "Invitar usuario",
              que suma a alguien a un workspace que ya existe (eso se hace desde Configuración → Miembros, dentro de ese workspace).
            </p>
            <div className="form-group" style={{ maxWidth: 400 }}>
              <label>NOMBRE DEL WORKSPACE</label>
              <input
                type="text"
                value={clientWsName}
                onChange={e => setClientWsName(e.target.value)}
                placeholder="Ej: Farmacéutica XYZ"
              />
            </div>
            <div className="form-group" style={{ maxWidth: 400 }}>
              <label>EMAIL DEL CLIENTE</label>
              <input
                type="email"
                value={clientEmail}
                onChange={e => setClientEmail(e.target.value)}
                placeholder="cliente@empresa.com"
              />
            </div>
            {clientError && <p className="settings-error">{clientError}</p>}
            {clientSuccess && <p className="settings-success">{clientSuccess}</p>}
            {clientInviteLink && (
              <div className="invite-link-row">
                <input className="invite-link-input" type="text" readOnly value={clientInviteLink} onFocus={e => e.target.select()} />
                <button className="settings-btn-secondary" onClick={handleCopyClientLink}>Copiar</button>
              </div>
            )}
            <button className="settings-btn-primary" onClick={handleCreateClient} disabled={creatingClient}>
              {creatingClient ? 'Creando...' : 'Crear cliente'}
            </button>
          </div>

          <div className="settings-block">
            <h2 className="settings-block-title">Eliminar cuenta de usuario</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginTop: -8, marginBottom: 16 }}>
              Borra la cuenta por completo (no solo la saca de un workspace) — pierde acceso a todo, en todos
              los workspaces donde estaba. Es irreversible. Pensado para limpiar cuentas de prueba o pedidos
              de baja, no para gestión normal de miembros (eso se hace desde Configuración → Miembros).
            </p>
            <div className="form-group" style={{ maxWidth: 400 }}>
              <label>EMAIL A ELIMINAR</label>
              <input
                type="email"
                value={deleteEmail}
                onChange={e => setDeleteEmail(e.target.value)}
                placeholder="usuario@ejemplo.com"
              />
            </div>
            {deleteError && <p className="settings-error">{deleteError}</p>}
            {deleteSuccess && <p className="settings-success">{deleteSuccess}</p>}
            <button
              className="settings-btn-primary"
              onClick={() => setConfirmDelete(true)}
              disabled={deleting || !deleteEmail.trim()}
            >
              {deleting ? 'Eliminando...' : 'Eliminar cuenta'}
            </button>
          </div>
      </div>
      )}

        </div>
      </div>

      {confirmDelete && (
        <DeleteConfirmModal
          itemName={deleteEmail.trim()}
          itemType="cuenta"
          warningText="Se borra la cuenta por completo: pierde acceso a todos los workspaces donde estaba, y no se puede deshacer."
          onConfirm={handleDeleteUser}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}
