// Widget de edición para un campo custom — el tipo (o `underlying_type` si
// es un campo "con seguimiento") define qué se renderiza, el label es
// puramente decorativo y lo define el workspace.

export function CustomFieldInput({ def, value, onChange }) {
  const type = def.field_type === 'tracked' ? def.options?.underlying_type : def.field_type
  const choices = def.options?.choices || []

  if (type === 'textarea') {
    return <textarea rows={3} value={value || ''} onChange={e => onChange(e.target.value)} />
  }
  if (type === 'number') {
    return <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  }
  if (type === 'date') {
    return <input type="date" value={value || ''} onChange={e => onChange(e.target.value || null)} />
  }
  if (type === 'boolean') {
    return <input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />
  }
  if (type === 'select') {
    return (
      <select className="neg-select" value={value || ''} onChange={e => onChange(e.target.value || null)}>
        <option value="">—</option>
        {choices.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    )
  }
  if (type === 'multiselect') {
    const selected = Array.isArray(value) ? value : []
    function toggle(id) {
      onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
    }
    return (
      <div className="cf-multiselect">
        {choices.map(c => (
          <label key={c.id} className="cf-multiselect-option">
            <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.label}
          </label>
        ))}
      </div>
    )
  }
  return <input type="text" value={value || ''} onChange={e => onChange(e.target.value)} />
}

// Sección completa "Campos personalizados" para un formulario — un
// CustomFieldInput por definición fetcheada, reusado por NegotiationModal
// y EntityModal.
export function CustomFieldsFormSection({ defs, values, onChange }) {
  if (!defs || defs.length === 0) return null
  return (
    <div className="form-group">
      <label>CAMPOS PERSONALIZADOS</label>
      <div className="cf-form-fields">
        {defs.map(def => (
          <div key={def.key} className="cf-form-field">
            <label className="cf-form-field-label">{def.label}</label>
            <CustomFieldInput def={def} value={values?.[def.key]} onChange={v => onChange(def.key, v)} />
          </div>
        ))}
      </div>
    </div>
  )
}
