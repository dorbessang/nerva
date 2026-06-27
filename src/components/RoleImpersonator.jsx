import { useAuth } from '../lib/AuthContext'
import './RoleImpersonator.css'

const ROLES = ['owner', 'admin', 'editor', 'viewer']

const ROLE_LABELS = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

const ROLE_COLORS = {
  owner: '#0B1F3A',
  admin: '#6D28D9',
  editor: '#059669',
  viewer: '#9ca3af',
}

export default function RoleImpersonator() {
  const { isStaff, role, effectiveRole, impersonateRole } = useAuth()

  if (!isStaff) return null

  const isImpersonating = effectiveRole !== role

  return (
    <div className={`role-imp ${isImpersonating ? 'role-imp--active' : ''}`}>
      <div className="role-imp-label">
        {isImpersonating ? '👁 Viendo como' : '🛠 Staff'}
      </div>
      <div className="role-imp-pills">
        {ROLES.map(r => (
          <button
            key={r}
            className={`role-imp-pill ${effectiveRole === r ? 'role-imp-pill--selected' : ''}`}
            style={effectiveRole === r ? { background: ROLE_COLORS[r], color: '#fff', borderColor: ROLE_COLORS[r] } : {}}
            onClick={() => impersonateRole(r)}
            title={r === role ? 'Tu rol real' : `Ver como ${ROLE_LABELS[r]}`}
          >
            {ROLE_LABELS[r]}
            {r === role && <span className="role-imp-real-dot" title="Tu rol real" />}
          </button>
        ))}
      </div>
      {isImpersonating && (
        <button className="role-imp-reset" onClick={() => impersonateRole(role)} title="Volver a tu rol real">
          ↩ volver a {ROLE_LABELS[role]}
        </button>
      )}
    </div>
  )
}
