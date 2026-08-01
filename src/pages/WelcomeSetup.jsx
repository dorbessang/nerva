import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { seedWorkspaceRecommended, seedWorkspaceMinimal } from '../lib/seedWorkspaceDefaults'
import './WelcomeSetup.css'

export default function WelcomeSetup({ workspace }) {
  const { refreshWorkspaces } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(null) // 'recommended' | 'minimal' | null
  const [error, setError] = useState(null)

  async function markOnboarded() {
    await supabase.from('workspaces').update({ onboarded: true }).eq('id', workspace.id)
    await refreshWorkspaces()
  }

  async function handleChoice(kind) {
    setError(null)
    setLoading(kind)
    try {
      if (kind === 'recommended') await seedWorkspaceRecommended(workspace.id)
      else await seedWorkspaceMinimal(workspace.id)
      await markOnboarded()
      navigate('/settings')
    } catch {
      setError('Ocurrió un error al configurar el espacio de trabajo. Probá de nuevo.')
      setLoading(null)
    }
  }

  return (
    <div className="welcome-setup">
      <div className="welcome-setup-card">
        <h1 className="welcome-setup-title">¡Bienvenido a {workspace.name}!</h1>
        <p className="welcome-setup-subtitle">
          Este espacio de trabajo todavía no tiene nada configurado. Elegí cómo querés arrancar.
        </p>

        <div className="welcome-setup-options">
          <div className="welcome-option">
            <h3>Configuración recomendada</h3>
            <p>
              Tipos de entidad (Proveedor, Cliente, Distribuidor), un pipeline de 5 estados
              y los campos habituales de un proyecto de licensing (país, sitio web, entidades
              vinculadas, participantes, financiero y más). Todo editable después desde Configuración.
            </p>
            <button
              className="welcome-option-btn welcome-option-btn--primary"
              disabled={loading !== null}
              onClick={() => handleChoice('recommended')}
            >
              {loading === 'recommended' ? 'Configurando...' : 'Usar configuración recomendada'}
            </button>
          </div>

          <div className="welcome-option">
            <h3>Armarlo yo mismo</h3>
            <p>
              Solo lo indispensable para que la app funcione (nombre, tipo, contactos, estado).
              Sin tipos de entidad ni campos sugeridos — los vas a elegir vos mismo desde Configuración.
            </p>
            <button
              className="welcome-option-btn"
              disabled={loading !== null}
              onClick={() => handleChoice('minimal')}
            >
              {loading === 'minimal' ? 'Configurando...' : 'Empezar desde lo mínimo'}
            </button>
          </div>
        </div>

        {error && <p className="welcome-setup-error">{error}</p>}
      </div>
    </div>
  )
}
