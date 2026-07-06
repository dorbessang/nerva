import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function SetPassword() {
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    // Supabase manda el token en el hash de la URL, esto lo procesa automático
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Usuario llegó desde el link del mail, ya está autenticado temporalmente
      }
    })
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (!fullName.trim()) {
      setError('Ingresá tu nombre completo')
      return
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      const userId = data?.user?.id
      const email = data?.user?.email

      if (userId) {
        await supabase.from('profiles').update({ full_name: fullName.trim() }).eq('id', userId)
      }

      // Limpiamos la invitación pendiente ahora que ya aceptó y tiene sesión propia
      if (email) {
        await supabase.from('invitations').delete().eq('email', email.toLowerCase())
      }

      navigate('/dashboard')
    } catch (err) {
      setError('Hubo un error al guardar los datos. Intentá de nuevo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.logo}>NERVA</h1>
        <p style={styles.subtitle}>Completá tus datos para acceder</p>
        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            style={styles.input}
            type="text"
            placeholder="Nombre completo"
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            autoFocus
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Nueva contraseña"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <input
            style={styles.input}
            type="password"
            placeholder="Confirmar contraseña"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
          />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.button} type="submit" disabled={loading}>
            {loading ? 'Guardando...' : 'Crear cuenta'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B1F3A',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '12px',
    padding: '48px 40px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.15)',
  },
  logo: {
    fontSize: '32px',
    fontWeight: '800',
    color: '#0B1F3A',
    margin: '0 0 8px 0',
    letterSpacing: '4px',
  },
  subtitle: {
    color: '#6b7280',
    fontSize: '14px',
    margin: '0 0 32px 0',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  input: {
    padding: '12px 16px',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    fontSize: '14px',
    outline: 'none',
  },
  button: {
    padding: '12px',
    backgroundColor: '#0B1F3A',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '15px',
    fontWeight: '600',
    cursor: 'pointer',
    marginTop: '8px',
  },
  error: {
    color: '#DC2626',
    fontSize: '13px',
    margin: '0',
  },
}