// supabase.functions.invoke() devuelve data: null cuando la función responde
// con status != 2xx — el body real (con el mensaje de error de la función)
// solo queda accesible vía error.context, que es el Response crudo.
export async function extractFunctionError(error) {
  try {
    const body = await error?.context?.json()
    return body?.error || null
  } catch {
    return null
  }
}
