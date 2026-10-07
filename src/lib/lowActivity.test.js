import { describe, it, expect } from 'vitest'
import { lowActivityWindow, isLowActivityAlert } from './lowActivity'

describe('lowActivityWindow', () => {
  it('since queda alertDays atrás y until queda inactiveDays atrás', () => {
    const now = new Date('2026-06-01T00:00:00.000Z')
    const { since, until } = lowActivityWindow(now, 90, 120)
    expect(since).toBe(new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString())
    expect(until).toBe(new Date(now - 120 * 24 * 60 * 60 * 1000).toISOString())
  })

  it('since siempre es más reciente que until (alertDays < inactiveDays)', () => {
    const { since, until } = lowActivityWindow(new Date('2026-06-01T00:00:00.000Z'), 90, 120)
    expect(new Date(since).getTime()).toBeGreaterThan(new Date(until).getTime())
  })
})

describe('isLowActivityAlert', () => {
  const window = { since: '2026-06-01T00:00:00.000Z', until: '2026-05-01T00:00:00.000Z' }

  it('true cuando está activo, no terminal, y la última actividad cae dentro de la ventana', () => {
    const neg = { activity_status: 'active', status: 'Negociación', last_activity_at: '2026-05-15T00:00:00.000Z' }
    expect(isLowActivityAlert(neg, window, new Set())).toBe(true)
  })

  it('false si el proyecto no está activo', () => {
    const neg = { activity_status: 'paused', status: 'Negociación', last_activity_at: '2026-05-15T00:00:00.000Z' }
    expect(isLowActivityAlert(neg, window, new Set())).toBe(false)
  })

  it('false si el estado es terminal, sin importar el nombre', () => {
    const neg = { activity_status: 'active', status: 'Ganado', last_activity_at: '2026-05-15T00:00:00.000Z' }
    expect(isLowActivityAlert(neg, window, new Set(['Ganado']))).toBe(false)
  })

  it('false si la última actividad es más reciente que el umbral de alerta', () => {
    const neg = { activity_status: 'active', status: 'Negociación', last_activity_at: '2026-06-15T00:00:00.000Z' }
    expect(isLowActivityAlert(neg, window, new Set())).toBe(false)
  })

  it('false si ya cruzó el umbral de inactivo (demasiado viejo)', () => {
    const neg = { activity_status: 'active', status: 'Negociación', last_activity_at: '2026-04-01T00:00:00.000Z' }
    expect(isLowActivityAlert(neg, window, new Set())).toBe(false)
  })
})
