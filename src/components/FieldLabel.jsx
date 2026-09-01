// Envoltorio chico para ponerle un título arriba de un campo dentro de una
// fila de inputs sueltos (alta rápida de hitos, cotizaciones, tareas...) —
// mismo estilo ya usado en la barra de filtros de Proyectos (.filter-field/
// .filter-field-label), reusado acá para no inventar una clase nueva.
// `style` es para preservar el ancho/flex que tenía el input suelto antes
// de envolverlo (el ancho tiene que vivir en el wrapper, no en el input,
// para que el flex de la fila padre lo siga respetando).
export default function Field({ label, style, children }) {
  return (
    <div className="filter-field" style={style}>
      <label className="filter-field-label">{label}</label>
      {children}
    </div>
  )
}
