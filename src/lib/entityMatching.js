// Matching de nombres para imports (entidades, y referencias a entidades
// desde productos/proyectos). Sin dependencias externas ni pg_trgm — el
// volumen de imports no lo justifica (mismo criterio que la búsqueda global,
// ver GlobalSearch.jsx). Todo corre en memoria contra la lista ya cargada.
//
// Dos niveles:
// - Coincidencia exacta tras normalizar (sin tildes/puntuación/sufijos
//   legales típicos): se resuelve sola, sin pedirle nada a nadie.
// - Coincidencia "parecida" por debajo del 100% pero por encima del umbral:
//   no se resuelve sola, queda para que la persona decida en el preview. El
//   umbral es deliberadamente flojo — los imports acá se usan poco y en
//   tandas grandes (migración, listados por proveedor), así que preguntar de
//   más sale más barato que dejar pasar un duplicado real.

const LEGAL_SUFFIX_WORDS = new Set([
  'sa', 'srl', 'sac', 'sacyf', 'sapem', 'ltda', 'llc', 'inc', 'corp', 'co', 'gmbh', 'bv', 'nv', 'plc', 'ag',
])

const FUZZY_THRESHOLD = 0.45
const MAX_CANDIDATES = 3

export function normalizeName(name) {
  if (!name) return ''
  const stripped = String(name)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, '') // "S.A." -> "sa", no "s a" (si no, no matchea contra el sufijo legal)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const tokens = stripped.split(' ').filter(t => t && !LEGAL_SUFFIX_WORDS.has(t))
  return tokens.join(' ')
}

function tokensOf(name) {
  return normalizeName(name).split(' ').filter(Boolean)
}

// Dice sobre el conjunto de palabras — agarra reordenamientos y variantes de
// sufijo ("Acme Distribuidora" ~ "Distribuidora Acme").
function tokenSimilarity(a, b) {
  if (a.length === 0 || b.length === 0) return 0
  const remaining = new Map()
  for (const t of b) remaining.set(t, (remaining.get(t) || 0) + 1)
  let overlap = 0
  for (const t of a) {
    const c = remaining.get(t)
    if (c > 0) { overlap++; remaining.set(t, c - 1) }
  }
  return (2 * overlap) / (a.length + b.length)
}

// Damerau-Levenshtein (con transposición) — agarra typos de tipeo
// ("Acem Corp" ~ "Acme Corp").
function editDistance(a, b) {
  const al = a.length, bl = b.length
  if (al === 0) return bl
  if (bl === 0) return al
  const d = Array.from({ length: al + 1 }, () => new Array(bl + 1).fill(0))
  for (let i = 0; i <= al; i++) d[i][0] = i
  for (let j = 0; j <= bl; j++) d[0][j] = j
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost)
      }
    }
  }
  return d[al][bl]
}

// Combina ambas señales y se queda con la más generosa — a propósito, porque
// el objetivo es avisar de más, no dejar pasar duplicados.
export function similarity(a, b) {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const byToken = tokenSimilarity(tokensOf(a), tokensOf(b))
  const dist = editDistance(na, nb)
  const byChars = 1 - dist / Math.max(na.length, nb.length)
  return Math.max(byToken, byChars)
}

// Compara `name` contra `candidates` y separa el resultado en coincidencia
// exacta (normalizada) y hasta MAX_CANDIDATES parecidas, ordenadas de más a
// menos parecidas.
export function matchEntity(name, candidates, getName = c => c.name) {
  const na = normalizeName(name)
  if (!na) return { exact: null, fuzzy: [] }
  let exact = null
  const fuzzy = []
  for (const c of candidates) {
    const cName = getName(c)
    if (normalizeName(cName) === na) { exact = c; continue }
    const score = similarity(name, cName)
    if (score >= FUZZY_THRESHOLD) fuzzy.push({ candidate: c, score })
  }
  fuzzy.sort((a, b) => b.score - a.score)
  return { exact, fuzzy: fuzzy.slice(0, MAX_CANDIDATES) }
}
