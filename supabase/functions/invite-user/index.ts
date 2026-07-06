// Edge Function: invite-user
//
// Invita a un usuario a un workspace por email (usando la Admin API de
// Supabase Auth, que requiere la service role key y por eso no puede
// llamarse directo desde el frontend), o cancela una invitación pendiente.
//
// Body esperado: { action: 'invite' | 'cancel', workspaceId, email, role }
// role solo es obligatorio para action: 'invite'.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://nerva-drab.vercel.app'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'No autorizado' }, 401)

  let payload: { action?: string; email?: string; role?: string; workspaceId?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const { action = 'invite', email, role, workspaceId } = payload
  if (!workspaceId) return json({ error: 'Falta workspaceId' }, 400)

  // Verificamos quién llama usando su propio JWT (no la service key)
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: caller } } = await callerClient.auth.getUser()
  if (!caller) return json({ error: 'No autorizado' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  // Solo owner/admin de ESE workspace pueden invitar o cancelar invitaciones
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
    return json({ error: 'No tenés permisos para gestionar usuarios en este workspace' }, 403)
  }

  if (action === 'cancel') {
    if (!email) return json({ error: 'Falta email' }, 400)

    // Si la cuenta invitada todavía no confirmó, la borramos para que el
    // link de invitación deje de funcionar. Si ya confirmó, no tocamos nada
    // (ya es un usuario real, "cancelar" ya no aplica).
    const { data: usersPage } = await admin.auth.admin.listUsers()
    const target = usersPage?.users?.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    )
    if (target && !target.email_confirmed_at) {
      await admin.auth.admin.deleteUser(target.id)
    }

    await admin
      .from('invitations')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('email', email.toLowerCase())

    return json({ ok: true })
  }

  // action === 'invite'
  if (!email || !role) return json({ error: 'Faltan datos' }, 400)

  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${SITE_URL}/set-password`,
    data: { invited_workspace_id: workspaceId, invited_role: role },
  })

  if (inviteError) return json({ error: inviteError.message }, 400)

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

  await admin.from('invitations').insert({
    workspace_id: workspaceId,
    email: email.toLowerCase(),
    role,
    token,
    expires_at: expiresAt,
  })

  return json({ ok: true })
})
