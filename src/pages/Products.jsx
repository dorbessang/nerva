import { useState, useEffect } from 'react'
import { LayoutGrid, Table2 } from 'lucide-react'
import { useAuth } from '../lib/AuthContext'
import { supabase } from '../lib/supabase'
import ProductModal from '../components/ProductModal'
import ImportProductsModal from '../components/ImportProductsModal'
import { NegotiationDetail, NegotiationModal } from './Negotiations'
import DeleteConfirmModal from '../components/DeleteConfirmModal'
import { CustomFieldReadOnly } from '../components/CustomFieldInput'
import { computeFieldOrder, getCustomFieldValue, renderCustomFieldDisplay, isFieldFilterable, matchesAllFieldFilters, filterChoicesFor, describeFieldFilters } from '../lib/customFields'
import { useColumnPrefs, ColumnEditor } from '../components/ColumnEditor'
import FiltersPanelButton from '../components/FiltersPanelButton'
import TableGrid from '../components/TableGrid'
import { CardGrid, CardTile, CardTileNew } from '../components/CardGrid'
import TotalStatCard from '../components/StatCards'
import { getInitials, getAvatarColor } from '../lib/avatarColors'
import { nextSortDir, sortRows, customFieldSortValue, naturalSortByName } from '../lib/tableSort'
import { useEscapeToClose } from '../lib/useEscapeToClose'
import './Entities.css'

// Columnas que no son un campo custom configurable — calculada a partir de
// negotiation_products, no de custom_field_definitions.
const PRODUCT_STATIC_COLUMNS = [
  { key: 'projects_total', label: 'Proyectos totales' },
]
const PRODUCT_DEFAULT_VISIBLE = ['name', 'product_type', 'entity', 'projects_total']

function getProductSortValue(key, product, productFieldDefs) {
  switch (key) {
    case 'name': return product.name?.toLowerCase() || null
    case 'product_type': return product.product_type?.name?.toLowerCase() || null
    case 'entity': return product.entity?.name?.toLowerCase() || null
    case 'projects_total': return product.negotiation_products?.length || null
    default: return customFieldSortValue(productFieldDefs?.find(d => d.key === key), product, null, getCustomFieldValue, renderCustomFieldDisplay)
  }
}

// Valor de texto plano por columna para el export Excel — separado de
// renderProductCell porque ese devuelve JSX con badges.
function getProductExportValue(key, product, productFieldDefs, members) {
  switch (key) {
    case 'name': return product.name || ''
    case 'product_type': return product.product_type?.name || ''
    case 'entity': return product.entity?.name || ''
    case 'projects_total': return String(product.negotiation_products?.length || 0)
    default: {
      const def = productFieldDefs?.find(d => d.key === key)
      if (!def) return ''
      const raw = def.storage_column ? product[def.storage_column] : getCustomFieldValue(product.custom_fields, key)
      const val = renderCustomFieldDisplay(def, raw, members)
      return val === '—' ? '' : val
    }
  }
}

