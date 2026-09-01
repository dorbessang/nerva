// Envoltorio chico para ponerle un título arriba de un campo dentro de una
// fila de inputs sueltos (alta rápida de hitos, cotizaciones, tareas...) —
// mismo estilo que .filter-field/.filter-field-label (barra de filtros de
// Proyectos), pero con estilos inline en vez de esas clases: se usa desde
// páginas que no importan Negotiations.css/Tasks.css (donde viven esas
// clases), así que depender de ellas lo dejaba sin estilo ahí.
// `style` es para preservar el ancho/flex que tenía el input suelto antes
// de envolverlo (el ancho tiene que vivir en el wrapper, no en el input,
// para que el flex de la fila padre lo siga respetando).
export default function Field({ label, style, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <label style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.6px' }}>{label}</label>
      {children}
    </div>
  )
}
