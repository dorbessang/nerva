import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) fetchWorkspaces(session.user.id)
      else {
        setRole(null)
        setWorkspaceId(null)
        setWorkspaces([])
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchWorkspaces(userId) {
    const { data } = await supabase
      .from('workspace_members')
      .select('role, workspace_id, workspace:workspace_id(id, name, type)')
      .eq('user_id', userId)
      .eq('status', 'active')

    if (!data || data.length === 0) {
      setLoading(false)
      return
    }

    const memberWorkspaces = data.map(m => ({ ...m.workspace, role: m.role }))
    setWorkspaces(memberWorkspaces)

    // Usar el último workspace activo guardado, o el testing si existe, o el primero disponible
    const savedId = localStorage.getItem('nerva_active_workspace')
    const savedExists = memberWorkspaces.find(w => w.id === savedId)
    const testingWs = memberWorkspaces.find(w => w.type === 'testing')
    const active = savedExists || testingWs || memberWorkspaces[0]

    setWorkspaceId(active.id)
    setRole(data.find(m => m.workspace_id === active.id)?.role ?? null)
    setLoading(false)
  }

  // Llamado desde el workspace switcher en el header
  function setActiveWorkspace(wsId) {
    const member = workspaces.find(w => w.id === wsId)
    if (!member) return
    setWorkspaceId(wsId)
    setRole(member.role)
    localStorage.setItem('nerva_active_workspace', wsId)
  }

  // Llamado desde Settings cuando se edita el nombre del workspace
  async function refreshWorkspaces() {
    if (user) await fetchWorkspaces(user.id)
  }

  return (
    <AuthContext.Provider value={{ user, session, role, workspaceId, workspaces, setActiveWorkspace, refreshWorkspaces, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
