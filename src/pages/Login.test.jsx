import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Login from './Login'
import { signIn } from '../lib/auth'

vi.mock('../lib/auth', () => ({
  signIn: vi.fn(),
}))

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<div data-testid="dashboard-page" />} />
      </Routes>
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('Login', () => {
  it('navega a /dashboard cuando signIn resuelve bien', async () => {
    signIn.mockResolvedValue({})
    renderLogin()

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'user@nerva.test' } })
    fireEvent.change(screen.getByPlaceholderText('Contraseña'), { target: { value: 'secreta123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))

    await waitFor(() => expect(screen.getByTestId('dashboard-page')).toBeInTheDocument())
    expect(signIn).toHaveBeenCalledWith('user@nerva.test', 'secreta123')
  })

  it('muestra un error y no navega cuando signIn falla', async () => {
    signIn.mockRejectedValue(new Error('invalid credentials'))
    renderLogin()

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'user@nerva.test' } })
    fireEvent.change(screen.getByPlaceholderText('Contraseña'), { target: { value: 'mala' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }))

    expect(await screen.findByText('Email o contraseña incorrectos')).toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-page')).not.toBeInTheDocument()
  })
})
