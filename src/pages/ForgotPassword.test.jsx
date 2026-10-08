import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ForgotPassword from './ForgotPassword'
import { requestPasswordReset } from '../lib/auth'

vi.mock('../lib/auth', () => ({
  requestPasswordReset: vi.fn(),
}))

function renderForgotPassword() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <ForgotPassword />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ForgotPassword', () => {
  it('pide el link y muestra un mensaje genérico (sin confirmar si el email existe)', async () => {
    requestPasswordReset.mockResolvedValue()
    renderForgotPassword()

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'user@nerva.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }))

    await waitFor(() => expect(requestPasswordReset).toHaveBeenCalledWith('user@nerva.test'))
    expect(await screen.findByText(/te enviamos un link/)).toBeInTheDocument()
  })

  it('muestra un error real si la llamada falla (ej. rate limit)', async () => {
    requestPasswordReset.mockRejectedValue(new Error('For security purposes, you can only request this once every 60 seconds'))
    renderForgotPassword()

    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'user@nerva.test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar link' }))

    expect(await screen.findByText('For security purposes, you can only request this once every 60 seconds')).toBeInTheDocument()
    expect(screen.queryByText(/te enviamos un link/)).not.toBeInTheDocument()
  })
})
