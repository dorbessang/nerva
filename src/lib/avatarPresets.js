// Galería fija de avatares por ícono — alternativa a subir una foto.
// Sin constraint en la base a propósito (ver migración): sumar/sacar
// opciones acá no requiere tocar SQL.
export const AVATAR_PRESETS = [
  { key: 'fox', emoji: '🦊', bg: '#FDE7D9' },
  { key: 'koala', emoji: '🐨', bg: '#E2E8F0' },
  { key: 'owl', emoji: '🦉', bg: '#FEF3C7' },
  { key: 'turtle', emoji: '🐢', bg: '#DCFCE7' },
  { key: 'dolphin', emoji: '🐬', bg: '#DBEAFE' },
  { key: 'panda', emoji: '🐼', bg: '#F3F4F6' },
  { key: 'penguin', emoji: '🐧', bg: '#E0F2FE' },
  { key: 'hedgehog', emoji: '🦔', bg: '#FCE7F3' },
  { key: 'octopus', emoji: '🐙', bg: '#EDE9FE' },
  { key: 'butterfly', emoji: '🦋', bg: '#FAE8FF' },
  { key: 'bee', emoji: '🐝', bg: '#FEF9C3' },
  { key: 'cat', emoji: '🐱', bg: '#FFE4E6' },
  { key: 'wolf', emoji: '🐺', bg: '#E5E7EB' },
  { key: 'tiger', emoji: '🐯', bg: '#FFEDD5' },
  { key: 'frog', emoji: '🐸', bg: '#D1FAE5' },
  { key: 'unicorn', emoji: '🦄', bg: '#FCE7F3' },
  { key: 'rocket', emoji: '🚀', bg: '#E0E7FF' },
  { key: 'star', emoji: '⭐', bg: '#FEF9C3' },
  { key: 'planet', emoji: '🪐', bg: '#EDE9FE' },
  { key: 'cactus', emoji: '🌵', bg: '#DCFCE7' },
  { key: 'sun', emoji: '☀️', bg: '#FEF3C7' },
  { key: 'wave', emoji: '🌊', bg: '#DBEAFE' },
  { key: 'mountain', emoji: '🏔️', bg: '#F1F5F9' },
  { key: 'compass', emoji: '🧭', bg: '#FFE4E6' },
]

export const AVATAR_PRESET_MAP = Object.fromEntries(AVATAR_PRESETS.map(p => [p.key, p]))
