import { vi } from 'vitest'

// Fake encadenable mínimo para supabase-js: cada método de la cadena
// (select/eq/order/in/etc.) devuelve el mismo objeto para poder seguir
// encadenando, y el objeto es "thenable" para que un `await` final resuelva
// al resultado que se le pasó.
export function createQueryResult(result = { data: null, error: null }) {
  const chain = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    upsert: () => chain,
    delete: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    is: () => chain,
    gte: () => chain,
    lte: () => chain,
    gt: () => chain,
    lt: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

// Fake de supabase.from(table) — `resultsByTable` mapea nombre de tabla al
// resultado { data, error } que esa tabla debería devolver en el test.
export function createSupabaseMock(resultsByTable = {}) {
  return {
    from: vi.fn((table) => createQueryResult(resultsByTable[table] || { data: null, error: null })),
    auth: {
      signInWithPassword: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
      getUser: vi.fn(() => Promise.resolve({ data: { user: null } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  }
}
