import { getInitials, getAvatarColor } from '../lib/avatarColors'
import './CardGrid.css'

// Vista Mosaico compartida por Proyectos/Entidades/Productos — un tile con
// avatar (iniciales + color por nombre), título truncado + insignia
// opcional, subtítulo opcional, badge de la derecha (ej. estado) y un pie
// opcional para chips/detalle. El checkbox de selección vive DENTRO del
// layout (primer elemento del flex), no flotando encima del contenido con
// position:absolute — así nunca se superpone con texto largo o insignias.
export function CardGrid({ children }) {
  return <div className="card-grid">{children}</div>
}

export function CardTile({
  avatarLabel,
  titlePrefix,
  title,
  titleBadge,
  subtitle,
  headerRight,
  footer,
  selected,
  showCheckbox,
  onToggleSelect,
  onClick,
  className,
}) {
  const [bg, fg] = getAvatarColor(avatarLabel || title)
  return (
    <div className={`card-tile ${className || ''}`} onClick={onClick}>
      {showCheckbox && (
        <input
          type="checkbox"
          className="card-tile-checkbox"
          checked={!!selected}
          onClick={e => e.stopPropagation()}
          onChange={onToggleSelect}
        />
      )}
      <div className="card-tile-avatar" style={{ backgroundColor: bg, color: fg }}>
        {getInitials(avatarLabel || title)}
      </div>
      <div className="card-tile-body">
        <div className="card-tile-header-row">
          <div className="card-tile-header">
            <h3 className="card-tile-title">
              {titlePrefix}
              <span className="card-tile-title-text">{title}</span>
              {titleBadge}
            </h3>
            {subtitle && <p className="card-tile-subtitle">{subtitle}</p>}
          </div>
          {headerRight && <div className="card-tile-header-right">{headerRight}</div>}
        </div>
        {footer && <div className="card-tile-footer">{footer}</div>}
      </div>
    </div>
  )
}

export function CardTileNew({ label, onClick }) {
  return (
    <div className="card-tile card-tile-new" onClick={onClick}>
      <span>{label}</span>
    </div>
  )
}
