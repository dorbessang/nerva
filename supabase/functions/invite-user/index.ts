// Edge Function: invite-user
//
// Invita a un usuario a un workspace por email (usando la Admin API de
// Supabase Auth, que requiere la service role key y por eso no puede
// llamarse directo desde el frontend), cancela una invitación pendiente, o
// (acción 'invite_client', solo para is_staff) da de alta un cliente nuevo
// de una — workspace de equipo nuevo + esa persona como owner.
// 'invite'/'cancel' requieren ser owner de ESE workspace; 'invite_client'
// requiere is_staff, porque todavía no existe ningún workspace al cual
// pedirle ownership.
//
// Body esperado: { action: 'invite' | 'cancel' | 'invite_client', workspaceId, email, role, workspaceName }
// workspaceId es obligatorio para 'invite'/'cancel'. role es obligatorio para 'invite'.
// workspaceName y email son obligatorios para 'invite_client'.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://nerva-drab.vercel.app'
// Sin dominio propio verificado en Resend todavía (ver PENDIENTES) — con la
// dirección de pruebas de Resend el mail solo entrega si el destinatario es
// el dueño de la cuenta de Resend. Cuando se verifique un dominio, cambiar
// este secret a algo tipo 'Nerva <invitaciones@tudominio.com>'.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const RESEND_FROM = Deno.env.get('RESEND_FROM') ?? 'Nerva <onboarding@resend.dev>'

const VALID_ROLES = ['owner', 'admin', 'editor', 'viewer']

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

// Manda el mail de invitación vía Resend (API HTTP directa, no el mailer de
// Supabase — generateLink no manda mail por su cuenta). Si no hay
// RESEND_API_KEY configurado como secret, o Resend rechaza el envío (ej.
// sandbox sin dominio propio, destinatario no es el dueño de la cuenta),
// no revienta la invitación entera — el link generado sigue devolviéndose
// en la respuesta para copiar a mano, como fallback.
async function sendInviteEmail(email: string, link: string, workspaceName: string | null) {
  if (!RESEND_API_KEY) return { sent: false }
  const wsPhrase = workspaceName ? ` a "${workspaceName}"` : ''
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [email],
        subject: `Te invitaron${wsPhrase} en Nerva`,
        html: `<p>Te invitaron${wsPhrase} en Nerva.</p><p><a href="${link}">Hacé click acá para crear tu cuenta</a></p><p>Si el link no funciona, copiá y pegá esta dirección en tu navegador:<br>${link}</p>`,
        text: `Te invitaron${wsPhrase} en Nerva.\n\nCreá tu cuenta acá: ${link}`,
      }),
    })
    if (!res.ok) {
      console.error('Resend error:', res.status, await res.text())
      return { sent: false }
    }
    return { sent: true }
  } catch (err) {
    console.error('Resend fetch error:', err)
    return { sent: false }
  }
}

// Comparte la lógica de "sumar a alguien a un workspace" entre 'invite'
// (owner invitando a su equipo) e 'invite_client' (staff dando de alta un
// cliente nuevo como owner de su propio workspace) — solo cambian el
// workspaceId (uno ya existente vs. recién creado) y el role.
async function addOrInviteUser(admin: AdminClient, email: string, role: string, workspaceId: string) {
  const { data: ws } = await admin.from('workspaces').select('name').eq('id', workspaceId).maybeSingle()
  const workspaceName = ws?.name || null

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

    await admin.from('notifications').insert({
      workspace_id: workspaceId,
      user_id: existingUser.id,
      type: 'added_to_workspace',
      title: 'Te sumaron a un workspace',
      body: `Ahora sos parte de "${workspaceName || 'un workspace'}" como ${role}.`,
    })

    return { direct: true }
  }

  // generateLink crea el usuario invitado (todavía sin contraseña) y el link
  // de acceso, pero no manda ningún mail (evita el rate limit del mailer
  // default de Supabase). Por ahora el link se muestra en la UI para que el
  // owner/staff lo copie y lo mande a mano; cuando se configure SMTP propio
  // (Resend) se puede mandar solo.
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

  const actionLink = linkData?.properties?.action_link ?? null
  const emailResult = actionLink ? await sendInviteEmail(email, actionLink, workspaceName) : { sent: false }

  return { inviteLink: actionLink, emailSent: emailResult.sent }
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
    return json({ ok: true, workspaceId: newWs.id, direct: result.direct, inviteLink: result.inviteLink, emailSent: result.emailSent })
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
  if (!VALID_ROLES.includes(role)) return json({ error: 'Rol inválido' }, 400)

  const result = await addOrInviteUser(admin, email, role, workspaceId)
  if (result.error) return json({ error: result.error }, 400)
  return json({ ok: true, direct: result.direct, inviteLink: result.inviteLink, emailSent: result.emailSent })
})
