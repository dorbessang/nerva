import { describe, it, expect } from 'vitest'
import { isTaskBlocked, wouldCreateCycle, matchesEntityFilter } from './tasks'

describe('isTaskBlocked', () => {
  it('bloqueada si tiene aprobación pendiente', () => {
    expect(isTaskBlocked({ approval_status: 'pending' })).toBe(true)
  })

  it('bloqueada si su predecesora no está hecha', () => {
    expect(isTaskBlocked({ predecessor: { status: 'pending' } })).toBe(true)
    expect(isTaskBlocked({ predecessor: { status: 'in_progress' } })).toBe(true)
  })

  it('no bloqueada si no tiene predecesora ni aprobación pendiente', () => {
    expect(isTaskBlocked({})).toBe(false)
  })

  it('no bloqueada si la predecesora ya está hecha', () => {
    expect(isTaskBlocked({ predecessor: { status: 'done' } })).toBe(false)
  })
})

describe('wouldCreateCycle', () => {
  it('false si no hay candidata', () => {
    expect(wouldCreateCycle([], 'a', null)).toBe(false)
  })

  it('true si la candidata es la propia tarea', () => {
    expect(wouldCreateCycle([], 'a', 'a')).toBe(true)
  })

  it('true si la cadena de predecesoras vuelve a la tarea original', () => {
    const allTasks = [
      { id: 'a', predecessor_task_id: null },
      { id: 'b', predecessor_task_id: 'c' },
      { id: 'c', predecessor_task_id: 'a' }, // c depende de a
    ]
    // Si 'a' pasa a depender de 'b', se cierra el ciclo a -> b -> c -> a
    expect(wouldCreateCycle(allTasks, 'a', 'b')).toBe(true)
  })

  it('false si la cadena de predecesoras no vuelve a la tarea original', () => {
    const allTasks = [
      { id: 'a', predecessor_task_id: null },
      { id: 'b', predecessor_task_id: null },
      { id: 'c', predecessor_task_id: 'b' },
    ]
    expect(wouldCreateCycle(allTasks, 'a', 'c')).toBe(false)
  })
})

describe('matchesEntityFilter', () => {
  it('sin filtro ("Todos"), no filtra nada', () => {
    expect(matchesEntityFilter({ entity_id: null, negotiation_id: null }, '', new Set())).toBe(true)
  })

  it('matchea si la tarea está vinculada directo a esa entidad', () => {
    const task = { entity_id: 'prov-1', negotiation_id: null }
    expect(matchesEntityFilter(task, 'prov-1', new Set())).toBe(true)
  })

  it('matchea si el proyecto de la tarea está vinculado a esa entidad', () => {
    const task = { entity_id: null, negotiation_id: 'neg-1' }
    expect(matchesEntityFilter(task, 'prov-1', new Set(['neg-1']))).toBe(true)
  })

  it('no matchea si ni la tarea ni su proyecto están vinculados a esa entidad', () => {
    const task = { entity_id: 'prov-2', negotiation_id: 'neg-9' }
    expect(matchesEntityFilter(task, 'prov-1', new Set(['neg-1']))).toBe(false)
  })
})
