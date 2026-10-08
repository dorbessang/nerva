import { supabase } from './supabase'

// Login con email y password
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

// Pide el mail de reseteo de contraseña. La doc de Supabase no lo dice
// explícito para este método puntual (sí para signInWithPassword/signUp),
// pero es el comportamiento estándar documentado para el resto de la API
// de auth: no debería distinguir si el email existe o no. ForgotPassword.jsx
// muestra siempre el mismo mensaje de éxito, sin depender de esto.
export async function requestPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  })
  if (error) throw error
}

// Logout
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// Usuario actual
export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// Sesión activa (para proteger rutas)
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// Escucha cambios de sesión (login / logout)
export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
}