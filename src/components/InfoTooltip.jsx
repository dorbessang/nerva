import { useState, useRef, useEffect } from 'react'
import './InfoTooltip.css'

// Ícono "i" chico al lado de un título — al clickear muestra la
// explicación en un popover, en vez de un cartel siempre visible.
// Reemplaza el patrón <p className="settings-hint"> para textos largos
// de "cómo funciona esta sección" (no para empty states ni instrucciones
// cortas atadas a una acción puntual, esos se quedan como estaban).
export default function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <span className="info-tooltip-wrap" ref={ref}>
      <button
        type="button"
        className="info-tooltip-btn"
        onClick={() => setOpen(v => !v)}
        aria-label="Más información"
      >
        i
      </button>
      {open && <div className="info-tooltip-popover">{text}</div>}
    </span>
  )
}
