import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { ProtectedRoute, LandingRoute, SetPasswordRoute, ResetPasswordRoute } from './App'
import { useAuth } from './lib/AuthContext'

vi.mock('./lib/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('./components/Layout', () => ({
  default: ({ children }) => <div data-testid="layout">{children}</div>,
}))

vi.mock('./pages/Landing', () => ({
  default: () => <div data-testid="landing-page" />,
}))

vi.mock('./pages/SetPassword', () => ({
  default: () => <div data-testid="set-password-page" />,
}))

vi.mock('./pages/ResetPassword', () => ({
  default: () => <div data-testid="reset-password-page" />,
}))

// Monta el guard en "/" con rutas hermanas para /dashboard, /login,
// /set-password y /reset-password, así un <Navigate> real termina en una
// pantalla detectable.
function renderGuard(element) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={element} />
        <Route path="/dashboard" element={<div data-testid="dashboard-page" />} />
        <Route path="/login" element={<div data-testid="login-page" />} />
        <Route path="/set-password" element={<div data-testid="set-password-page" />} />
        <Route path="/reset-password" element={<div data-testid="reset-password-page" />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ProtectedRoute', () => {
  it('muestra "Cargando..." mientras loading es true', () => {
    useAuth.mockReturnValue({ loading: true, user: null, needsOnboarding: false })
    renderGuard(<ProtectedRoute><div>contenido</div></ProtectedRoute>)
    expect(screen.getByText('Cargando...')).toBeInTheDocument()
  })

  it('redirige a /login si no hay usuario', () => {
    useAuth.mockReturnValue({ loading: false, user: null, needsOnboarding: false })
    renderGuard(<ProtectedRoute><div>contenido</div></ProtectedRoute>)
    expect(screen.getByTestId('login-page')).toBeInTheDocument()
  })

  it('redirige a /set-password si falta completar el alta', () => {
    useAuth.mockReturnValue({ loading: false, user: { id: '1' }, needsOnboarding: true })
    renderGuard(<ProtectedRoute><div>contenido</div></ProtectedRoute>)
    expect(screen.getByTestId('set-password-page')).toBeInTheDocument()
  })

  it('renderiza Layout + children si hay sesión y el alta está completa', () => {
    useAuth.mockReturnValue({ loading: false, user: { id: '1' }, needsOnboarding: false })
    renderGuard(<ProtectedRoute><div data-testid="child">contenido</div></ProtectedRoute>)
    expect(screen.getByTestId('layout')).toBeInTheDocument()
    expect(screen.getByTestId('child')).toBeInTheDocument()
  })
})

describe('LandingRoute', () => {
  it('muestra "Cargando..." mientras loading es true', () => {
    useAuth.mockReturnValue({ loading: true, user: null, needsOnboarding: false })
    renderGuard(<LandingRoute />)
    expect(screen.getByText('Cargando...')).toBeInTheDocument()
  })

  it('muestra la landing si no hay sesión', () => {
    useAuth.mockReturnValue({ loading: false, user: null, needsOnboarding: false })
    renderGuard(<LandingRoute />)
    expect(screen.getByTestId('landing-page')).toBeInTheDocument()
  })

  it('redirige a /dashboard si ya hay sesión y el alta está completa', () => {
    useAuth.mockReturnValue({ loading: false, user: { id: '1' }, needsOnboarding: false })
    renderGuard(<LandingRoute />)
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
  })

  it('redirige a /set-password si hay sesión pero falta completar el alta', () => {
    useAuth.mockReturnValue({ loading: false, user: { id: '1' }, needsOnboarding: true })
    renderGuard(<LandingRoute />)
    expect(screen.getByTestId('set-password-page')).toBeInTheDocument()
  })
})

describe('SetPasswordRoute', () => {
  it('muestra "Cargando..." mientras loading es true', () => {
    useAuth.mockReturnValue({ loading: true, user: null, needsOnboarding: false })
    renderGuard(<SetPasswordRoute />)
    expect(screen.getByText('Cargando...')).toBeInTheDocument()
  })

  it('redirige a /dashboard si ya hay sesión y el alta está completa (evita el formulario de nuevo)', () => {
    useAuth.mockReturnValue({ loading: false, user: { id: '1' }, needsOnboarding: false })
    renderGuard(<SetPasswordRoute />)
    expect(screen.getByTestId('dashboard-page')).toBeInTheDocument()
  })

  it('muestra el formulario de set-password si falta completar el alta', () => {
    useAuth.mockReturnValue({ loading: false, user: { id: '1' }, needsOnboarding: true })
    renderGuard(<SetPasswordRoute />)
    expect(screen.getByTestId('set-password-page')).toBeInTheDocument()
  })
})

describe('ResetPasswordRoute', () => {
  it('muestra "Cargando..." mientras loading es true', () => {
    useAuth.mockReturnValue({ loading: true, user: null, needsOnboarding: false })
    renderGuard(<ResetPasswordRoute />)
    expect(screen.getByText('Cargando...')).toBeInTheDocument()
  })

  it('redirige a /login si no hay sesión (link vencido o acceso directo)', () => {
    useAuth.mockReturnValue({ loading: false, user: null, needsOnboarding: false })
    renderGuard(<ResetPasswordRoute />)
    expect(screen.getByTestId('login-page')).toBeInTheDocument()
  })

  it('muestra el formulario de reset con sesión de recuperación, sin importar needsOnboarding (a diferencia de SetPasswordRoute)', () => {
    useAuth.mockReturnValue({ loading: false, user: { id: '1' }, needsOnboarding: false })
    renderGuard(<ResetPasswordRoute />)
    expect(screen.getByTestId('reset-password-page')).toBeInTheDocument()
  })
})
