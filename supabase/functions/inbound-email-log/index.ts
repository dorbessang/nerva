// Edge Function: inbound-email-log
//
// Webhook de Resend (evento email.received) — MVP de captura de actividad
// por mail, Fase B del roadmap. Cualquiera de tu equipo puede CCear
// log@gonerva.com en un mail a un contacto ya cargado en Nerva, y queda
// logueado solo en la bitácora de la entidad correspondiente.
//
// Matcheo (deliberadamente acotado a v1 — ver PENDIENTES.md):
//   1. El remitente ("from" del mail) tiene que ser un usuario real de
//      Nerva (profiles.email) — si no, se descarta en silencio.
//   2. El contacto externo es cualquier dirección en to/cc que no sea la
//      del propio remitente ni la de captura — se busca contra
//      contacts.email dentro de los workspaces de equipo de ese usuario.
//   3. Si matchea, se loguea UNA entrada de activity_log por entidad
//      encontrada (no por proyecto — la entidad es el hub, su timeline ya
//      agrega la actividad de todos los proyectos vinculados).
// No cubre el caso inverso (un contacto le hace "responder a todos" a un
// hilo viejo donde ya estaba cc log@) — el remitente en ese caso no es un
// usuario de Nerva y el mail se descarta. Se puede sumar después si hace
// falta, no es necesario para la primera versión.
//
// Seguridad: Resend firma sus webhooks con Svix (headers svix-id/
// svix-timestamp/svix-signature, HMAC-SHA256 sobre "id.timestamp.body").
// Sin el secret correcto configurado, la función rechaza todo (401) — no
// hay fallback inseguro.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const WEBHOOK_SECRET = Deno.env.get('RESEND_INBOUND_WEBHOOK_SECRET') ?? ''
const CAPTURE_ADDRESS = 'log@gonerva.com'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

async function isValidSignature(req: Request, rawBody: string): Promise<boolean> {
  if (!WEBHOOK_SECRET) return false
  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')
  if (!svixId || !svixTimestamp || !svixSignature) return false

  const secretBytes = base64ToBytes(WEBHOOK_SECRET.replace(/^whsec_/, ''))
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent))
  const expected = bytesToBase64(new Uint8Array(sigBuf))

  return svixSignature.split(' ').some(part => part.split(',')[1] === expected)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const rawBody = await req.text()

  if (!(await isValidSignature(req, rawBody))) {
    return new Response('Invalid signature', { status: 401 })
  }

  let payload: any
  try { payload = JSON.parse(rawBody) } catch { return new Response('Bad JSON', { status: 400 }) }

  if (payload.type !== 'email.received') return new Response('ignored', { status: 200 })

  const data = payload.data ?? {}
  const fromEmail = String(data.from ?? '').toLowerCase().trim()
  const toAndCc = [...(data.to ?? []), ...(data.cc ?? [])].map((e: string) => String(e).toLowerCase().trim())
  const subject = data.subject || '(sin asunto)'
  if (!fromEmail) return new Response('ok', { status: 200 })

  const { data: profile } = await supabase.from('profiles').select('id, email').ilike('email', fromEmail).maybeSingle()
  if (!profile) return new Response('ok', { status: 200 })

  const { data: memberships } = await supabase
    .from('workspace_members')
    .select('workspace_id, workspace:workspace_id(type)')
    .eq('user_id', profile.id)
    .eq('status', 'active')
  const workspaceIds = (memberships ?? [])
    .filter((m: any) => m.workspace?.type === 'team')
    .map((m: any) => m.workspace_id)
  if (workspaceIds.length === 0) return new Response('ok', { status: 200 })

  const candidateEmails = toAndCc.filter(e => e && e !== fromEmail && e !== CAPTURE_ADDRESS)
  if (candidateEmails.length === 0) return new Response('ok', { status: 200 })

  const { data: contacts } = await supabase
    .from('contacts')
    .select('entity_id, email, workspace_id')
    .in('workspace_id', workspaceIds)
    .not('email', 'is', null)

  const matchedEntityIds = new Set<string>()
  for (const c of contacts ?? []) {
    const email = String(c.email ?? '').toLowerCase().trim()
    if (email && candidateEmails.includes(email)) matchedEntityIds.add(`${c.workspace_id}::${c.entity_id}`)
  }

  for (const key of matchedEntityIds) {
    const [workspaceId, entityId] = key.split('::')
    await supabase.from('activity_log').insert({
      workspace_id: workspaceId,
      entity_id: entityId,
      type: 'email_logged',
      title: `Email: "${subject}"`,
      actor_id: profile.id,
    })
  }

  return new Response('ok', { status: 200 })
})
