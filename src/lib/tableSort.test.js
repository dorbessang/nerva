import { describe, it, expect } from 'vitest'
import { nextSortDir, naturalCompare, sortRows, naturalSortByName } from './tableSort'

describe('nextSortDir', () => {
  it('asc al cambiar de columna', () => {
    expect(nextSortDir('name', 'other', 'asc')).toBe('asc')
  })

  it('ciclo asc -> desc -> null en la misma columna', () => {
    expect(nextSortDir('name', 'name', 'asc')).toBe('desc')
    expect(nextSortDir('name', 'name', 'desc')).toBe(null)
  })
})

describe('naturalCompare', () => {
  it('compara números dentro del texto por su valor, no por caracter', () => {
    expect(naturalCompare('Prod 2', 'Prod 10')).toBeLessThan(0)
  })

  it('ignora mayúsculas/minúsculas', () => {
    expect(naturalCompare('abc', 'ABC')).toBe(0)
  })
})

describe('sortRows', () => {
  const rows = [{ v: 'b' }, { v: null }, { v: 'a' }]

  it('sin dirección devuelve las filas tal cual', () => {
    expect(sortRows(rows, r => r.v, null)).toBe(rows)
  })

  it('nulls siempre al final, en asc y en desc', () => {
    const asc = sortRows(rows, r => r.v, 'asc')
    expect(asc.map(r => r.v)).toEqual(['a', 'b', null])
    const desc = sortRows(rows, r => r.v, 'desc')
    expect(desc.map(r => r.v)).toEqual(['b', 'a', null])
  })
})

describe('naturalSortByName', () => {
  it('ordena por .name con criterio natural, sin mutar el array original', () => {
    const rows = [{ name: 'Item 10' }, { name: 'Item 2' }]
    const sorted = naturalSortByName(rows)
    expect(sorted.map(r => r.name)).toEqual(['Item 2', 'Item 10'])
    expect(rows.map(r => r.name)).toEqual(['Item 10', 'Item 2']) // original intacto
  })
})