// Excel real (.xlsx), mismo motivo que en Proyectos: evita problemas de
// delimitador/codificación de un CSV plano. xlsx se carga bajo demanda
// (import dinámico) para no sumarlo al bundle inicial de /products.
async function exportProductsXlsx(products, cols, allColumns, productFieldDefs, members) {
  const XLSX = await import('xlsx')
  const visibleCols = cols.filter(c => c.visible)
  const headers = visibleCols.map(c => allColumns.find(x => x.key === c.key)?.label || c.key)
  const rows = [
    headers,
    ...products.map(p => visibleCols.map(c => getProductExportValue(c.key, p, productFieldDefs, members))),
  ]
  const ws = XLSX.utils.aoa_to_sheet(rows)
  ws['!cols'] = visibleCols.map(() => ({ wch: 22 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Productos')
  XLSX.writeFile(wb, `nerva-productos-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

export default function Products() {
  const { user, workspaceId, effectiveRole } = useAuth()
  const canBulkDelete = effectiveRole === 'owner'
  const canImport = effectiveRole === 'owner' || effectiveRole === 'admin' || effectiveRole === 'editor'
  const [products, setProducts] = useState([])
  const [productTypes, setProductTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [view, setView] = useState(() => (typeof window !== 'undefined' && window.innerWidth <= 860) ? 'cards' : 'table')
  const [showModal, setShowModal] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [showColEditor, setShowColEditor] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const [negotiationStates, setNegotiationStates] = useState([])
  const [productFieldDefs, setProductFieldDefs] = useState([])
  const [negotiationFieldDefs, setNegotiationFieldDefs] = useState([])
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)
  const [bulkWorking, setBulkWorking] = useState(false)
  const [members, setMembers] = useState([])
  const [fieldOrder, setFieldOrder] = useState(null)
  const [customFilterValues, setCustomFilterValues] = useState({})
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState(null)

  function handleSort(key) {
    const dir = nextSortDir(key, sortKey, sortDir)
    setSortDir(dir)
    setSortKey(dir ? key : null)
  }

  // Orden preset de columnas (antes de que cada usuario lo reordene a
  // mano) sigue el orden ya armado en Configuración → Campos.
  const orderedProductFieldDefs = fieldOrder === null
    ? productFieldDefs
    : computeFieldOrder('product', fieldOrder, productFieldDefs).map(key => productFieldDefs.find(d => d.key === key)).filter(Boolean)
  const [cols, saveCols] = useColumnPrefs({
    storageKey: `nerva_product_col_prefs_${user?.id}`,
    staticColumns: PRODUCT_STATIC_COLUMNS,
    defaultVisible: PRODUCT_DEFAULT_VISIBLE,
    customFieldDefs: orderedProductFieldDefs,
  })
  const allColumns = [
    ...orderedProductFieldDefs.map(d => ({ key: d.key, label: d.label, alwaysVisible: d.key === 'name' })),
    ...PRODUCT_STATIC_COLUMNS,
  ]

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleBulkDelete() {
    setBulkWorking(true)
    await supabase.from('products').delete().in('id', [...selectedIds])
    setSelectedIds(new Set())
    setShowBulkDeleteConfirm(false)
    setBulkWorking(false)
    fetchProducts()
  }

  useEffect(() => {
    if (!workspaceId) return
    fetchProducts()
    fetchProductTypes()
    fetchNegotiationStates()
    fetchCustomFieldDefs()
  }, [workspaceId])

  async function fetchProductTypes() {
    const { data } = await supabase.from('product_types').select('id, name, plural').eq('workspace_id', workspaceId).order('sort_order')
    if (data) setProductTypes(data)
  }

  useEffect(() => {
    supabase.from('workspace_members')
      .select('user_id, profile:user_id ( full_name )')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .then(({ data }) => setMembers(data || []))
  }, [workspaceId])

  useEffect(() => {
    supabase.from('workspaces').select('field_order').eq('id', workspaceId).single()
      .then(({ data }) => setFieldOrder(data?.field_order || {}))
  }, [workspaceId])

  async function fetchCustomFieldDefs() {
    const { data } = await supabase
      .from('custom_field_definitions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('sort_order')
    setProductFieldDefs((data || []).filter(d => d.object_type === 'product'))
    setNegotiationFieldDefs((data || []).filter(d => d.object_type === 'negotiation'))
  }

  async function fetchProducts() {
    setLoading(true)
    const { data: productsData, error } = await supabase
      .from('products')
      .select(`*, entity:entity_id ( id, name, country_code ), product_type:product_type_id ( name )`)
      .eq('workspace_id', workspaceId)
      .order('name')

    if (error) { setLoading(false); return }

    const productIds = productsData.map(p => p.id)
    const { data: negProducts } = await supabase
      .from('negotiation_products')
      .select('product_id, negotiation_id')
      .in('product_id', productIds)

    const negIds = [...new Set((negProducts || []).map(np => np.negotiation_id))]
    let negsData = []
    if (negIds.length > 0) {
      const { data } = await supabase
        .from('negotiations')
        .select('id, product, title, status, target_date, last_activity_at, activity_status, workspace_id')
        .in('id', negIds)
        .order('last_activity_at', { ascending: false })
      negsData = data || []
    }

    const combined = productsData.map(product => ({
      ...product,
      negotiation_products: (negProducts || [])
        .filter(np => np.product_id === product.id)
        .map(np => ({ ...np, negotiation: negsData.find(n => n.id === np.negotiation_id) || null })),
    }))

    setProducts(naturalSortByName(combined))
    setLoading(false)
  }

  async function fetchNegotiationStates() {
    const { data } = await supabase
      .from('custom_states')
      .select('name, color, bg_color')
      .eq('workspace_id', workspaceId)
      .eq('object_type', 'negotiation')
      .order('sort_order')
    if (data) setNegotiationStates(data)
  }

  function getStateConfig(stateName) {
    const found = negotiationStates.find(s => s.name === stateName)
    return found || { color: '#64748B', bg_color: '#F1F5F9' }
  }

  const filterableProductDefs = productFieldDefs.filter(isFieldFilterable)
  const productTypeDef = productFieldDefs.find(d => d.field_type === 'product_type')
  // El tipo de producto ya filtra desde las tarjetas de arriba (estilo Estados
  // en Proyectos) — se excluye de la fila de filtros genérica del toolbar
  // para no duplicar el mismo control dos veces.
  const toolbarFilterableDefs = filterableProductDefs.filter(d => d.field_type !== 'product_type')

  const productTypeCounts = productTypeDef ? productTypes.map(pt => ({
    ...pt,
    color: getAvatarColor(pt.name)[1],
    count: products.filter(p => p.product_type_id === pt.id).length,
  })) : []

  function toggleProductTypeFilter(typeId) {
    if (!productTypeDef) return
    setCustomFilterValues(v => {
      const cur = Array.isArray(v[productTypeDef.key]) ? v[productTypeDef.key] : []
      return { ...v, [productTypeDef.key]: cur.includes(typeId) ? cur.filter(x => x !== typeId) : [...cur, typeId] }
    })
  }

  // Todo lo que matchea excepto (opcionalmente) el filtro de un campo
  // puntual — así el checklist de cada filtro se arma solo con lo que
  // realmente puede aparecer dado todo lo demás ya elegido (facetado,
  // estilo Excel), en vez de mostrar un catálogo entero sin usar.
  function matchesAllProductFilters(p, { excludeDefKey } = {}) {
    if (!p.name.toLowerCase().includes(search.toLowerCase())) return false
    return matchesAllFieldFilters(filterableProductDefs, p, customFilterValues, excludeDefKey)
  }
  function productFacetRows(excludeDefKey) {
    return products.filter(p => matchesAllProductFilters(p, { excludeDefKey }))
  }

  // Botón "Filtros" (Mosaico/Kanban no tienen encabezado de columna) — el
  // tipo de producto queda afuera porque ya tiene su fila de tarjetas arriba.
  const filterPanelGroups = toolbarFilterableDefs.map(def => {
    const value = customFilterValues[def.key]
    return {
      key: def.key,
      label: def.label,
      options: filterChoicesFor(def, { members, productTypes, rows: productFacetRows(def.key) }),
      selected: Array.isArray(value) ? value : (value ? [value] : []),
      onChange: v => setCustomFilterValues(prev => ({ ...prev, [def.key]: v })),
    }
  })

  const filtered = products.filter(p => matchesAllProductFilters(p))

  const totalFilterParts = [
    ...describeFieldFilters(filterableProductDefs, customFilterValues, { members, productTypes, rows: products }),
    search ? `"${search}"` : null,
  ]

  const allVisibleSelected = filtered.length > 0 && filtered.every(p => selectedIds.has(p.id))
  function toggleSelectAll() {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(filtered.map(p => p.id)))
  }

  const sorted = sortKey
    ? sortRows(filtered, p => getProductSortValue(sortKey, p, productFieldDefs), sortDir)
    : filtered

  function exportRows() {
    return selectedIds.size > 0 ? filtered.filter(p => selectedIds.has(p.id)) : filtered
  }

  function handleExportExcel() {
    exportProductsXlsx(exportRows(), cols, allColumns, productFieldDefs, members)
  }

  return (
    <div className="entities-container">
      <div className="entities-header">
        <h1 className="entities-title">Productos</h1>
        <button className="entities-new-btn" onClick={() => setShowModal(true)}>
          + Nuevo producto
        </button>
      </div>

      <div className="neg-stats">
        <TotalStatCard label="Total productos" plural="productos" total={products.length} filteredCount={filtered.length} filterParts={totalFilterParts} />
        {productTypeCounts.map(pt => {
          const selected = Array.isArray(customFilterValues[productTypeDef?.key]) ? customFilterValues[productTypeDef.key] : []
          const pct = products.length ? Math.round((pt.count / products.length) * 100) : 0
          return (
            <div
              key={pt.id}
              className={`neg-stat-card ${selected.includes(pt.id) ? 'active' : ''}`}
              onClick={() => toggleProductTypeFilter(pt.id)}
              style={{ cursor: 'pointer' }}
            >
              <div className="neg-stat-label">{pt.plural || pt.name}</div>
              <div className="neg-stat-count" style={{ color: pt.color }}>{pt.count}<span className="neg-stat-pct">{pct}%</span></div>
              <div className="neg-stat-bar">
                <div className="neg-stat-bar-fill" style={{ width: `${pct}%`, backgroundColor: pt.color }} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="entities-toolbar">
        <div className="filter-field">
          <label className="filter-field-label">Buscar</label>
          <input
            className="entities-search"
            type="text"
            placeholder="🔍 Buscar producto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <FiltersPanelButton groups={filterPanelGroups} />
        <div className="neg-view-toggle">
          <button className={`neg-view-btn ${view === 'cards' ? 'active' : ''}`} onClick={() => setView('cards')} title="Mosaico"><LayoutGrid size={15} /></button>
          <button className={`neg-view-btn ${view === 'table' ? 'active' : ''}`} onClick={() => setView('table')} title="Tabla"><Table2 size={15} /></button>
        </div>
        {view === 'cards' && (
          <div className="neg-sort-select">
            <select
              value={sortKey || ''}
              onChange={e => { const k = e.target.value; setSortKey(k || null); setSortDir(k ? (sortDir || 'asc') : null) }}
            >
              <option value="">Ordenar por...</option>
              {allColumns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            {sortKey && (
              <button type="button" className="entities-export-btn" onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} title="Cambiar dirección">
                {sortDir === 'desc' ? '▼' : '▲'}
              </button>
            )}
          </div>
        )}
        {view === 'table' && (
          <button
            className={`entities-export-btn ${showColEditor ? 'active' : ''}`}
            onClick={() => setShowColEditor(v => !v)}
            title="Elegir qué columnas mostrar"
          >
            ⚙ Columnas
          </button>
        )}
        {canImport && (
          <button
            className="entities-export-btn"
            onClick={() => setShowImportModal(true)}
            title="Importar productos desde Excel/CSV"
          >
            ⬆ Importar
          </button>
        )}
        <button
          className="entities-export-btn"
          onClick={handleExportExcel}
          title={selectedIds.size > 0 ? `Exportar los ${selectedIds.size} seleccionados a Excel` : 'Exportar los productos filtrados a Excel'}
        >
          ⬇ Exportar Excel
        </button>
      </div>

      {showColEditor && view === 'table' && (
        <ColumnEditor cols={cols} allColumns={allColumns} onChange={saveCols} onClose={() => setShowColEditor(false)} />
      )}

      {showImportModal && (
        <ImportProductsModal
          workspaceId={workspaceId}
          productFieldDefs={productFieldDefs}
          onClose={() => setShowImportModal(false)}
          onImported={() => { fetchProducts(); fetchProductTypes() }}
        />
      )}

      {canBulkDelete && selectedIds.size > 0 && (
        <div className="entities-bulk-bar">
          <span className="entities-bulk-count">
            {selectedIds.size} seleccionado{selectedIds.size !== 1 ? 's' : ''}
            <button className="neg-pipeline-clear" onClick={() => setSelectedIds(new Set())}>Deseleccionar</button>
          </span>
          <button className="neg-bulk-delete-btn" disabled={bulkWorking} onClick={() => setShowBulkDeleteConfirm(true)}>
            🗑 Eliminar ({selectedIds.size})
          </button>
        </div>
      )}

      {showBulkDeleteConfirm && (
        <DeleteConfirmModal
          itemName="ELIMINAR"
          itemType={`${selectedIds.size} ${selectedIds.size === 1 ? 'producto' : 'productos'}`}
          onConfirm={handleBulkDelete}
          onCancel={() => setShowBulkDeleteConfirm(false)}
        />
      )}

      {loading ? (
        <div className="entities-loading">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="entities-empty"><p>No hay productos todavía.</p></div>
      ) : view === 'table' ? (
        <ProductsGridTable
          products={sorted}
          allRows={products}
          getFacetRows={productFacetRows}
          productFieldDefs={productFieldDefs}
          productTypes={productTypes}
          getStateConfig={getStateConfig}
          cols={cols}
          allColumns={allColumns}
          members={members}
          onSelect={setSelectedProduct}
          canBulkDelete={canBulkDelete}
          selectedIds={selectedIds}
          onToggleSelect={toggleSelect}
          allVisibleSelected={allVisibleSelected}
          onToggleSelectAll={toggleSelectAll}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          customFilterValues={customFilterValues}
          onFilterChange={(key, v) => setCustomFilterValues(prev => ({ ...prev, [key]: v }))}
          onColResize={(key, width) => saveCols(cols.map(c => c.key === key ? { ...c, width } : c))}
        />
      ) : (
        <CardGrid>
          {sorted.map(product => {
            const counts = getStateCounts(product.negotiation_products)
            return (
              <CardTile
                key={product.id}
                avatarLabel={product.name}
                title={product.name}
                titleBadge={product.product_type?.name && <span className="neg-chip neg-chip-blue entity-type-chip">{product.product_type.name}</span>}
                subtitle={product.entity?.name ? `Vendedor: ${product.entity.name}` : 'Sin entidad vendedora'}
                footer={
                  Object.keys(counts).length > 0 ? (
                    <div className="entity-state-badges">
                      {Object.entries(counts).map(([status, count]) => {
                        const cfg = getStateConfig(status)
                        return (
                          <span key={status} className="entity-state-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>
                            {count} {status}
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <span className="entity-no-projects">Sin proyectos</span>
                  )
                }
                selected={selectedIds.has(product.id)}
                showCheckbox={canBulkDelete}
                onToggleSelect={() => toggleSelect(product.id)}
                onClick={() => setSelectedProduct(product)}
              />
            )
          })}
          <CardTileNew label="Nuevo producto" onClick={() => setShowModal(true)} />
        </CardGrid>
      )}

      {showModal && (
        <ProductModal
          onClose={() => setShowModal(false)}
          onCreated={fetchProducts}
          customFieldDefs={productFieldDefs}
        />
      )}

      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          negotiationStates={negotiationStates}
          onClose={() => setSelectedProduct(null)}
          onUpdated={fetchProducts}
          productTypeSingular={selectedProduct.product_type?.name}
          getStateConfig={getStateConfig}
          productFieldDefs={productFieldDefs}
          negotiationFieldDefs={negotiationFieldDefs}
        />
      )}
    </div>
  )
}

// Mismo cálculo que en Mosaico: cuántos proyectos tiene el producto por
// estado — se reusa acá para pintar los mismos badges en la celda de tabla
// "Proyectos totales" (sin duplicar lógica entre las dos vistas).
function getStateCounts(negotiationLinks) {
  const negs = (negotiationLinks || []).map(n => n.negotiation).filter(Boolean)
  const counts = {}
  negs.forEach(n => { counts[n.status] = (counts[n.status] || 0) + 1 })
  return counts
}

function renderProjectsTotalCell(negotiationLinks, getStateConfig) {
  const counts = getStateCounts(negotiationLinks)
  if (Object.keys(counts).length === 0) return <span className="entity-no-projects">Sin proyectos</span>
  return (
    <div className="entity-state-badges">
      {Object.entries(counts).map(([status, count]) => {
        const cfg = getStateConfig ? getStateConfig(status) : { color: '#64748B', bg_color: '#F1F5F9' }
        return (
          <span key={status} className="entity-state-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>
            {count} {status}
          </span>
        )
      })}
    </div>
  )
}

// Celda de columna de la grilla de Productos — despacha por key, casos
// especiales primero (nombre, tipo/proveedor resueltos vía join, el
// calculado de PRODUCT_STATIC_COLUMNS) y default a `productFieldDefs`.
function renderProductCell(key, product, productFieldDefs, members, getStateConfig) {
  switch (key) {
    case 'name':
      return <td key={key} className="entities-td-name">{product.name}</td>
    case 'product_type':
      return <td key={key}>{product.product_type?.name || '—'}</td>
    case 'entity':
      return <td key={key}>{product.entity?.name || '—'}</td>
    case 'projects_total':
      return <td key={key}>{renderProjectsTotalCell(product.negotiation_products, getStateConfig)}</td>
    default: {
      const def = productFieldDefs?.find(d => d.key === key)
      if (!def) return <td key={key}>—</td>
      const raw = def.storage_column ? product[def.storage_column] : getCustomFieldValue(product.custom_fields, key)
      return <td key={key} className="entities-td-text">{renderCustomFieldDisplay(def, raw, members)}</td>
    }
  }
}

function ProductsGridTable({ products, allRows, getFacetRows, productFieldDefs, productTypes, cols, allColumns, members, getStateConfig, onSelect, canBulkDelete, selectedIds, onToggleSelect, allVisibleSelected, onToggleSelectAll, sortKey, sortDir, onSort, customFilterValues, onFilterChange, onColResize }) {
  function getColumnFilter(key) {
    const fieldDef = productFieldDefs.find(d => d.key === key)
    if (!fieldDef || !isFieldFilterable(fieldDef)) return null
    const filterValue = customFilterValues?.[key]
    return {
      options: filterChoicesFor(fieldDef, { members, productTypes, rows: getFacetRows ? getFacetRows(key) : (allRows || products) }),
      selected: Array.isArray(filterValue) ? filterValue : (filterValue ? [filterValue] : []),
      onChange: v => onFilterChange(key, v),
    }
  }

  return (
    <TableGrid
      rows={products}
      rowKey={product => product.id}
      cols={cols}
      allColumns={allColumns}
      renderCell={(key, product) => renderProductCell(key, product, productFieldDefs, members, getStateConfig)}
      getColumnFilter={getColumnFilter}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      onColResize={onColResize}
      showCheckbox={canBulkDelete}
      selectedIds={selectedIds}
      onToggleSelect={onToggleSelect}
      allVisibleSelected={allVisibleSelected}
      onToggleSelectAll={onToggleSelectAll}
      onSelectRow={onSelect}
    />
  )
}

export function ProductDetailModal({ product, negotiationStates, onClose, onUpdated, productTypeSingular, getStateConfig, productFieldDefs = [], negotiationFieldDefs = [] }) {
  const { effectiveRole, workspaceId, user } = useAuth()
  useEscapeToClose(onClose)
  const canDelete = effectiveRole === 'owner'
  const [showEditModal, setShowEditModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [selectedNeg, setSelectedNeg] = useState(null)
  const [editingNeg, setEditingNeg] = useState(null)
  const [showNegModal, setShowNegModal] = useState(false)
  const [members, setMembers] = useState([])
  const [entities, setEntities] = useState([])
  const [entityTypes, setEntityTypes] = useState([])
  const [allProducts, setAllProducts] = useState([])
  const [fieldOrder, setFieldOrder] = useState(null)
  const [bgColor, textColor] = getAvatarColor(product.name)

  useEffect(() => { fetchMembers(); fetchEntities(); fetchEntityTypes(); fetchAllProducts(); fetchFieldOrder() }, [product.id])

  async function fetchMembers() {
    const { data } = await supabase.from('workspace_members')
      .select('user_id, profile:user_id ( full_name, email )')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
    if (data) setMembers(data)
  }

  async function fetchEntities() {
    const { data } = await supabase.from('entities').select('id, name, country_code, entity_type_id').eq('workspace_id', workspaceId).order('name')
    if (data) setEntities(naturalSortByName(data))
  }

  async function fetchEntityTypes() {
    const { data } = await supabase.from('entity_types').select('id, name, plural').eq('workspace_id', workspaceId).order('sort_order')
    if (data) setEntityTypes(data)
  }

  async function fetchAllProducts() {
    const { data } = await supabase.from('products').select('id, name').eq('workspace_id', workspaceId).order('name')
    if (data) setAllProducts(naturalSortByName(data))
  }

  async function fetchFieldOrder() {
    const { data } = await supabase.from('workspaces').select('field_order').eq('id', workspaceId).single()
    setFieldOrder(data?.field_order || {})
  }

  const negs = (product.negotiation_products || [])
    .map(n => n.negotiation)
    .filter(Boolean)
    .sort((a, b) => new Date(b.last_activity_at || 0) - new Date(a.last_activity_at || 0))

  async function fetchFullNeg(neg) {
    const [{ data: full }, { data: ents }, { data: notesList }] = await Promise.all([
      supabase.from('negotiations').select('*').eq('id', neg.id).single(),
      supabase.from('negotiation_entities').select('negotiation_id, entity_id, entity:entity_id(id, name, country_code, entity_type_id)').eq('negotiation_id', neg.id),
      supabase.from('negotiation_notes').select('id, negotiation_id, content, note_date').eq('negotiation_id', neg.id).order('note_date'),
    ])
    if (!full) return null
    return { ...full, negotiation_entities: ents || [], notes_list: notesList || [] }
  }

  async function handleSelectNeg(neg) {
    const full = await fetchFullNeg(neg)
    if (full) setSelectedNeg(full)
  }

  async function refetchNeg(id) {
    return fetchFullNeg({ id })
  }

  async function handleDelete() {
    await supabase.from('products').delete().eq('id', product.id)
    onUpdated()
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="entity-detail-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
            <div className="entity-avatar" style={{ width: 38, height: 38, fontSize: 13, backgroundColor: bgColor, color: textColor, flexShrink: 0 }}>
              {getInitials(product.name)}
            </div>
            <div style={{ minWidth: 0 }}>
              <h2 className="modal-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{product.name}</h2>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
                {product.product_type?.name}
                {product.entity?.name ? ` · ${product.entity.name}` : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <button className="btn-edit" onClick={() => setShowEditModal(true)}>✏️ Editar</button>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="entity-detail-body entity-detail-body--cols">
          <div className="entity-detail-col entity-detail-col--left">
            <div className="detail-section">
              <div className="detail-section-title">Información</div>
              {(fieldOrder === null ? productFieldDefs.map(d => d.key) : computeFieldOrder('product', fieldOrder, productFieldDefs)).map(key => {
                const def = productFieldDefs.find(d => d.key === key)
                if (!def || def.field_type === 'product_type' || def.field_type === 'product_entity') return null
                const value = def.storage_column ? product[def.storage_column] : getCustomFieldValue(product.custom_fields, def.key)
                if (value === undefined || value === null || value === '') return null
                return (
                  <div key={key} className="entity-info-row">
                    <span className="entity-info-label">{def.label}</span>
                    <span className="entity-info-val"><CustomFieldReadOnly def={def} value={value} members={members} /></span>
                  </div>
                )
              })}
            </div>

            {canDelete && (
              <div className="detail-footer-inline">
                <button className="btn-delete" onClick={() => setConfirmDelete(true)}>
                  Eliminar {productTypeSingular?.toLowerCase() || 'producto'}
                </button>
              </div>
            )}
          </div>

          <div className="entity-detail-col entity-detail-col--right">
            <div className="entity-tabs">
              <button className="entity-tab active">Proyectos vinculados ({negs.length})</button>
            </div>

            {negs.length === 0 ? (
              <p className="detail-empty">Sin proyectos vinculados todavía.</p>
            ) : (
              <div className="entity-negs-list">
                {negs.map(neg => {
                  const cfg = getStateConfig(neg.status)
                  return (
                    <div key={neg.id} className="entity-neg-row" onClick={() => handleSelectNeg(neg)}>
                      <div className="entity-neg-main">
                        <div className="entity-neg-product">{neg.product || neg.title}</div>
                        {neg.target_date && (
                          <div className="entity-neg-date">
                            {new Date(neg.target_date + 'T00:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                          </div>
                        )}
                      </div>
                      <div className="entity-neg-right">
                        <span className="entity-neg-badge" style={{ backgroundColor: cfg.bg_color, color: cfg.color }}>{neg.status}</span>
                        <span className="entity-neg-arrow">›</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmDelete && (
        <DeleteConfirmModal
          itemName={product.name}
          itemType={productTypeSingular?.toLowerCase() || 'producto'}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {showEditModal && (
        <ProductModal
          initial={product}
          onClose={() => setShowEditModal(false)}
          onCreated={() => { onUpdated(); onClose() }}
          productTypeSingular={productTypeSingular}
          customFieldDefs={productFieldDefs}
        />
      )}

      {showNegModal && (
        <NegotiationModal
          initial={editingNeg}
          entities={entities}
          entityTypes={entityTypes}
          products={allProducts}
          members={members}
          customStates={negotiationStates}
          customFieldDefs={negotiationFieldDefs}
          onClose={() => { setShowNegModal(false); setSelectedNeg(null) }}
          onCancel={async () => {
            setShowNegModal(false)
            if (editingNeg) {
              const updated = await refetchNeg(editingNeg.id)
              setSelectedNeg(updated || editingNeg)
            }
          }}
          onSaved={async () => {
            setShowNegModal(false)
            if (editingNeg) {
              const updated = await refetchNeg(editingNeg.id)
              setSelectedNeg(updated || editingNeg)
            }
            onUpdated()
          }}
          workspaceId={workspaceId}
          userId={user?.id}
        />
      )}

      {selectedNeg && (
        <NegotiationDetail
          neg={selectedNeg}
          entities={entities}
          entityTypes={entityTypes}
          customStates={negotiationStates}
          customFieldDefs={negotiationFieldDefs}
          members={members}
          getStateConfig={getStateConfig}
          getEntityFlag={() => null}
          onClose={() => setSelectedNeg(null)}
          onEdit={() => { setEditingNeg(selectedNeg); setSelectedNeg(null); setShowNegModal(true) }}
          onDeleted={() => { setSelectedNeg(null); onUpdated() }}
          onActivityChanged={() => {}}
          onNotesChanged={() => {}}
        />
      )}
    </div>
  )
}
