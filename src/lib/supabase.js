import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)

export const PASSWORD_RECOVERY_KEY = 'nerva_password_recovery'

// Se registra acá, en el momento mismo en que se crea el cliente -- no
// adentro de un useEffect de React (como hace AuthContext con el resto de
// los cambios de sesión) -- porque si no se pierde una carrera real: en el
// flujo implícito (el que usa esta SPA), Supabase parsea el token de
// recuperación de la URL y dispara el evento PASSWORD_RECOVERY de forma
// asincrónica pero muy rápida, muy probablemente ANTES de que React termine
// el primer render y AuthContext llegue a suscribirse. Acá, en cambio, es el
// mismo archivo donde se crea el cliente, en el mismo bloque síncrono: no
// hay ningún hueco async entre crear el cliente y quedar suscripto, así que
// no se puede perder el evento pase lo que pase.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY') {
    sessionStorage.setItem(PASSWORD_RECOVERY_KEY, '1')
  }
})