import { useState, useMemo, useEffect, useRef } from 'react'
import * as XLSX from 'xlsx'
import { Plus, Trash2, Package, Eye, EyeOff, Upload, X, GripVertical, Tag, Layers, ChevronDown, Copy, List, Download, FileUp, Search } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent, DragStartEvent, DragOverlay,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useProducts, useCreateProduct, useUpdateProduct, useDeleteProduct } from '../../hooks/useProducts'
import { useVendors, useCategories, useUnits } from '../../hooks/useMetadata'
import { useAdminLocations } from '../../hooks/useAdminData'
import { useProductLocations, useSetProductLocations, useAllProductLocations } from '../../hooks/useProductLocations'
import { supabase } from '../../lib/supabase'
import Modal from '../../components/ui/Modal'
import Spinner from '../../components/ui/Spinner'
import EmptyState from '../../components/ui/EmptyState'
import toast from 'react-hot-toast'
import type { Product } from '../../types'

// ── Tag button helper ────────────────────────────────────────────────────────

function TagBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all whitespace-nowrap ${
        active ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  )
}

// ── Image thumbnail with click-to-upload ────────────────────────────────────

function thumbUrl(url: string, px = 64) {
  return url.replace('/storage/v1/object/public/', `/storage/v1/render/image/public/`) + `?width=${px}&height=${px}&resize=cover&quality=80`
}

function ImageUploadThumb({ product, size = 10 }: { product: Product; size?: number }) {
  const updateProduct = useUpdateProduct()
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputId = `img-${product.id}-thumb`
  const dim = `w-${size} h-${size}`

  const uploadFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast.error('Please drop an image file'); return }
    setUploading(true)
    const path = `${Date.now()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('products').upload(path, file, { upsert: true })
    if (error) { toast.error('Upload failed'); setUploading(false); return }
    const { data: { publicUrl } } = supabase.storage.from('products').getPublicUrl(path)
    try {
      await updateProduct.mutateAsync({ id: product.id, image_url: publicUrl })
    } catch { toast.error('Failed to save image') }
    setUploading(false)
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''
    await uploadFile(file)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await uploadFile(file)
  }

  const handleRemove = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try { await updateProduct.mutateAsync({ id: product.id, image_url: null }) }
    catch { toast.error('Failed to remove image') }
  }

  return (
    <label
      htmlFor={inputId}
      className={`${dim} rounded-xl bg-slate-100 overflow-hidden shrink-0 cursor-pointer group relative block transition-colors ${dragOver ? 'ring-2 ring-indigo-400 bg-indigo-50' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {uploading ? (
        <div className="w-full h-full flex items-center justify-center"><Spinner size={14} /></div>
      ) : product.image_url ? (
        <>
          <img src={thumbUrl(product.image_url)} alt={product.name} className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
            <Upload size={11} className="text-white" />
          </div>
          <button
            onClick={handleRemove}
            className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/60 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
          >
            <X size={9} className="text-white" />
          </button>
        </>
      ) : (
        <div className={`w-full h-full flex flex-col items-center justify-center gap-0.5 transition-colors ${dragOver ? 'text-indigo-500' : 'text-slate-400 group-hover:bg-slate-200'}`}>
          <Upload size={13} />
        </div>
      )}
      <input id={inputId} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
    </label>
  )
}

// ── Field dropdown (popover anchored to tag) ─────────────────────────────────

