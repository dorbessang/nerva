import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import ResetPassword from './ResetPassword'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'

vi.mock('../lib/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { updateUser: vi.fn() } },
}))

function renderResetPassword() {
  return render(
    <MemoryRouter initialEntries={['/reset-password']}>
      <Routes>
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/dashboard" element={<div data-testid="dashboard-page" />} />
      </Routes>
    </MemoryRouter>
  )
}

const clearPasswordRecovery = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  useAuth.mockReturnValue({ clearPasswordRecovery })
})

describe('ResetPassword', () => {
  it('guarda la contraseña nueva, limpia la marca de recuperación y navega al dashboard', async () => {
    supabase.auth.updateUser.mockResolvedValue({ error: null })
    renderResetPassword()

    fireEvent.change(screen.getByPlaceholderText('Nueva contraseña'), { target: { value: 'nuevaClave123' } })
    fireEvent.change(screen.getByPlaceholderText('Confirmar contraseña'), { target: { value: 'nuevaClave123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))

    await waitFor(() => expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'nuevaClave123' }))
    expect(clearPasswordRecovery).toHaveBeenCalled()
    expect(await screen.findByTestId('dashboard-page')).toBeInTheDocument()
  })

  it('no manda el formulario si las contraseñas no coinciden', () => {
    renderResetPassword()

    fireEvent.change(screen.getByPlaceholderText('Nueva contraseña'), { target: { value: 'nuevaClave123' } })
    fireEvent.change(screen.getByPlaceholderText('Confirmar contraseña'), { target: { value: 'otraDistinta' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }))

    expect(screen.getByText('Las contraseñas no coinciden')).toBeInTheDocument()
    expect(supabase.auth.updateUser).not.toHaveBeenCalled()
    expect(clearPasswordRecovery).not.toHaveBeenCalled()
  })
})
