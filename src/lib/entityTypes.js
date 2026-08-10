// Una entidad puede tener un tipo primario y, opcionalmente, uno secundario
// (ver "Tipo secundario" en EntityModal.jsx) — para saber si una entidad es
// de un tipo dado (para mostrarla en una solapa, o como opción elegible en
// un rol de proyecto) hay que chequear los dos, no solo entity_type_id.
export function entityHasType(entity, typeId) {
  return entity?.entity_type_id === typeId || entity?.secondary_entity_type_id === typeId
}