function FieldDropdown({ label, open, onToggle, onClose, children }: {
  label: React.ReactNode; open: boolean; onToggle: () => void; onClose: () => void; children: React.ReactNode
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({})

  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const openUp = rect.bottom + 220 > window.innerHeight
      setDropStyle(openUp
        ? { position: 'fixed', bottom: window.innerHeight - rect.top + 4, left: rect.left, zIndex: 50 }
        : { position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 50 }
      )
    }
    onToggle()
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        onClick={handleToggle}
        className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs border transition-all whitespace-nowrap ${
          open
            ? 'bg-indigo-600 text-white border-indigo-600'
            : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
        }`}
      >
        {label}
        <ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <div style={dropStyle} className="bg-white border border-slate-200 rounded-xl shadow-lg p-2 flex flex-wrap gap-1.5 min-w-[160px] max-w-[260px]">
            {children}
          </div>
        </>
      )}
    </div>
  )
}

// ── Inline edit row (edit mode) ──────────────────────────────────────────────

type OpenField = 'vendor' | 'category' | 'unit' | null

function InlineEditRow({ product: p, onDelete, onDuplicate, showVendorHeader, vendorCount }: {
  product: Product; onDelete: (p: Product) => void; onDuplicate: (p: Product) => void
  showVendorHeader?: boolean; vendorCount?: number
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 10 : undefined }

  const updateProduct = useUpdateProduct()
  const setProductLocations = useSetProductLocations()
  const { data: vendors } = useVendors()
  const { data: categories } = useCategories()
  const { data: units } = useUnits()
  const { data: allLocations } = useAdminLocations()
  const { data: locIds = [] } = useProductLocations(p.id)

  const [openField, setOpenField] = useState<OpenField>(null)
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState(p.name)
  const [editingVendorName, setEditingVendorName] = useState(false)
  const [vendorName, setVendorName] = useState(p.vendor_name ?? '')
  const [editingChefsId, setEditingChefsId] = useState(false)
  const [chefsId, setChefsId] = useState(p.chefsculinar_id ?? '')
  const [editingChefsUnit, setEditingChefsUnit] = useState(false)
  const [chefsUnit, setChefsUnit] = useState(p.chefsculinar_unit ?? '')
  const [editingChefsQty, setEditingChefsQty] = useState(false)
  const [chefsQty, setChefsQty] = useState(String(p.chefsculinar_unit_qty ?? ''))
  const [editingTingstadId, setEditingTingstadId] = useState(false)
  const [tingstadId, setTingstadId] = useState(p.tingstad_id ?? '')
  const [editingTingstadUnit, setEditingTingstadUnit] = useState(false)
  const [tingstadUnit, setTingstadUnit] = useState(p.tingstad_unit ?? '')
  const [editingTingstadQty, setEditingTingstadQty] = useState(false)
  const [tingstadQty, setTingstadQty] = useState(String(p.tingstad_unit_qty ?? ''))

  useEffect(() => { setName(p.name) }, [p.name])
  useEffect(() => { setVendorName(p.vendor_name ?? '') }, [p.vendor_name])
  useEffect(() => { setChefsId(p.chefsculinar_id ?? '') }, [p.chefsculinar_id])
  useEffect(() => { setChefsUnit(p.chefsculinar_unit ?? '') }, [p.chefsculinar_unit])
  useEffect(() => { setChefsQty(String(p.chefsculinar_unit_qty ?? '')) }, [p.chefsculinar_unit_qty])
  useEffect(() => { setTingstadId(p.tingstad_id ?? '') }, [p.tingstad_id])
  useEffect(() => { setTingstadUnit(p.tingstad_unit ?? '') }, [p.tingstad_unit])
  useEffect(() => { setTingstadQty(String(p.tingstad_unit_qty ?? '')) }, [p.tingstad_unit_qty])

  const toggleField = (field: Exclude<OpenField, null>) =>
    setOpenField(prev => prev === field ? null : field)

  const save = (updates: Partial<Omit<Product, 'id' | 'created_at'>>) =>
    updateProduct.mutate({ id: p.id, ...updates })

  const saveName = () => {
    const trimmed = name.trim()
    if (trimmed && trimmed !== p.name) save({ name: trimmed })
    else setName(p.name)
    setEditingName(false)
  }

  const saveVendorName = () => {
    const trimmed = vendorName.trim()
    if (trimmed !== (p.vendor_name ?? '')) save({ vendor_name: trimmed || null })
    else setVendorName(p.vendor_name ?? '')
    setEditingVendorName(false)
  }

  const saveChefsId = () => {
    const trimmed = chefsId.trim()
    if (trimmed !== (p.chefsculinar_id ?? '')) save({ chefsculinar_id: trimmed || null })
    else setChefsId(p.chefsculinar_id ?? '')
    setEditingChefsId(false)
  }

  const saveChefsUnit = () => {
    const trimmed = chefsUnit.trim()
    if (trimmed !== (p.chefsculinar_unit ?? '')) save({ chefsculinar_unit: trimmed || null })
    else setChefsUnit(p.chefsculinar_unit ?? '')
    setEditingChefsUnit(false)
  }

  const saveChefsQty = () => {
    const num = parseFloat(chefsQty)
    const val = isNaN(num) ? null : num
    if (val !== (p.chefsculinar_unit_qty ?? null)) save({ chefsculinar_unit_qty: val })
    else setChefsQty(String(p.chefsculinar_unit_qty ?? ''))
    setEditingChefsQty(false)
  }

  const saveTingstadId = () => {
    const trimmed = tingstadId.trim()
    if (trimmed !== (p.tingstad_id ?? '')) save({ tingstad_id: trimmed || null })
    else setTingstadId(p.tingstad_id ?? '')
    setEditingTingstadId(false)
  }

  const saveTingstadUnit = () => {
    const trimmed = tingstadUnit.trim()
    if (trimmed !== (p.tingstad_unit ?? '')) save({ tingstad_unit: trimmed || null })
    else setTingstadUnit(p.tingstad_unit ?? '')
    setEditingTingstadUnit(false)
  }

  const saveTingstadQty = () => {
    const num = parseFloat(tingstadQty)
    const val = isNaN(num) ? null : num
    if (val !== (p.tingstad_unit_qty ?? null)) save({ tingstad_unit_qty: val })
    else setTingstadQty(String(p.tingstad_unit_qty ?? ''))
    setEditingTingstadQty(false)
  }

  const toggleLoc = (id: string) => {
    const next = locIds.includes(id) ? locIds.filter(l => l !== id) : [...locIds, id]
    setProductLocations.mutate({ productId: p.id, locationIds: next })
  }

  const optionClass = (active: boolean) =>
    `px-2 py-0.5 rounded-lg text-xs font-medium transition-all border cursor-pointer ${
      active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
    }`

  if (isDragging) {
    return (
      <div ref={setNodeRef} style={style}>
        {showVendorHeader && <div className="h-9" />}
        <div className="h-11 mx-2 my-0.5 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/30" />
      </div>
    )
  }

  const vendorHeader = showVendorHeader && (
    <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{p.vendor || 'No Vendor'}</span>
      {vendorCount !== undefined && <span className="text-xs text-slate-400">{vendorCount}</span>}
    </div>
  )

  return (
    <div ref={setNodeRef} style={style}>
      {vendorHeader}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-white border-b border-slate-100 last:border-0">
      {/* Drag handle */}
      <button {...attributes} {...listeners}
        className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing touch-none p-0.5 shrink-0">
        <GripVertical size={14} />
      </button>

      <ImageUploadThumb product={p} size={8} />

      {/* Names */}
      <div className="flex flex-col shrink-0 w-32">
        {editingName ? (
          <input value={name} onChange={e => setName(e.target.value)} onBlur={saveName}
            onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setName(p.name); setEditingName(false) } }}
            className="w-full px-1.5 py-0.5 rounded border border-indigo-300 text-sm font-medium focus:outline-none bg-white" autoFocus />
        ) : (
          <button onClick={() => setEditingName(true)} className="text-sm font-medium text-slate-900 hover:text-indigo-600 truncate text-left">
            {p.name}
          </button>
        )}
        {editingVendorName ? (
          <input value={vendorName} onChange={e => setVendorName(e.target.value)} onBlur={saveVendorName}
            onKeyDown={e => { if (e.key === 'Enter') saveVendorName(); if (e.key === 'Escape') { setVendorName(p.vendor_name ?? ''); setEditingVendorName(false) } }}
            placeholder="Vendor name…"
            className="w-full px-1.5 py-0.5 rounded border border-amber-300 text-xs focus:outline-none bg-white" autoFocus />
        ) : (
          <button onClick={() => setEditingVendorName(true)}
            className={`text-xs truncate text-left leading-tight ${p.vendor_name ? 'text-amber-600 hover:text-amber-700' : 'text-slate-300 hover:text-slate-400'}`}>
            {p.vendor_name ?? '+ vendor name'}
          </button>
        )}
      </div>

      {/* ChefsCulinar article ID + unit */}
      <div className="flex flex-col shrink-0 w-20">
        {editingChefsId ? (
          <input value={chefsId} onChange={e => setChefsId(e.target.value)} onBlur={saveChefsId}
            onKeyDown={e => { if (e.key === 'Enter') saveChefsId(); if (e.key === 'Escape') { setChefsId(p.chefsculinar_id ?? ''); setEditingChefsId(false) } }}
            placeholder="Art.nr…"
            className="w-full px-1.5 py-0.5 rounded border border-blue-300 text-xs focus:outline-none bg-white" autoFocus />
        ) : (
          <button onClick={() => setEditingChefsId(true)}
            className={`text-xs truncate text-left leading-tight ${p.chefsculinar_id ? 'text-blue-600 hover:text-blue-700' : 'text-slate-300 hover:text-slate-400'}`}>
            {p.chefsculinar_id ?? '+ art.nr'}
          </button>
        )}
        <div className="flex gap-1">
          {editingChefsUnit ? (
            <input value={chefsUnit} onChange={e => setChefsUnit(e.target.value)} onBlur={saveChefsUnit}
              onKeyDown={e => { if (e.key === 'Enter') saveChefsUnit(); if (e.key === 'Escape') { setChefsUnit(p.chefsculinar_unit ?? ''); setEditingChefsUnit(false) } }}
              placeholder="Enhet…"
              className="w-10 px-1.5 py-0.5 rounded border border-blue-300 text-xs focus:outline-none bg-white" autoFocus />
          ) : (
            <button onClick={() => setEditingChefsUnit(true)}
              className={`text-xs truncate text-left leading-tight ${p.chefsculinar_unit ? 'text-blue-400 hover:text-blue-600' : 'text-slate-300 hover:text-slate-400'}`}>
              {p.chefsculinar_unit ?? '+ enhet'}
            </button>
          )}
          {editingChefsQty ? (
            <input value={chefsQty} onChange={e => setChefsQty(e.target.value)} onBlur={saveChefsQty}
              onKeyDown={e => { if (e.key === 'Enter') saveChefsQty(); if (e.key === 'Escape') { setChefsQty(String(p.chefsculinar_unit_qty ?? '')); setEditingChefsQty(false) } }}
              placeholder="1"
              className="w-8 px-1.5 py-0.5 rounded border border-blue-300 text-xs focus:outline-none bg-white" autoFocus />
          ) : (p.chefsculinar_unit_qty && p.chefsculinar_unit_qty !== 1) ? (
            <button onClick={() => setEditingChefsQty(true)}
              className="text-xs text-blue-300 hover:text-blue-500 leading-tight">
              ×{p.chefsculinar_unit_qty}
            </button>
          ) : (
            <button onClick={() => setEditingChefsQty(true)} className="text-xs text-slate-200 hover:text-slate-400 leading-tight">×1</button>
          )}
        </div>
      </div>

      {/* Tingstad article ID + unit */}
      <div className="flex flex-col shrink-0 w-20">
        {editingTingstadId ? (
          <input value={tingstadId} onChange={e => setTingstadId(e.target.value)} onBlur={saveTingstadId}
            onKeyDown={e => { if (e.key === 'Enter') saveTingstadId(); if (e.key === 'Escape') { setTingstadId(p.tingstad_id ?? ''); setEditingTingstadId(false) } }}
            placeholder="Tingstad nr…"
            className="w-full px-1.5 py-0.5 rounded border border-teal-300 text-xs focus:outline-none bg-white" autoFocus />
        ) : (
          <button onClick={() => setEditingTingstadId(true)}
            className={`text-xs truncate text-left leading-tight ${p.tingstad_id ? 'text-teal-600 hover:text-teal-700' : 'text-slate-300 hover:text-slate-400'}`}>
            {p.tingstad_id ?? '+ tingstad'}
          </button>
        )}
        <div className="flex gap-1">
          {editingTingstadUnit ? (
            <input value={tingstadUnit} onChange={e => setTingstadUnit(e.target.value)} onBlur={saveTingstadUnit}
              onKeyDown={e => { if (e.key === 'Enter') saveTingstadUnit(); if (e.key === 'Escape') { setTingstadUnit(p.tingstad_unit ?? ''); setEditingTingstadUnit(false) } }}
              placeholder="Enhet…"
              className="w-10 px-1.5 py-0.5 rounded border border-teal-300 text-xs focus:outline-none bg-white" autoFocus />
          ) : (
            <button onClick={() => setEditingTingstadUnit(true)}
              className={`text-xs truncate text-left leading-tight ${p.tingstad_unit ? 'text-teal-400 hover:text-teal-600' : 'text-slate-300 hover:text-slate-400'}`}>
              {p.tingstad_unit ?? '+ enhet'}
            </button>
          )}
          {editingTingstadQty ? (
            <input value={tingstadQty} onChange={e => setTingstadQty(e.target.value)} onBlur={saveTingstadQty}
              onKeyDown={e => { if (e.key === 'Enter') saveTingstadQty(); if (e.key === 'Escape') { setTingstadQty(String(p.tingstad_unit_qty ?? '')); setEditingTingstadQty(false) } }}
              placeholder="1"
              className="w-8 px-1.5 py-0.5 rounded border border-teal-300 text-xs focus:outline-none bg-white" autoFocus />
          ) : (p.tingstad_unit_qty && p.tingstad_unit_qty !== 1) ? (
            <button onClick={() => setEditingTingstadQty(true)}
              className="text-xs text-teal-300 hover:text-teal-500 leading-tight">
              ×{p.tingstad_unit_qty}
            </button>
          ) : (
            <button onClick={() => setEditingTingstadQty(true)} className="text-xs text-slate-200 hover:text-slate-400 leading-tight">×1</button>
          )}
        </div>
      </div>

      {/* Field dropdowns: vendor, category, unit */}
      <div className="flex items-center gap-1 flex-wrap">
        <FieldDropdown open={openField === 'vendor'} label={p.vendor || <span className="text-slate-400">Vendor</span>}
          onToggle={() => toggleField('vendor')} onClose={() => setOpenField(null)}>
          {vendors?.map(v => (
            <button key={v.id} onClick={() => { save({ vendor: p.vendor === v.name ? '' : v.name }); setOpenField(null) }} className={optionClass(p.vendor === v.name)}>{v.name}</button>
          ))}
        </FieldDropdown>
        <FieldDropdown open={openField === 'category'} label={p.category || <span className="text-slate-400">Cat</span>}
          onToggle={() => toggleField('category')} onClose={() => setOpenField(null)}>
          {categories?.map(c => (
            <button key={c.id} onClick={() => { save({ category: p.category === c.name ? '' : c.name }); setOpenField(null) }} className={optionClass(p.category === c.name)}>{c.name}</button>
          ))}
        </FieldDropdown>
        <FieldDropdown open={openField === 'unit'} label={p.unit || <span className="text-slate-400">Unit</span>}
          onToggle={() => toggleField('unit')} onClose={() => setOpenField(null)}>
          {units?.map(u => (
            <button key={u.id} onClick={() => { save({ unit: p.unit === u.name ? '' : u.name }); setOpenField(null) }} className={optionClass(p.unit === u.name)}>{u.name}</button>
          ))}
        </FieldDropdown>
      </div>

      {/* Location hide chips — click to toggle hidden */}
      <div className="flex items-center gap-1 flex-wrap flex-1">
        {allLocations?.map(loc => {
          const hidden = locIds.includes(loc.id)
          return (
            <button key={loc.id} onClick={() => toggleLoc(loc.id)}
              title={hidden ? `Unhide at ${loc.name}` : `Hide at ${loc.name}`}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                hidden ? 'bg-red-100 text-red-600 line-through' : 'bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600'
              }`}>
              {loc.name}
            </button>
          )
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        <button onClick={() => save({ active: !p.active })}
          className={`p-1 rounded-lg transition-colors ${p.active ? 'text-emerald-500 hover:bg-emerald-50' : 'text-slate-300 hover:bg-slate-100'}`}>
          {p.active ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
        <button onClick={() => onDuplicate(p)} className="p-1 rounded-lg text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 transition-colors">
          <Copy size={14} />
        </button>
        <button onClick={() => onDelete(p)} className="p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
          <Trash2 size={14} />
        </button>
      </div>
      </div>
    </div>
  )
}

