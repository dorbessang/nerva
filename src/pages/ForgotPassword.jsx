import { useState } from 'react'
import { Link } from 'react-router-dom'
import { requestPasswordReset } from '../lib/auth'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await requestPasswordReset(email)
      setSent(true)
    } catch (err) {
      setError(err?.message || 'Hubo un error. Intentá de nuevo en unos minutos.')
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.logo}>NERVA</h1>
          <p style={styles.subtitle}>
            Si el email <strong>{email}</strong> tiene una cuenta, te enviamos un link para restablecer tu contraseña. Revisá tu bandeja de entrada (y spam).
          </p>
          <Link to="/login" style={styles.link}>Volver al login</Link>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.logo}>NERVA</h1>
        <p style={styles.subtitle}>Ingresá tu email y te mandamos un link para restablecer tu contraseña</p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <input
            style={styles.input}
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoFocus
            required
          />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.button} type="submit" disabled={loading}>
            {loading ? 'Enviando...' : 'Enviar link'}
          </button>
        </form>

        <Link to="/login" style={styles.link}>Volver al login</Link>
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
    lineHeight: 1.5,
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
  link: {
    display: 'block',
    marginTop: '24px',
    fontSize: '13px',
    color: '#0B1F3A',
    textAlign: 'center',
  },
}
