import { describe, it, expect } from 'vitest'
import { resolveStateConfig, terminalStatusNames } from './customStates'

describe('resolveStateConfig', () => {
  const states = [{ name: 'Ganado', color: '#111', bg_color: '#eee' }]

  it('devuelve la config del estado si lo encuentra', () => {
    expect(resolveStateConfig(states, 'Ganado')).toEqual({ name: 'Ganado', color: '#111', bg_color: '#eee' })
  })

  it('cae a gris neutro si el estado no existe', () => {
    expect(resolveStateConfig(states, 'Borrado')).toEqual({ color: '#64748B', bg_color: '#F1F5F9' })
  })

  it('cae a gris neutro si states es null/vacío', () => {
    expect(resolveStateConfig(null, 'Ganado')).toEqual({ color: '#64748B', bg_color: '#F1F5F9' })
    expect(resolveStateConfig([], 'Ganado')).toEqual({ color: '#64748B', bg_color: '#F1F5F9' })
  })
})

describe('terminalStatusNames', () => {
  it('devuelve solo los nombres marcados is_terminal', () => {
    const states = [
      { name: 'Contacto inicial', is_terminal: false },
      { name: 'Ganado', is_terminal: true },
      { name: 'Perdido', is_terminal: true },
    ]
    expect(terminalStatusNames(states)).toEqual(new Set(['Ganado', 'Perdido']))
  })

  it('devuelve un Set vacío si states es null', () => {
    expect(terminalStatusNames(null)).toEqual(new Set())
  })
})
