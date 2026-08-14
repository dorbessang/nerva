// Edge Function: invite-user
//
// Invita a un usuario a un workspace por email (usando la Admin API de
// Supabase Auth, que requiere la service role key y por eso no puede
// llamarse directo desde el frontend), cancela una invitación pendiente,
// (acción 'invite_client', solo para is_staff) da de alta un cliente nuevo
// de una — workspace de equipo nuevo + esa persona como owner, o (acción
// 'delete_user', solo para is_staff) borra una cuenta por completo.
// 'invite'/'cancel' requieren ser owner de ESE workspace; 'invite_client' y
// 'delete_user' requieren is_staff (el primero porque todavía no existe
// ningún workspace al cual pedirle ownership; el segundo es una acción
// global, no de un workspace puntual).
//
// Body esperado: { action: 'invite' | 'cancel' | 'invite_client' | 'delete_user', workspaceId, email, role, workspaceName }
// workspaceId es obligatorio para 'invite'/'cancel'. role es obligatorio para 'invite'.
// workspaceName y email son obligatorios para 'invite_client'. email es obligatorio para 'delete_user'.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Sin el replace, un SITE_URL con "/" al final produciría "//set-password"
// en el link del mail — con BrowserRouter esa ruta no matchea "/set-password"
// y cae en el catch-all a /dashboard, salteando el formulario sin error visible.
const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://www.gonerva.com').replace(/\/+$/, '')
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const INVITE_FROM = 'Nerva <invitaciones@gonerva.com>'

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

// deno-lint-ignore no-explicit-any
type AdminClient = any

