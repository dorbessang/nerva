import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)
  const [profile, setProfile] = useState(null)
  const [isStaff, setIsStaff] = useState(false)
  const [effectiveRole, setEffectiveRole] = useState(null)
  const [workspaceId, setWorkspaceId] = useState(null)
  const [workspaces, setWorkspaces] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) fetchWorkspaces(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      // TOKEN_REFRESHED dispara solo (sin acción del usuario) cada vez que
      // la pestaña/ventana recupera el foco — Supabase renueva el token
      // solo. Antes esto igual pasaba por el branch de abajo, poniendo
      // loading=true un instante: ProtectedRoute desmonta <Layout> mientras
      // tanto, y con eso se perdía cualquier estado local de la pantalla
      // (ej. la pestaña activa en Configuración/Perfil volvía siempre a la
      // primera). Nada cambió realmente (misma sesión, mismo usuario), así
      // que no hace falta recargar profile/workspaces ni mostrar "Cargando".
      if (event === 'TOKEN_REFRESHED') return
      if (session?.user) {
        // Vuelve a "cargando" (y limpia el profile viejo) apenas cambia la
        // sesión — sin esto, un cambio de sesión en la misma pestaña (ej. el
        // link de invitación reemplazando una sesión ya activa) podía
        // renderizar un instante con el profile de la sesión ANTERIOR
        // todavía en memoria, lo que rompía la decisión de needsOnboarding.
        setLoading(true)
        setProfile(null)
        fetchWorkspaces(session.user.id)
      } else {
        setRole(null)
        setProfile(null)
        setIsStaff(false)
        setEffectiveRole(null)
        setWorkspaceId(null)
        setWorkspaces([])
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchWorkspaces(userId) {
    const [membersRes, profileRes] = await Promise.all([
      supabase
        .from('workspace_members')
        .select('role, workspace_id, workspace:workspace_id(id, name, type, onboarded, low_activity_alert_days, low_activity_inactive_days)')
        .eq('user_id', userId)
        .eq('status', 'active'),
      supabase
        .from('profiles')
        .select('full_name, is_staff, avatar_url, avatar_preset, phone, job_title, department, birthday, city, timezone, linkedin_url, bio, language')
        .eq('id', userId)
        .single(),
    ])

    setProfile(profileRes.data ?? null)
    const staff = profileRes.data?.is_staff === true
    setIsStaff(staff)

    const data = membersRes.data
    if (!data || data.length === 0) {
      setLoading(false)
      return
    }

    const workspaceIds = data.map(m => m.workspace_id)
    const { data: rulesData } = await supabase.from('approval_rules').select('*').in('workspace_id', workspaceIds)

    const memberWorkspaces = data.map(m => ({
      ...m.workspace,
      role: m.role,
      approval_rules: (rulesData ?? []).filter(r => r.workspace_id === m.workspace_id),
    }))
    setWorkspaces(memberWorkspaces)

    const savedId = localStorage.getItem('nerva_active_workspace')
    const savedExists = memberWorkspaces.find(w => w.id === savedId)
    const testingWs = memberWorkspaces.find(w => w.type === 'testing')
    // El WS personal se crea automático al firmar (trigger de signup), antes
    // de que se lo invite a ningún WS de equipo — sin este orden explícito,
    // sin nada guardado todavía cae en el personal por ser el primero
    // creado, aunque el usuario haya entrado específicamente para trabajar
    // en el WS de equipo al que lo invitaron.
    const teamWs = memberWorkspaces.find(w => w.type !== 'personal')
    const active = savedExists || testingWs || teamWs || memberWorkspaces[0]

    const realRole = data.find(m => m.workspace_id === active.id)?.role ?? null
    setWorkspaceId(active.id)
    setRole(realRole)
    setEffectiveRole(realRole)
    setLoading(false)
  }

  function setActiveWorkspace(wsId) {
    const member = workspaces.find(w => w.id === wsId)
    if (!member) return
    setWorkspaceId(wsId)
    setRole(member.role)
    setEffectiveRole(member.role)
    localStorage.setItem('nerva_active_workspace', wsId)
  }

  // El staff puede "ver como" cualquier rol sin techo -- a propósito (ver
  // PENDIENTES.md, "Solicitud de acción de staff por encima de su rol
  // real"): la restricción real no está acá, está en que actuar con un
  // privilegio por encima del rol real pasa por una solicitud que un
  // owner del workspace tiene que aprobar antes de que se ejecute.
  function impersonateRole(newRole) {
    if (!isStaff) return
    setEffectiveRole(newRole)
  }

  async function refreshWorkspaces() {
    if (user) await fetchWorkspaces(user.id)
  }

  async function refreshProfile() {
    if (!user) return
    const { data } = await supabase
      .from('profiles')
      .select('full_name, is_staff, avatar_url, avatar_preset, phone, job_title, department, birthday, city, timezone, linkedin_url, bio, language')
      .eq('id', user.id)
      .single()
    setProfile(data ?? null)
  }

  const activeWorkspace = workspaces.find(w => w.id === workspaceId) || null

  // Única forma de crear una cuenta es por invitación, y full_name solo se
  // completa al mandar el formulario de "Crear contraseña" (SetPassword) —
  // así que un profile ya cargado con full_name vacío significa, sin
  // ambigüedad, que esta persona todavía no terminó el alta. Sirve de
  // guardia a nivel de toda la app: sin importar cómo haya quedado la
  // sesión activa (link de invitación, pestaña vieja, lo que sea), si no
  // completó el alta no puede usar el resto de la app.
  const needsOnboarding = !loading && !!user && profile !== null && !profile?.full_name

  return (
    <AuthContext.Provider value={{ user, session, role, effectiveRole, isStaff, impersonateRole, profile, refreshProfile, workspaceId, workspaces, activeWorkspace, setActiveWorkspace, refreshWorkspaces, loading, needsOnboarding }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
