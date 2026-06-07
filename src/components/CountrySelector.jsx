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
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const selected = COUNTRIES.find(c => c.code === value)
  const filtered = COUNTRIES.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.code.toLowerCase().includes(search.toLowerCase())
  )

  useEffect(() => {
    const handle = e => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  return (
    <div ref={ref} className="country-selector">
      <div className="country-trigger" onClick={() => setOpen(o => !o)}>
        <span className="country-trigger-value">
          {selected ? (
            <>
              <img src={getFlagUrl(selected.code)} alt={selected.code} className="country-flag" />
              {selected.name}
            </>
          ) : (
            <span className="country-placeholder">— Seleccioná un país —</span>
          )}
        </span>
        <span className="country-arrow">{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div className="country-dropdown">
          <div className="country-search-wrapper">
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="🔍 Buscar país..."
              className="country-search"
            />
          </div>
          <div className="country-list">
            <div
              className="country-option"
              onClick={() => { onChange(''); setSearch(''); setOpen(false) }}
            >
              — Sin país —
            </div>
            {filtered.length === 0 && (
              <div className="country-empty">Sin resultados</div>
            )}
            {filtered.map(c => (
              <div
                key={c.code}
                className={`country-option ${value === c.code ? 'selected' : ''}`}
                onClick={() => { onChange(c.code); setSearch(''); setOpen(false) }}
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