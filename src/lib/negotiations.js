// Fetch completo de un proyecto — usado al abrir su detalle desde cualquier
// entrada (la propia página de Proyectos, o desde el detalle de una Entidad
// o un Producto vinculado). Antes cada página tenía su propia copia de este
// fetch, y se fueron desincronizando entre sí (una tenía `role` en
// negotiation_entities y otra no, una tenía negotiation_products y otra ni
// eso) — de ahí que el mismo proyecto se viera distinto según desde dónde se
// entraba. Una sola versión, reusada en los tres lugares.
export async function fetchFullNegotiation(supabase, id) {
  const [{ data: neg }, { data: ents }, { data: prods }, { data: notesList }] = await Promise.all([
    supabase.from('negotiations').select('*, primary_entity:primary_entity_id(id, name, country_code), primary_product:primary_product_id(id, name)').eq('id', id).single(),
    supabase.from('negotiation_entities').select('negotiation_id, entity_id, role, entity:entity_id(id, name, country_code, entity_type_id)').eq('negotiation_id', id),
    supabase.from('negotiation_products').select('negotiation_id, product_id, product:product_id(id, name)').eq('negotiation_id', id),
    supabase.from('negotiation_notes').select('id, negotiation_id, content, note_date').eq('negotiation_id', id).order('note_date'),
  ])
  if (!neg) return null
  return { ...neg, negotiation_entities: ents || [], negotiation_products: prods || [], notes_list: notesList || [] }
}
