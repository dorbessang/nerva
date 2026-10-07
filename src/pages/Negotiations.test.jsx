import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Negotiations from './Negotiations'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { createSupabaseMock } from '../test/supabaseMock'

// Caracterización del comportamiento actual de la página de Proyectos antes
// de seguir partiendo Negotiations.jsx (NegotiationModal/NegotiationDetail
// todavía no se extrajeron) — cubre lo más riesgoso de tocar sin red de
// contención: qué filas se ven según el filtro de actividad por defecto,
// que buscar por texto filtra la lista, y que el toggle de vista cambia
// de Tabla a Mosaico.

vi.mock('../lib/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

const activeNeg = {
  id: 'neg-1',
  workspace_id: 'ws-1',
  title: 'Proyecto Activo',
  product: 'Proyecto Activo',
  status: 'En curso',
  activity_status: 'active',
  display_number: 1,
  created_at: '2026-01-01',
  target_date: null,
  primary_entity: null,
  primary_product: null,
}

const pausedNeg = {
  id: 'neg-2',
  workspace_id: 'ws-1',
  title: 'Proyecto Pausado',
  product: 'Proyecto Pausado',
  status: 'En curso',
  activity_status: 'paused',
  display_number: 2,
  created_at: '2026-01-02',
  target_date: null,
  primary_entity: null,
  primary_product: null,
}

function mockFetchAll({ negotiations = [activeNeg, pausedNeg] } = {}) {
  const resultsByTable = {
    negotiations: { data: negotiations, error: null },
    entities: { data: [], error: null },
    entity_types: { data: [], error: null },
    products: { data: [], error: null },
    workspace_members: { data: [], error: null },
    workspace_named_participants: { data: [], error: null },
    custom_states: { data: [{ id: 'st-1', name: 'En curso', is_terminal: false, sort_order: 1 }], error: null },
    deal_milestones: { data: [], error: null },
    custom_field_definitions: {
      data: [
        { id: 'cf-product', key: 'product', label: 'Producto', field_type: 'text', enabled: true, sort_order: 1 },
        { id: 'cf-status', key: 'status', label: 'Estado', field_type: 'status', enabled: true, sort_order: 2 },
      ],
      error: null,
    },
    negotiation_entities: { data: [], error: null },
    negotiation_products: { data: [], error: null },
    negotiation_notes: { data: [], error: null },
    tasks: { data: [], error: null },
    activity_log: { data: [], error: null },
    workspaces: { data: { field_order: {} }, error: null },
  }
  const mock = createSupabaseMock(resultsByTable)
  supabase.from.mockImplementation(mock.from)
}

function renderNegotiations() {
  return render(
    <MemoryRouter initialEntries={['/negotiations']}>
      <Negotiations />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAuth.mockReturnValue({
    user: { id: 'u-1' },
    workspaceId: 'ws-1',
    effectiveRole: 'owner',
    role: 'owner',
    isStaff: false,
    activeWorkspace: { id: 'ws-1', low_activity_alert_days: 14, low_activity_inactive_days: 30 },
  })
})

describe('Negotiations', () => {
  it('con el filtro de actividad por defecto ("En curso") solo muestra proyectos activos', async () => {
    mockFetchAll()
    renderNegotiations()

    expect(await screen.findByText('Proyecto Activo')).toBeInTheDocument()
    expect(screen.queryByText('Proyecto Pausado')).not.toBeInTheDocument()
  })

  it('el buscador filtra por nombre de producto/proyecto', async () => {
    mockFetchAll({ negotiations: [activeNeg, { ...pausedNeg, activity_status: 'active', id: 'neg-3', title: 'Otro', product: 'Otro' }] })
    renderNegotiations()

    await screen.findByText('Proyecto Activo')
    const search = screen.getByPlaceholderText('🔍 Proyecto o producto...')
    fireEvent.change(search, { target: { value: 'Otro' } })

    expect(screen.queryByText('Proyecto Activo')).not.toBeInTheDocument()
    expect(screen.getByText('Otro')).toBeInTheDocument()
  })

  it('el toggle de vista cambia de Tabla a Mosaico y vuelve a mostrar las mismas filas', async () => {
    mockFetchAll()
    renderNegotiations()

    await screen.findByText('Proyecto Activo')
    expect(document.querySelector('.neg-table-wrapper')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Vista cards'))

    expect(document.querySelector('.card-grid')).toBeInTheDocument()
    expect(screen.getByText('Proyecto Activo')).toBeInTheDocument()
  })

  it('el filtro de Actividad "Todos" vuelve a mostrar los proyectos pausados ocultos por el filtro por defecto', async () => {
    mockFetchAll()
    renderNegotiations()

    await screen.findByText('Proyecto Activo')
    expect(screen.queryByText('Proyecto Pausado')).not.toBeInTheDocument()

    fireEvent.change(document.querySelector('select.neg-select'), { target: { value: '' } })

    expect(await screen.findByText('Proyecto Pausado')).toBeInTheDocument()
    expect(screen.getByText('✕ Limpiar filtros')).toBeInTheDocument()
  })
})
