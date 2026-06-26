import { useState, useEffect, useRef } from 'react'
import './CountrySelector.css'

const COUNTRIES = [
  {code:"AF",name:"Afganistán"},{code:"AL",name:"Albania"},{code:"DE",name:"Alemania"},
  {code:"DZ",name:"Argelia"},{code:"AR",name:"Argentina"},{code:"AM",name:"Armenia"},
  {code:"AU",name:"Australia"},{code:"AT",name:"Austria"},{code:"AZ",name:"Azerbaiyán"},
  {code:"BE",name:"Bélgica"},{code:"BO",name:"Bolivia"},{code:"BR",name:"Brasil"},
  {code:"BG",name:"Bulgaria"},{code:"CA",name:"Canadá"},{code:"CL",name:"Chile"},
  {code:"CN",name:"China"},{code:"CO",name:"Colombia"},{code:"KR",name:"Corea del Sur"},
  {code:"CR",name:"Costa Rica"},{code:"HR",name:"Croacia"},{code:"CU",name:"Cuba"},
  {code:"DK",name:"Dinamarca"},{code:"EC",name:"Ecuador"},{code:"EG",name:"Egipto"},
  {code:"SV",name:"El Salvador"},{code:"AE",name:"Emiratos Árabes"},{code:"ES",name:"España"},
  {code:"US",name:"Estados Unidos"},{code:"EE",name:"Estonia"},{code:"ET",name:"Etiopía"},
  {code:"PH",name:"Filipinas"},{code:"FI",name:"Finlandia"},{code:"FR",name:"Francia"},
  {code:"GE",name:"Georgia"},{code:"GH",name:"Ghana"},{code:"GR",name:"Grecia"},
  {code:"GT",name:"Guatemala"},{code:"HN",name:"Honduras"},{code:"HU",name:"Hungría"},
  {code:"IN",name:"India"},{code:"ID",name:"Indonesia"},{code:"IE",name:"Irlanda"},
  {code:"IS",name:"Islandia"},{code:"IL",name:"Israel"},{code:"IT",name:"Italia"},
  {code:"JP",name:"Japón"},{code:"JO",name:"Jordania"},{code:"KZ",name:"Kazajistán"},
  {code:"KE",name:"Kenia"},{code:"LV",name:"Letonia"},{code:"LB",name:"Líbano"},
  {code:"LT",name:"Lituania"},{code:"LU",name:"Luxemburgo"},{code:"MY",name:"Malasia"},
  {code:"MA",name:"Marruecos"},{code:"MX",name:"México"},{code:"NI",name:"Nicaragua"},
  {code:"NG",name:"Nigeria"},{code:"NO",name:"Noruega"},{code:"NZ",name:"Nueva Zelanda"},
  {code:"NL",name:"Países Bajos"},{code:"PK",name:"Pakistán"},{code:"PA",name:"Panamá"},
  {code:"PY",name:"Paraguay"},{code:"PE",name:"Perú"},{code:"PL",name:"Polonia"},
  {code:"PT",name:"Portugal"},{code:"GB",name:"Reino Unido"},{code:"CZ",name:"República Checa"},
  {code:"DO",name:"República Dominicana"},{code:"RO",name:"Rumania"},{code:"RU",name:"Rusia"},
  {code:"SA",name:"Arabia Saudita"},{code:"SN",name:"Senegal"},{code:"RS",name:"Serbia"},
  {code:"SG",name:"Singapur"},{code:"ZA",name:"Sudáfrica"},{code:"SE",name:"Suecia"},
  {code:"CH",name:"Suiza"},{code:"TW",name:"Taiwán"},{code:"TH",name:"Tailandia"},
  {code:"TN",name:"Túnez"},{code:"TR",name:"Turquía"},{code:"UA",name:"Ucrania"},
  {code:"UY",name:"Uruguay"},{code:"VE",name:"Venezuela"},{code:"VN",name:"Vietnam"},
].sort((a,b) => a.name.localeCompare(b.name, 'es'))

