// Profile.jsx — Perfil del usuario logueado (datos propios, no de workspace)

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { extractFunctionError } from '../lib/edgeFunctionError'
import './Settings.css'

export default function Profile() {
  const { user, profile, isStaff, refreshProfile } = useAuth()
  const [fullName, setFullName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameSuccess, setNameSuccess] = useState(false)
  const [nameError, setNameError] = useState(null)

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

  useEffect(() => {
    setFullName(profile?.full_name || '')
  }, [profile])

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
    } else {
      setClientSuccess(`Workspace "${clientWsName.trim()}" creado. Copiá el link y mandáselo a ${clientEmail.trim()} (todavía no se manda mail automático).`)
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

  return (
    <div className="settings-container">
      <div className="settings-header">
        <h1 className="settings-title">Mi perfil</h1>
      </div>

      <div className="settings-section">
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

        {isStaff && (
          <div className="settings-block">
            <h2 className="settings-block-title">Panel de Staff — Dar de alta un cliente nuevo</h2>
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
        )}
      </div>
    </div>
  )
}