// ── Batch add modal ──────────────────────────────────────────────────────────

function BatchAddModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const createProduct = useCreateProduct()
  const setProductLocations = useSetProductLocations()
  const { data: vendors } = useVendors()
  const { data: categories } = useCategories()
  const { data: units } = useUnits()
  const { data: allLocations } = useAdminLocations()

  const [text, setText] = useState('')
  const [vendor, setVendor] = useState('')
  const [category, setCategory] = useState('')
  const [unit, setUnit] = useState('')
  const [selectedLocIds, setSelectedLocIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) { setText(''); setVendor(''); setCategory(''); setUnit(''); setSelectedLocIds([]) }
  }, [open])

  const names = text.split(',').map(s => s.trim()).filter(Boolean)

  const toggleLoc = (id: string) =>
    setSelectedLocIds(prev => prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id])

  const tagClass = (active: boolean) =>
    `px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`

  const handleSave = async () => {
    if (!names.length) { toast.error('Enter at least one product name'); return }
    setSaving(true)
    try {
      for (const name of names) {
        const p = await createProduct.mutateAsync({ name, vendor_name: null, vendor, category, unit, image_url: null, active: true, sort_order: 0 })
        if (selectedLocIds.length > 0) {
          await setProductLocations.mutateAsync({ productId: p.id, locationIds: selectedLocIds })
        }
      }
      toast.success(`${names.length} product${names.length > 1 ? 's' : ''} added`)
      onSaved()
      onClose()
    } catch { toast.error('Failed to add products') }
    finally { setSaving(false) }
  }

  return (
    <Modal open={open} onClose={onClose} title="Batch Add Products" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Product names (comma-separated) *</label>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            rows={3}
            placeholder="Coffee Beans, Sugar, Milk, Oat Milk"
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            autoFocus
          />
          {names.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {names.map((n, i) => (
                <span key={i} className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded-lg text-xs">{n}</span>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2 flex items-center gap-1"><Tag size={11} /> Vendor</label>
          <div className="flex flex-wrap gap-2">
            {vendors?.map(v => (
              <button key={v.id} onClick={() => setVendor(vendor === v.name ? '' : v.name)} className={tagClass(vendor === v.name)}>
                {v.name}
              </button>
            ))}
            {!vendors?.length && <p className="text-xs text-slate-400">No vendors — add in Settings.</p>}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2 flex items-center gap-1"><Layers size={11} /> Category</label>
          <div className="flex flex-wrap gap-2">
            {categories?.map(c => (
              <button key={c.id} onClick={() => setCategory(category === c.name ? '' : c.name)} className={tagClass(category === c.name)}>
                {c.name}
              </button>
            ))}
            {!categories?.length && <p className="text-xs text-slate-400">No categories — add in Settings.</p>}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2">Unit</label>
          <div className="flex flex-wrap gap-2">
            {units?.map(u => (
              <button key={u.id} onClick={() => setUnit(unit === u.name ? '' : u.name)} className={tagClass(unit === u.name)}>
                {u.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Hide at locations</label>
          <p className="text-xs text-slate-400 mb-2">Selected locations will NOT see this product</p>
          <div className="flex flex-wrap gap-2">
            {allLocations?.map(loc => (
              <button key={loc.id} onClick={() => toggleLoc(loc.id)} className={tagClass(selectedLocIds.includes(loc.id))}>
                {loc.name}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || names.length === 0}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving && <Spinner size={18} className="border-white border-t-white/30" />}
          {names.length > 0 ? `Add ${names.length} product${names.length > 1 ? 's' : ''}` : 'Add Products'}
        </button>
      </div>
    </Modal>
  )
}

// ── Product form modal (for creating new products) ───────────────────────────

interface FormModalProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
}

function ProductFormModal({ open, onClose, onSaved }: FormModalProps) {
  const createProduct = useCreateProduct()
  const setProductLocations = useSetProductLocations()
  const { data: vendors } = useVendors()
  const { data: categories } = useCategories()
  const { data: units } = useUnits()
  const { data: allLocations } = useAdminLocations()

  const emptyForm = { name: '', vendor_name: '', vendor: '', category: '', unit: '', image_url: '', active: true, sort_order: 0 }
  const [form, setForm] = useState(emptyForm)
  const [selectedLocIds, setSelectedLocIds] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)

  useEffect(() => { if (!open) { setForm(emptyForm); setSelectedLocIds([]) } }, [open])

  const toggleLoc = (id: string) => setSelectedLocIds(prev =>
    prev.includes(id) ? prev.filter(l => l !== id) : [...prev, id]
  )

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploading(true)
    const path = `${Date.now()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('products').upload(path, file, { upsert: true })
    if (error) { toast.error('Image upload failed'); setUploading(false); return }
    const { data: { publicUrl } } = supabase.storage.from('products').getPublicUrl(path)
    setForm(f => ({ ...f, image_url: publicUrl }))
    setUploading(false)
  }

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Product name is required'); return }
    try {
      const p = await createProduct.mutateAsync({ ...form, vendor_name: form.vendor_name.trim() || null, image_url: form.image_url || null })
      await setProductLocations.mutateAsync({ productId: p.id, locationIds: selectedLocIds })
      toast.success('Product created')
      onSaved()
      onClose()
    } catch { toast.error('Failed to create product') }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Product" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Display Name *</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. Coffee Beans" autoFocus />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Vendor Name <span className="font-normal text-slate-400">(used in order notifications)</span></label>
          <input value={form.vendor_name} onChange={e => setForm(f => ({ ...f, vendor_name: e.target.value }))}
            className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" placeholder="e.g. Kaffe Bönor (leave blank to use display name)" />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2 flex items-center gap-1"><Tag size={11} /> Vendor</label>
          <div className="flex flex-wrap gap-2">
            {vendors?.map(v => (
              <button key={v.id} onClick={() => setForm(f => ({ ...f, vendor: f.vendor === v.name ? '' : v.name }))}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${form.vendor === v.name ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {v.name}
              </button>
            ))}
            {!vendors?.length && <p className="text-xs text-slate-400">No vendors yet — add them in Settings.</p>}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2 flex items-center gap-1"><Layers size={11} /> Category</label>
          <div className="flex flex-wrap gap-2">
            {categories?.map(c => (
              <button key={c.id} onClick={() => setForm(f => ({ ...f, category: f.category === c.name ? '' : c.name }))}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${form.category === c.name ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {c.name}
              </button>
            ))}
            {!categories?.length && <p className="text-xs text-slate-400">No categories yet — add them in Settings.</p>}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-2">Unit</label>
          <div className="flex flex-wrap gap-2">
            {units?.map(u => (
              <button key={u.id} onClick={() => setForm(f => ({ ...f, unit: f.unit === u.name ? '' : u.name }))}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${form.unit === u.name ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {u.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Hide at locations</label>
          <p className="text-xs text-slate-400 mb-2">Selected locations will NOT see this product</p>
          <div className="flex flex-wrap gap-2">
            {allLocations?.map(loc => (
              <button key={loc.id} onClick={() => toggleLoc(loc.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${selectedLocIds.includes(loc.id) ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {loc.name}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">Image</label>
          {form.image_url ? (
            <div className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200">
              <img src={form.image_url} alt="" className="w-full h-full object-cover" />
              <button onClick={() => setForm(f => ({ ...f, image_url: '' }))}
                className="absolute top-1 right-1 w-5 h-5 bg-white rounded-full flex items-center justify-center shadow">
                <X size={11} className="text-slate-500" />
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-colors">
              {uploading ? <Spinner size={16} /> : <Upload size={16} className="text-slate-400" />}
              <span className="text-sm text-slate-400">{uploading ? 'Uploading...' : 'Upload image'}</span>
              <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} disabled={uploading} />
            </label>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setForm(f => ({ ...f, active: !f.active }))}
            className={`relative w-10 h-6 rounded-full transition-colors ${form.active ? 'bg-indigo-600' : 'bg-slate-200'}`}>
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.active ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
          <span className="text-sm text-slate-600">Active (visible to staff)</span>
        </div>

        <button onClick={handleSave} disabled={createProduct.isPending}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {createProduct.isPending && <Spinner size={18} className="border-white border-t-white/30" />}
          Create Product
        </button>
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProductsPage() {
  const { data: serverProducts, isLoading } = useProducts()
  const updateProduct = useUpdateProduct()
  const deleteProduct = useDeleteProduct()
  const createProduct = useCreateProduct()
  const setProductLocations = useSetProductLocations()
  const { data: allLocations } = useAdminLocations()
  const { data: allProductLocations } = useAllProductLocations()
  const { data: vendors } = useVendors()
  const { data: categories } = useCategories()

  const [localOrder, setLocalOrder] = useState<string[]>([])
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [batchModalOpen, setBatchModalOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const importRef = useRef<HTMLInputElement>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [filterVendor, setFilterVendor] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const products = useMemo(() => {
    if (!serverProducts) return []
    const ordered = localOrder.length
      ? [...serverProducts].sort((a, b) => localOrder.indexOf(a.id) - localOrder.indexOf(b.id))
      : serverProducts
    const q = search.toLowerCase()
    return ordered.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.vendor_name ?? '').toLowerCase().includes(q)) return false
      if (filterVendor && (p.vendor || '') !== filterVendor) return false
      if (filterCategory && p.category !== filterCategory) return false
      if (filterStatus === 'active' && !p.active) return false
      if (filterStatus === 'inactive' && p.active) return false
      return true
    })
  }, [serverProducts, localOrder, search, filterVendor, filterCategory, filterStatus])

  // Vendor-grouped flat list — all sortable items stay siblings so DnD transforms work
  const flatProducts = useMemo(() => {
    const vendorOrder = (vendors ?? []).map(v => v.name)
    const map = new Map<string, Product[]>()
    for (const p of products) {
      const v = p.vendor || 'No Vendor'
      map.set(v, [...(map.get(v) ?? []), p])
    }
    const seenVendors = [...map.keys()]
    const orderedVendors = [
      ...vendorOrder.filter(v => map.has(v)),
      ...seenVendors.filter(v => !vendorOrder.includes(v)),
    ]
    return orderedVendors.flatMap(v => map.get(v)!)
  }, [products, vendors])

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingId(event.active.id as string)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setDraggingId(null)
    const { active, over } = event
    if (!over || active.id === over.id || !serverProducts) return
    const ids = flatProducts.map(p => p.id)
    const newOrder = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    setLocalOrder(newOrder)
    await Promise.all(newOrder.map((id, idx) => supabase.from('products').update({ sort_order: idx }).eq('id', id)))
  }

  const handleDelete = async (p: Product) => {
    if (!confirm(`Delete "${p.name}"?`)) return
    try { await deleteProduct.mutateAsync(p.id); setLocalOrder(o => o.filter(id => id !== p.id)); toast.success('Deleted') }
    catch { toast.error('Failed') }
  }

  const handleDuplicate = async (p: Product) => {
    try {
      const { id: _id, created_at: _ca, product_locations: pl, ...rest } = p as Product & { created_at: string; product_locations: { location_id: string }[] }
      const created = await createProduct.mutateAsync({ ...rest, name: `${p.name} (copy)` })
      const locIds = (pl ?? []).map(l => l.location_id)
      if (locIds.length > 0) await setProductLocations.mutateAsync({ productId: created.id, locationIds: locIds })
      toast.success('Duplicated')
    } catch { toast.error('Duplicate failed') }
  }

  const hasFilters = search || filterVendor || filterCategory || filterStatus !== 'all'

  const handleExport = () => {
    if (!serverProducts?.length) { toast.error('No products to export'); return }
    const locs = allLocations ?? []
    const excluded = new Set((allProductLocations ?? []).map(pl => `${pl.product_id}:${pl.location_id}`))

    const makeRow = (p: Product) => {
      const locCols: Record<string, string> = {}
      for (const loc of locs) {
        locCols[loc.name] = excluded.has(`${p.id}:${loc.id}`) ? 'HIDDEN' : 'ACTIVE'
      }
      return {
        ID: p.id,
        'Display Name': p.name,
        'Vendor Name (notifications)': p.vendor_name ?? '',
        Category: p.category,
        Unit: p.unit,
        Active: p.active ? 'TRUE' : 'FALSE',
        'Sort Order': p.sort_order,
        'Image URL': p.image_url ?? '',
        'ChefsCulinar ID': p.chefsculinar_id ?? '',
        'ChefsCulinar Unit': p.chefsculinar_unit ?? '',
        'ChefsCulinar Unit Qty': p.chefsculinar_unit_qty ?? '',
        'Tingstad ID': p.tingstad_id ?? '',
        'Tingstad Unit': p.tingstad_unit ?? '',
        'Tingstad Unit Qty': p.tingstad_unit_qty ?? '',
        ...locCols,
      }
    }

    const colWidths = [{ wch: 36 }, { wch: 28 }, { wch: 28 }, { wch: 18 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 60 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 20 }, ...locs.map(() => ({ wch: 18 }))]

    const wb = XLSX.utils.book_new()

    // One sheet per vendor + one "All" sheet
    const vendorGroups = new Map<string, Product[]>()
    for (const p of serverProducts) {
      const v = p.vendor || 'No Vendor'
      vendorGroups.set(v, [...(vendorGroups.get(v) ?? []), p])
    }

    // All products sheet
    const allWs = XLSX.utils.json_to_sheet(serverProducts.map(makeRow))
    allWs['!cols'] = colWidths
    XLSX.utils.book_append_sheet(wb, allWs, 'All')

    // Per-vendor sheets
    for (const [vendor, prods] of vendorGroups) {
      const ws = XLSX.utils.json_to_sheet(prods.map(makeRow))
      ws['!cols'] = colWidths
      const sheetName = vendor.slice(0, 31) // Excel max 31 chars
      XLSX.utils.book_append_sheet(wb, ws, sheetName)
    }

    XLSX.writeFile(wb, 'products.xlsx')
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    try {
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf)
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws)

      const existingIds = new Set((serverProducts ?? []).map(p => p.id))
      let created = 0, updated = 0, skipped = 0

      for (const row of rows) {
        const name = row['Display Name']?.toString().trim()
        if (!name) { skipped++; continue }
        const sortRaw = row['Sort Order']?.toString().trim()
        const unitQtyRaw = row['ChefsCulinar Unit Qty']?.toString().trim()
        const tingstadQtyRaw = row['Tingstad Unit Qty']?.toString().trim()
        const fields = {
          name,
          vendor_name: row['Vendor Name (notifications)']?.toString().trim() || null,
          vendor: row['Vendor']?.toString().trim() ?? '',
          category: row['Category']?.toString().trim() ?? '',
          unit: row['Unit']?.toString().trim() ?? '',
          active: row['Active']?.toString().toUpperCase() !== 'FALSE',
          image_url: row['Image URL']?.toString().trim() || null,
          sort_order: sortRaw ? parseInt(sortRaw, 10) : 0,
          chefsculinar_id: row['ChefsCulinar ID']?.toString().trim() || null,
          chefsculinar_unit: row['ChefsCulinar Unit']?.toString().trim() || null,
          chefsculinar_unit_qty: unitQtyRaw ? parseFloat(unitQtyRaw) : null,
          tingstad_id: row['Tingstad ID']?.toString().trim() || null,
          tingstad_unit: row['Tingstad Unit']?.toString().trim() || null,
          tingstad_unit_qty: tingstadQtyRaw ? parseFloat(tingstadQtyRaw) : null,
        }
        const id = row['ID']?.toString().trim()
        let productId: string
        if (id && existingIds.has(id)) {
          await updateProduct.mutateAsync({ id, ...fields })
          productId = id
          updated++
        } else {
          const newProduct = await createProduct.mutateAsync(fields)
          productId = newProduct.id
          created++
        }

        // Apply location visibility from columns
        const locs = allLocations ?? []
        if (locs.length) {
          const hiddenIds = locs
            .filter(loc => row[loc.name]?.toString().toUpperCase() === 'HIDDEN')
            .map(loc => loc.id)
          await setProductLocations.mutateAsync({ productId, locationIds: hiddenIds })
        }
      }
      const parts = []
      if (created) parts.push(`${created} created`)
      if (updated) parts.push(`${updated} updated`)
      if (skipped) parts.push(`${skipped} skipped`)
      toast.success(`Import done: ${parts.join(', ')}`)
    } catch (err) {
      toast.error(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Products</h1>
          <p className="text-slate-400 text-sm mt-0.5">{products.length} products · drag to reorder</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleExport} title="Export to Excel"
            className="p-2.5 rounded-xl bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 transition-colors">
            <Download size={17} />
          </button>
          <button onClick={() => importRef.current?.click()} disabled={importing} title="Import from Excel"
            className="p-2.5 rounded-xl bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50 transition-colors">
            {importing ? <Spinner size={17} /> : <FileUp size={17} />}
          </button>
          <input ref={importRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
          <button onClick={() => setBatchModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl text-sm font-medium hover:bg-slate-200 transition-colors">
            <List size={17} /> Batch
          </button>
          <button onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 transition-colors">
            <Plus size={17} /> Add
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or vendor name…"
            className="w-full pl-8 pr-4 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
        {vendors && vendors.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-slate-400 shrink-0">Vendor</span>
            <TagBtn label="All" active={!filterVendor} onClick={() => setFilterVendor('')} />
            {vendors.map(v => <TagBtn key={v.id} label={v.name} active={filterVendor === v.name} onClick={() => setFilterVendor(filterVendor === v.name ? '' : v.name)} />)}
          </div>
        )}
        {categories && categories.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-slate-400 shrink-0">Category</span>
            <TagBtn label="All" active={!filterCategory} onClick={() => setFilterCategory('')} />
            {categories.map(c => <TagBtn key={c.id} label={c.name} active={filterCategory === c.name} onClick={() => setFilterCategory(filterCategory === c.name ? '' : c.name)} />)}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-slate-400 shrink-0">Status</span>
          {(['all', 'active', 'inactive'] as const).map(s => (
            <TagBtn key={s} label={s.charAt(0).toUpperCase() + s.slice(1)} active={filterStatus === s} onClick={() => setFilterStatus(s)} />
          ))}
        </div>
        {hasFilters && (
          <button onClick={() => { setSearch(''); setFilterVendor(''); setFilterCategory(''); setFilterStatus('all') }}
            className="text-xs text-indigo-600 hover:underline">Clear filters</button>
        )}
      </div>

      {/* Product list */}
      {isLoading ? (
        <div className="flex justify-center py-16"><Spinner size={32} /></div>
      ) : !products.length ? (
        <EmptyState icon={Package} title={hasFilters ? 'No products match filters' : 'No products yet'} description={hasFilters ? 'Try clearing filters' : "Click 'Add' to get started."} />
      ) : (() => {
          // Vendor counts for headers
          const vendorCounts = new Map<string, number>()
          for (const p of flatProducts) {
            const v = p.vendor || 'No Vendor'
            vendorCounts.set(v, (vendorCounts.get(v) ?? 0) + 1)
          }
          return (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
              <SortableContext items={flatProducts.map(p => p.id)} strategy={verticalListSortingStrategy}>
                <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  {flatProducts.map((p, idx) => {
                    const prevVendor = idx > 0 ? (flatProducts[idx - 1].vendor || 'No Vendor') : null
                    const thisVendor = p.vendor || 'No Vendor'
                    const showVendorHeader = thisVendor !== prevVendor
                    return (
                      <InlineEditRow
                        key={p.id}
                        product={p}
                        onDelete={handleDelete}
                        onDuplicate={handleDuplicate}
                        showVendorHeader={showVendorHeader}
                        vendorCount={showVendorHeader ? vendorCounts.get(thisVendor) : undefined}
                      />
                    )
                  })}
                </div>
              </SortableContext>
              <DragOverlay dropAnimation={null}>
                {draggingId ? (() => {
                  const p = flatProducts.find(x => x.id === draggingId)
                  if (!p) return null
                  return (
                    <div className="bg-white border border-indigo-200 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-3 opacity-95">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 overflow-hidden shrink-0">
                        {p.image_url
                          ? <img src={thumbUrl(p.image_url)} alt={p.name} className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center"><Package size={14} className="text-slate-300" /></div>}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{p.name}</p>
                        <p className="text-xs text-slate-400 truncate">{p.vendor}</p>
                      </div>
                    </div>
                  )
                })() : null}
              </DragOverlay>
            </DndContext>
          )
      })()}

      <BatchAddModal
        open={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        onSaved={() => setLocalOrder([])}
      />
      <ProductFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={() => setLocalOrder([])}
      />
    </div>
  )
}
