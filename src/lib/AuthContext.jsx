import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

// ID del workspace activo — por ahora fijo, en el futuro vendrá del selector de workspace
const WORKSPACE_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [role, setRole] = useState(null)
  const [workspaceId, setWorkspaceId] = useState(WORKSPACE_ID)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) fetchRole(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) fetchRole(session.user.id)
      else {
        setRole(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchRole(userId) {
    const { data } = await supabase
      .from('workspace_members')
      .select('role, workspace_id')
      .eq('user_id', userId)
      .eq('workspace_id', WORKSPACE_ID)
      .single()
    setRole(data?.role ?? null)
    setLoading(false)
  }

  return (
    <AuthContext.Provider value={{ user, session, role, workspaceId, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}