export function getFlagUrl(code) {
  if (!code || code.length !== 2) return null
  return `https://flagcdn.com/w20/${code.toLowerCase()}.png`
}

export function getCountryName(code) {
  return COUNTRIES.find(c => c.code === code)?.name || ''
}

export default function CountrySelector({ value, onChange }) {
  const selected = COUNTRIES.find(c => c.code === value)

  // inputValue muestra el nombre del país seleccionado o lo que el usuario está escribiendo
  const [inputValue, setInputValue] = useState(selected?.name || '')
  const [mode, setMode] = useState('idle') // 'idle' | 'typing' | 'open'
  const [highlighted, setHighlighted] = useState(0)
  const ref = useRef(null)
  const inputRef = useRef(null)

  // Sincroniza el input cuando el valor externo cambia
  useEffect(() => {
    if (mode === 'idle') {
      setInputValue(selected?.name || '')
    }
  }, [value, mode])

  // Opciones según el modo
  const filtered = COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(inputValue.toLowerCase()) ||
    c.code.toLowerCase().includes(inputValue.toLowerCase())
  )
  const suggestions = mode === 'typing' ? filtered.slice(0, 5) : filtered
  const showDropdown = mode === 'typing' || mode === 'open'

  // Cierra al hacer click afuera
  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) close()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  function close() {
    // Al cerrar, restaura el nombre del país seleccionado
    setInputValue(selected?.name || '')
    setMode('idle')
    setHighlighted(0)
  }

  function select(code) {
    onChange(code)
    setInputValue(COUNTRIES.find(c => c.code === code)?.name || '')
    setMode('idle')
    setHighlighted(0)
    inputRef.current?.blur()
  }

  function handleInputChange(e) {
    setInputValue(e.target.value)
    setHighlighted(0)
    setMode(e.target.value ? 'typing' : 'open')
  }

  function handleKeyDown(e) {
    if (!showDropdown) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions[highlighted]) select(suggestions[highlighted].code)
    } else if (e.key === 'Escape') {
      close()
    } else if (e.key === 'Tab') {
      // Al tabear, selecciona el primero si hay coincidencia única
      if (suggestions.length === 1) select(suggestions[0].code)
      else close()
    }
  }

  return (
    <div ref={ref} className="country-selector">
      <div className="country-combobox">
        {/* Muestra la bandera del país seleccionado si no está editando */}
        {selected && mode === 'idle' && (
          <img src={getFlagUrl(selected.code)} alt={selected.code} className="country-flag country-flag--input" />
        )}
        <input
          ref={inputRef}
          className="country-input"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => { if (mode === 'idle') setInputValue('') }}
          onBlur={() => { setTimeout(close, 150) }}
          onKeyDown={handleKeyDown}
          autoComplete="new-password"
          placeholder="— Seleccioná un país —"
          style={{ paddingLeft: selected && mode === 'idle' ? 28 : 12 }}
        />
        {/* Flecha para abrir el dropdown completo */}
        <button
          type="button"
          className="country-arrow-btn"
          tabIndex={-1}
          onMouseDown={e => {
            e.preventDefault()
            if (mode === 'open') close()
            else { setInputValue(''); setMode('open'); inputRef.current?.focus() }
          }}
        >
          {mode === 'open' ? '▲' : '▼'}
        </button>
      </div>

      {showDropdown && suggestions.length > 0 && (
        <div className="country-dropdown">
          <div className="country-list">
            {suggestions.map((c, i) => (
              <div
                key={c.code}
                className={`country-option ${value === c.code ? 'selected' : ''} ${i === highlighted ? 'highlighted' : ''}`}
                onMouseDown={e => { e.preventDefault(); select(c.code) }}
                onMouseEnter={() => setHighlighted(i)}
              >
                <img src={getFlagUrl(c.code)} alt={c.code} className="country-flag" />
                <span>{c.name}</span>
                {value === c.code && <span className="country-check">✓</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
