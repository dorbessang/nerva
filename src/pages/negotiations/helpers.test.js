import { describe, it, expect } from 'vitest'
import {
  getProductName,
  getEntitiesOfType,
  statusFilterIncludes,
  getExportValue,
  getNegSortValue,
  formatQuoteDate,
  ALL_COLUMNS,
} from './helpers'

describe('getProductName', () => {
  it('usa primary_product si está', () => {
    expect(getProductName({ primary_product: { name: 'Widget' } })).toBe('Widget')
  })

  it('cae al primer producto de negotiation_products si no hay primary_product', () => {
    expect(getProductName({ negotiation_products: [{ product: { name: 'Gadget' } }] })).toBe('Gadget')
  })

  it('devuelve el guion si no hay ningún producto vinculado', () => {
    expect(getProductName({})).toBe('—')
  })
})

describe('getEntitiesOfType', () => {
  const cliente = { id: 'e1', name: 'Acme' }
  const proveedor = { id: 'e2', name: 'FQM' }
  const neg = {
    negotiation_entities: [
      { role: 'cliente', entity: cliente },
      { entity: proveedor, entity_type_id_fallback: true }, // sin role -> cae al entity_type_id de abajo
    ],
  }

  it('filtra por role si está seteado en el vínculo', () => {
    expect(getEntitiesOfType(neg, 'cliente')).toEqual([cliente])
  })

  it('cae al entity_type_id de la entidad cuando el vínculo no tiene role (backfill viejo)', () => {
    const negSinRole = { negotiation_entities: [{ entity: { ...proveedor, entity_type_id: 'proveedor' } }] }
    expect(getEntitiesOfType(negSinRole, 'proveedor')).toEqual([{ ...proveedor, entity_type_id: 'proveedor' }])
  })

  it('devuelve vacío si no hay negotiation_entities', () => {
    expect(getEntitiesOfType({}, 'cliente')).toEqual([])
  })
})

describe('statusFilterIncludes', () => {
  it('matchea valor único', () => {
    expect(statusFilterIncludes('Ganado', 'Ganado')).toBe(true)
    expect(statusFilterIncludes('Ganado', 'Perdido')).toBe(false)
  })

  it('matchea array (checklist tipo Excel)', () => {
    expect(statusFilterIncludes(['Ganado', 'Perdido'], 'Perdido')).toBe(true)
    expect(statusFilterIncludes(['Ganado'], 'Perdido')).toBe(false)
  })
})

describe('formatQuoteDate', () => {
  it('formatea a "D de mes. YYYY" sin cero adelante', () => {
    expect(formatQuoteDate('2026-09-01')).toBe('1 de sept. 2026')
  })

  it('usa la abreviatura correcta para cada mes', () => {
    expect(formatQuoteDate('2026-01-15')).toBe('15 de ene. 2026')
    expect(formatQuoteDate('2026-12-25')).toBe('25 de dic. 2026')
  })
})

describe('getExportValue', () => {
  it('product: usa product, cae a title', () => {
    expect(getExportValue('product', { product: 'Widget' })).toBe('Widget')
    expect(getExportValue('product', { title: 'Sin producto' })).toBe('Sin producto')
  })

  it('status/target_date/observations: texto plano o vacío', () => {
    expect(getExportValue('status', { status: 'Ganado' })).toBe('Ganado')
    expect(getExportValue('target_date', {})).toBe('')
    expect(getExportValue('observations', { observations: 'Ojo con esto' })).toBe('Ojo con esto')
  })

  it('activity_status: usa el label en español', () => {
    expect(getExportValue('activity_status', { activity_status: 'paused' })).toBe('Pausado')
  })

  it('last_activity_at: recorta a solo la fecha (sin hora)', () => {
    expect(getExportValue('last_activity_at', { last_activity_at: '2026-09-01T10:30:00Z' })).toBe('2026-09-01')
  })

  it('entity_type:<id>: junta los nombres de las entidades de ese tipo', () => {
    const neg = { negotiation_entities: [{ role: 'cliente', entity: { name: 'Acme' } }] }
    expect(getExportValue('entity_type:cliente', neg)).toBe('Acme')
  })

  it('campo custom sin definición: vacío', () => {
    expect(getExportValue('campo_inexistente', {}, null, [])).toBe('')
  })
})

describe('getNegSortValue', () => {
  it('product: en minúsculas para ordenar case-insensitive', () => {
    expect(getNegSortValue('product', { product: 'Widget' })).toBe('widget')
  })

  it('target_date inválida o ausente ordena null (al final, ver sortRows)', () => {
    expect(getNegSortValue('target_date', {})).toBe(null)
  })

  it('target_date válida devuelve un timestamp numérico', () => {
    const t = getNegSortValue('target_date', { target_date: '2026-01-01' })
    expect(typeof t).toBe('number')
  })

  it('notes: cuenta la cantidad de notas, null si no hay ninguna', () => {
    expect(getNegSortValue('notes', { notes_list: [{}, {}] })).toBe(2)
    expect(getNegSortValue('notes', {})).toBe(null)
  })
})

describe('ALL_COLUMNS', () => {
  it('no duplica keys (cada columna calculada/legacy aparece una sola vez)', () => {
    const keys = ALL_COLUMNS.map(c => c.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
