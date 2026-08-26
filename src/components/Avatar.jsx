import { AVATAR_PRESET_MAP } from '../lib/avatarPresets'
import './Avatar.css'

// Resuelve foto subida > ícono elegido de la galería > inicial del
// nombre (comportamiento de siempre) — un solo lugar para esta lógica,
// así no queda repetida en cada pantalla que muestra un avatar.
export default function Avatar({ profile, size = 32, className = '' }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) }

  if (profile?.avatar_url) {
    return <img className={`avatar-img ${className}`} style={style} src={profile.avatar_url} alt="" />
  }

  const preset = profile?.avatar_preset ? AVATAR_PRESET_MAP[profile.avatar_preset] : null
  if (preset) {
    return (
      <div className={`avatar-preset ${className}`} style={{ ...style, background: preset.bg }}>
        {preset.emoji}
      </div>
    )
  }

  const initial = (profile?.full_name || profile?.email || '?').trim()[0]?.toUpperCase() || '?'
  return <div className={`avatar-initial ${className}`} style={style}>{initial}</div>
}
