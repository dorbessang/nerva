import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Settings from './Settings'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import { createSupabaseMock } from '../test/supabaseMock'

// Caracterización del gating de navegación de Configuración por rol/tipo
// de workspace antes de partir Settings.jsx (2856 líneas, sin tocar
// todavía) — es la lógica de permisos más crítica de este archivo: qué
// pestañas ve cada rol, y que un workspace personal esconde Equipo/Módulos
// aunque el usuario sea owner.

vi.mock('../lib/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

function mockBasicQueries() {
  const mock = createSupabaseMock({
    notification_preferences: { data: [], error: null },
    access_grants: { data: null, error: null, count: 0 },
    staff_action_requests: { data: null, error: null, count: 0 },
  })
  supabase.from.mockImplementation(mock.from)
}

function renderSettings(tab = 'notificaciones') {
  render(
    <MemoryRouter initialEntries={[`/settings?tab=${tab}`]}>
      <Settings />
    </MemoryRouter>
  )
  return within(screen.getByRole('navigation'))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBasicQueries()
})

describe('Settings — navegación agrupada por rol', () => {
  it('owner en workspace de equipo ve los 4 grupos (Workspace/Equipo/Módulos/Tu cuenta)', async () => {
    useAuth.mockReturnValue({ workspaceId: 'ws-1', effectiveRole: 'owner', activeWorkspace: { type: 'team' }, user: { id: 'u-1' } })
    const nav = renderSettings()

    expect(await screen.findByText('Configuración')).toBeInTheDocument()
    expect(nav.getByText('General')).toBeInTheDocument()
    expect(nav.getByText('Automatizaciones')).toBeInTheDocument()
    expect(nav.getByText('Usuarios')).toBeInTheDocument()
    expect(nav.getByText('Soporte')).toBeInTheDocument()
    expect(nav.getByText('Proyectos')).toBeInTheDocument()
    expect(nav.getByText('Entidades')).toBeInTheDocument()
    expect(nav.getByText('Productos')).toBeInTheDocument()
    expect(nav.getByText('Notificaciones')).toBeInTheDocument()
  })

  it('rol sin privilegios (editor) en workspace de equipo solo ve Usuarios y Notificaciones', async () => {
    useAuth.mockReturnValue({ workspaceId: 'ws-1', effectiveRole: 'editor', activeWorkspace: { type: 'team' }, user: { id: 'u-1' } })
    const nav = renderSettings()

    expect(await screen.findByText('Configuración')).toBeInTheDocument()
    expect(nav.getByText('Usuarios')).toBeInTheDocument()
    expect(nav.getByText('Notificaciones')).toBeInTheDocument()
    expect(nav.queryByText('General')).not.toBeInTheDocument()
    expect(nav.queryByText('Automatizaciones')).not.toBeInTheDocument()
    expect(nav.queryByText('Soporte')).not.toBeInTheDocument()
    expect(nav.queryByText('Proyectos')).not.toBeInTheDocument()
    expect(nav.queryByText('Entidades')).not.toBeInTheDocument()
    expect(nav.queryByText('Productos')).not.toBeInTheDocument()
  })

  it('owner en workspace personal no ve Equipo ni Módulos (sin sentido invitar gente ahí)', async () => {
    useAuth.mockReturnValue({ workspaceId: 'ws-1', effectiveRole: 'owner', activeWorkspace: { type: 'personal' }, user: { id: 'u-1' } })
    const nav = renderSettings()

    expect(await screen.findByText('Configuración')).toBeInTheDocument()
    // Workspace (General/Automatizaciones) y "Soporte" dentro de Equipo no
    // dependen de isPersonal, solo de ser admin/owner — únicamente "Usuarios"
    // (dentro de Equipo) y todo "Módulos" sí dependen de !isPersonal.
    expect(nav.getByText('General')).toBeInTheDocument()
    expect(nav.getByText('Automatizaciones')).toBeInTheDocument()
    expect(nav.getByText('Soporte')).toBeInTheDocument()
    expect(nav.getByText('Notificaciones')).toBeInTheDocument()
    expect(nav.queryByText('Usuarios')).not.toBeInTheDocument()
    expect(nav.queryByText('Proyectos')).not.toBeInTheDocument()
    expect(nav.queryByText('Entidades')).not.toBeInTheDocument()
    expect(nav.queryByText('Productos')).not.toBeInTheDocument()
  })
})
