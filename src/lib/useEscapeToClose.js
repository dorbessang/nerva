import { useEffect } from 'react'

// Esc cierra la ventana/modal completo — para inputs sueltos adentro (notas,
// hitos, historial de precio...) que manejan su propio Escape (cancelar sin
// guardar), esos handlers deben llamar e.stopPropagation() para que el Esc
// no se propague hasta acá y cierre todo de una.
export function useEscapeToClose(onClose, active = true) {
  useEffect(() => {
    if (!active) return
    function handleKeyDown(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [active, onClose])
}
