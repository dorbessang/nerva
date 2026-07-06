// Profile.jsx — Perfil del usuario logueado (datos propios, no de workspace)

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import './Settings.css'

export default function Profile() {
  const { user, profile, refreshProfile } = useAuth()
  const [fullName, setFullName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameSuccess, setNameSuccess] = useState(false)
  const [nameError, setNameError] = useState(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState(null)

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
      </div>
    </div>
  )
}
