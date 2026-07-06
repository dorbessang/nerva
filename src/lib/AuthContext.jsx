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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (session?.user) fetchWorkspaces(session.user.id)
      else {
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
        .select('role, workspace_id, workspace:workspace_id(id, name, type)')
        .eq('user_id', userId)
        .eq('status', 'active'),
      supabase
        .from('profiles')
        .select('full_name, avatar_url, is_staff')
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

    const memberWorkspaces = data.map(m => ({ ...m.workspace, role: m.role }))
    setWorkspaces(memberWorkspaces)

    const savedId = localStorage.getItem('nerva_active_workspace')
    const savedExists = memberWorkspaces.find(w => w.id === savedId)
    const testingWs = memberWorkspaces.find(w => w.type === 'testing')
    const active = savedExists || testingWs || memberWorkspaces[0]

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
      .select('full_name, avatar_url, is_staff')
      .eq('id', user.id)
      .single()
    setProfile(data ?? null)
  }

  return (
    <AuthContext.Provider value={{ user, session, role, effectiveRole, isStaff, impersonateRole, profile, refreshProfile, workspaceId, workspaces, setActiveWorkspace, refreshWorkspaces, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