// Manda el mail de invitación por Resend. Si falla (o no hay API key
// configurada todavía), no tira la invitación entera abajo — el owner
// siempre se queda con el link a mano para mandarlo manual como fallback.
async function sendInviteEmail(email: string, inviteLink: string, workspaceName: string) {
  if (!RESEND_API_KEY) return false

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: INVITE_FROM,
        to: email,
        subject: `Te invitaron a "${workspaceName}" en Nerva`,
        html: `
          <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>Te invitaron a Nerva</h2>
            <p>Te sumaron al workspace <strong>${workspaceName}</strong>. Hacé click abajo para crear tu contraseña y entrar.</p>
            <p style="margin: 24px 0;">
              <a href="${inviteLink}" style="background: #111; color: #fff; padding: 12px 20px; border-radius: 6px; text-decoration: none;">Crear mi cuenta</a>
            </p>
            <p style="color: #666; font-size: 13px;">Si el botón no funciona, copiá este link: <br>${inviteLink}</p>
          </div>
        `,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

// Comparte la lógica de "sumar a alguien a un workspace" entre 'invite'
// (owner invitando a su equipo) e 'invite_client' (staff dando de alta un
// cliente nuevo como owner de su propio workspace) — solo cambian el
// workspaceId (uno ya existente vs. recién creado) y el role.
async function addOrInviteUser(admin: AdminClient, email: string, role: string, workspaceId: string) {
  // Si el email ya tiene una cuenta confirmada (aceptó una invitación antes,
  // en este workspace o en otro), no se puede volver a invitar por mail:
  // ya tiene contraseña propia. Lo sumamos directo al workspace.
  const { data: usersPage } = await admin.auth.admin.listUsers({ perPage: 1000 })
  const existingUser = usersPage?.users?.find(
    (u: { email?: string }) => u.email?.toLowerCase() === email.toLowerCase(),
  )

  if (existingUser && existingUser.email_confirmed_at) {
    const { data: existingMember } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', existingUser.id)
      .maybeSingle()

    if (existingMember) return { error: 'Ese usuario ya es miembro de este workspace' }

    const { error: memberError } = await admin.from('workspace_members').insert({
      workspace_id: workspaceId,
      user_id: existingUser.id,
      role,
      status: 'active',
    })
    if (memberError) return { error: memberError.message }

    const { data: ws } = await admin.from('workspaces').select('name').eq('id', workspaceId).maybeSingle()
    await admin.from('notifications').insert({
      workspace_id: workspaceId,
      user_id: existingUser.id,
      type: 'added_to_workspace',
      title: 'Te sumaron a un workspace',
      body: `Ahora sos parte de "${ws?.name || 'un workspace'}" como ${role}.`,
    })

    return { direct: true }
  }

  // Existe pero nunca puso contraseña — típicamente alguien que se sacó de
  // un workspace (o se le canceló la invitación por otro lado) antes de
  // aceptarla. generateLink('invite') rechaza el pedido si el email ya está
  // registrado, aunque sea sin confirmar, así que lo borramos primero: no
  // pierde nada real (nunca tuvo acceso a nada) y queda libre para invitar
  // de cero, incluso a un workspace distinto del original.
  if (existingUser && !existingUser.email_confirmed_at) {
    await admin.auth.admin.deleteUser(existingUser.id)
  }

  // generateLink crea el usuario invitado (todavía sin contraseña) y el link
  // de acceso, pero no manda ningún mail (evita el rate limit del mailer
  // default de Supabase) — el mail real se manda aparte, por Resend, más
  // abajo. El link se sigue devolviendo igual a la UI como fallback, por si
  // el mail no llega (falla Resend, cae en spam, etc.).
  const { data: linkData, error: inviteError } = await admin.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      redirectTo: `${SITE_URL}/set-password`,
      data: { invited_workspace_id: workspaceId, invited_role: role },
    },
  })

  if (inviteError) return { error: inviteError.message }

  // Bug real corregido acá: antes esto no pasaba nunca para un invitado
  // nuevo — solo el branch de "usuario ya confirmado" (arriba) insertaba en
  // workspace_members. Un invitado nuevo quedaba con el usuario de auth
  // creado y un link enviado, pero SIN ningún acceso real al workspace —
  // nada en el resto del código (ni SetPassword.jsx, que no lee estos
  // metadatos) completaba esa parte. Se inserta ahora mismo, con el id que
  // generateLink ya devuelve, para no depender de ese paso pendiente.
  const newUserId = linkData?.user?.id
  if (newUserId) {
    await admin.from('workspace_members').insert({
      workspace_id: workspaceId,
      user_id: newUserId,
      role,
      status: 'active',
    })
  }

  const token = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

  await admin.from('invitations').insert({
    workspace_id: workspaceId,
    email: email.toLowerCase(),
    role,
    token,
    expires_at: expiresAt,
  })

  const inviteLink = linkData?.properties?.action_link ?? null
  let emailSent = false
  if (inviteLink) {
    const { data: ws } = await admin.from('workspaces').select('name').eq('id', workspaceId).maybeSingle()
    emailSent = await sendInviteEmail(email, inviteLink, ws?.name || 'tu workspace')
  }

  return { inviteLink, emailSent }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'No autorizado' }, 401)

  let payload: { action?: string; email?: string; role?: string; workspaceId?: string; workspaceName?: string }
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Body inválido' }, 400)
  }

  const { action = 'invite', email, role, workspaceId, workspaceName } = payload

  // Verificamos quién llama usando su propio JWT (no la service key)
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user: caller } } = await callerClient.auth.getUser()
  if (!caller) return json({ error: 'No autorizado' }, 401)

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  if (action === 'delete_user') {
    if (!email) return json({ error: 'Falta email' }, 400)

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('is_staff')
      .eq('id', caller.id)
      .maybeSingle()
    if (!callerProfile?.is_staff) {
      return json({ error: 'No tenés permisos para eliminar usuarios' }, 403)
    }

    const { data: usersPage } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const target = usersPage?.users?.find(
      (u: { id: string; email?: string }) => u.email?.toLowerCase() === email.toLowerCase(),
    )
    if (!target) return json({ error: 'No existe ningún usuario con ese email' }, 404)

    // notifications/notification_preferences no tienen ON DELETE en su FK a
    // profiles — hay que vaciarlas antes o el delete de auth.users (que
    // cascadea a profiles) se rechaza. workspace_members sí cascadea solo.
    await admin.from('notifications').delete().eq('user_id', target.id)
    await admin.from('notification_preferences').delete().eq('user_id', target.id)
    await admin.from('invitations').delete().eq('email', email.toLowerCase())

    const { error: delError } = await admin.auth.admin.deleteUser(target.id)
    if (delError) return json({ error: delError.message }, 400)

    return json({ ok: true })
  }

  if (action === 'invite_client') {
    if (!email || !workspaceName) return json({ error: 'Faltan datos' }, 400)

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('is_staff')
      .eq('id', caller.id)
      .maybeSingle()
    if (!callerProfile?.is_staff) {
      return json({ error: 'No tenés permisos para dar de alta un cliente nuevo' }, 403)
    }

    const { data: newWs, error: wsError } = await admin
      .from('workspaces')
      .insert({ name: workspaceName.trim(), type: 'team', onboarded: false })
      .select('id')
      .single()
    if (wsError || !newWs) return json({ error: wsError?.message || 'No se pudo crear el workspace' }, 400)

    const result = await addOrInviteUser(admin, email, 'owner', newWs.id)
    if (result.error) return json({ error: result.error }, 400)
    return json({
      ok: true,
      workspaceId: newWs.id,
      direct: result.direct,
      inviteLink: result.inviteLink,
      emailSent: result.emailSent,
    })
  }

  if (!workspaceId) return json({ error: 'Falta workspaceId' }, 400)

  // Solo el owner de ESE workspace puede invitar o cancelar invitaciones
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', caller.id)
    .maybeSingle()

  if (!membership || membership.role !== 'owner') {
    return json({ error: 'No tenés permisos para gestionar usuarios en este workspace' }, 403)
  }

  if (action === 'cancel') {
    if (!email) return json({ error: 'Falta email' }, 400)

    // Si la cuenta invitada todavía no confirmó, la borramos para que el
    // link de invitación deje de funcionar. Si ya confirmó, no tocamos nada
    // (ya es un usuario real, "cancelar" ya no aplica).
    const { data: usersPage } = await admin.auth.admin.listUsers({ perPage: 1000 })
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

  const result = await addOrInviteUser(admin, email, role, workspaceId)
  if (result.error) return json({ error: result.error }, 400)
  return json({ ok: true, direct: result.direct, inviteLink: result.inviteLink, emailSent: result.emailSent })
})
