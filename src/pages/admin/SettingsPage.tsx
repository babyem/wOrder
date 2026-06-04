import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, MapPin, Users, Pencil, Tag, Layers, Ruler, ChevronRight, Link2, GripVertical, Mail, Phone, X } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toSlug } from '../../lib/slug'
import {
  useAdminLocations, useAdminEmployees,
  useCreateLocation, useCreateEmployee, useUpdateEmployee, useDeleteEmployee, useDeleteLocation,
} from '../../hooks/useAdminData'
import {
  useVendors, useCreateVendor, useDeleteVendor, useReorderVendors, useUpdateVendor, useRenameVendor,
  useCategories, useCreateCategory, useDeleteCategory, useRenameCategory,
  useUnits, useCreateUnit, useDeleteUnit, useRenameUnit,
} from '../../hooks/useMetadata'
import Modal from '../../components/ui/Modal'
import Spinner from '../../components/ui/Spinner'
import toast from 'react-hot-toast'
import type { EmployeeWithLocations } from '../../types'

// ── Reusable tag-list section ────────────────────────────────────────────────

function MetaTag({ item, onDelete, onRename }: {
  item: { id: string; name: string }
  onDelete: () => void
  onRename?: (name: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(item.name)

  const save = async () => {
    const trimmed = val.trim()
    if (trimmed && trimmed !== item.name && onRename) {
      await onRename(trimmed)
    } else {
      setVal(item.name)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <span className="flex items-center pl-2 pr-1 py-1 bg-indigo-50 border border-indigo-200 rounded-xl">
        <input
          value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={save}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); save() }
            if (e.key === 'Escape') { setVal(item.name); setEditing(false) }
          }}
          className="text-sm bg-transparent outline-none text-indigo-700 w-24"
          autoFocus
        />
      </span>
    )
  }

  return (
    <span
      onDoubleClick={() => { setVal(item.name); setEditing(true) }}
      title="Double-click to rename"
      className="flex items-center gap-1.5 pl-3 pr-2 py-1.5 bg-slate-100 rounded-xl text-sm text-slate-700 cursor-default select-none"
    >
      {item.name}
      <button
        onClick={onDelete}
        className="w-4 h-4 rounded-full hover:bg-slate-300 flex items-center justify-center transition-colors text-slate-400 hover:text-red-500"
      >
        <Trash2 size={11} />
      </button>
    </span>
  )
}

interface MetaSectionProps {
  icon: React.ReactNode
  title: string
  items: { id: string; name: string }[] | undefined
  loading: boolean
  onAdd: (name: string) => Promise<void>
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => Promise<void>
  placeholder: string
}

function MetaSection({ icon, title, items, loading, onAdd, onDelete, onRename, placeholder }: MetaSectionProps) {
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  const handleAdd = async () => {
    const name = input.trim()
    if (!name) return
    setSaving(true)
    try { await onAdd(name); setInput('') }
    finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-50">
        <span className="text-slate-400">{icon}</span>
        <h2 className="font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="p-4 border-b border-slate-50">
        <div className="flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder={placeholder}
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button onClick={handleAdd} disabled={saving || !input.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center gap-1.5">
            {saving ? <Spinner size={14} className="border-white border-t-white/30" /> : <Plus size={15} />}
            Add
          </button>
        </div>
      </div>
      <div className="p-4">
        {loading ? <div className="flex justify-center py-4"><Spinner /></div>
          : !items?.length ? <p className="text-slate-400 text-sm text-center py-2">None yet.</p>
          : (
            <div className="flex flex-wrap gap-2">
              {items.map(item => (
                <MetaTag
                  key={item.id}
                  item={item}
                  onDelete={() => onDelete(item.id)}
                  onRename={name => onRename(item.id, name)}
                />
              ))}
            </div>
          )}
      </div>
    </div>
  )
}

// ── Vendor section (with reorder support) ────────────────────────────────────

function SortableVendorRow({ id, name, email, phone, hide_unit, use_chefsculinar, onDelete }: {
  id: string; name: string; email?: string; phone?: string; hide_unit?: boolean; use_chefsculinar?: boolean; onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  const updateVendor = useUpdateVendor()
  const renameVendor = useRenameVendor()

  const [editName, setEditName] = useState(false)
  const [nameVal, setNameVal] = useState(name)
  const [editEmail, setEditEmail] = useState(false)
  const [editPhone, setEditPhone] = useState(false)
  const [emailVal, setEmailVal] = useState(email ?? '')
  const [phoneVal, setPhoneVal] = useState(phone ?? '')

  const saveName = () => {
    const trimmed = nameVal.trim()
    if (trimmed && trimmed !== name) renameVendor.mutate({ id, name: trimmed })
    else setNameVal(name)
    setEditName(false)
  }

  const saveEmail = () => {
    if (emailVal.trim() !== (email ?? '')) updateVendor.mutate({ id, email: emailVal.trim() || undefined })
    setEditEmail(false)
  }
  const savePhone = () => {
    if (phoneVal.trim() !== (phone ?? '')) updateVendor.mutate({ id, phone: phoneVal.trim() || undefined })
    setEditPhone(false)
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-start gap-2 px-2 py-2 rounded-xl hover:bg-slate-50 group">
      <button {...attributes} {...listeners}
        className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing touch-none p-1 shrink-0 mt-0.5">
        <GripVertical size={15} />
      </button>
      <div className="flex-1 min-w-0">
        {editName ? (
          <input
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={saveName}
            onKeyDown={e => {
              if (e.key === 'Enter') saveName()
              if (e.key === 'Escape') { setNameVal(name); setEditName(false) }
            }}
            className="text-sm font-medium px-1 py-0.5 border border-indigo-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400 w-full"
            autoFocus
          />
        ) : (
          <span
            onDoubleClick={() => { setNameVal(name); setEditName(true) }}
            title="Double-click to rename"
            className="text-sm text-slate-700 font-medium cursor-default select-none"
          >{nameVal}</span>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
          {/* Email */}
          {editEmail ? (
            <input
              value={emailVal}
              onChange={e => setEmailVal(e.target.value)}
              onBlur={saveEmail}
              onKeyDown={e => { if (e.key === 'Enter') saveEmail(); if (e.key === 'Escape') { setEmailVal(email ?? ''); setEditEmail(false) } }}
              placeholder="vendor@email.com"
              className="text-xs px-2 py-0.5 border border-indigo-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400 w-44"
              autoFocus
            />
          ) : (
            <span className="flex items-center gap-0.5">
              <button onClick={() => setEditEmail(true)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600 transition-colors">
                <Mail size={10} />
                {email || <span className="italic">Add email</span>}
              </button>
              {email && (
                <button onClick={() => { updateVendor.mutate({ id, email: null }); setEmailVal('') }} className="text-slate-300 hover:text-red-500 transition-colors ml-0.5">
                  <X size={9} />
                </button>
              )}
            </span>
          )}
          {/* Phone */}
          {editPhone ? (
            <input
              value={phoneVal}
              onChange={e => setPhoneVal(e.target.value)}
              onBlur={savePhone}
              onKeyDown={e => { if (e.key === 'Enter') savePhone(); if (e.key === 'Escape') { setPhoneVal(phone ?? ''); setEditPhone(false) } }}
              placeholder="+46701234567"
              className="text-xs px-2 py-0.5 border border-indigo-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-400 w-36"
              autoFocus
            />
          ) : (
            <span className="flex items-center gap-0.5">
              <button onClick={() => setEditPhone(true)} className="flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600 transition-colors">
                <Phone size={10} />
                {phone || <span className="italic">Add phone</span>}
              </button>
              {phone && (
                <button onClick={() => { updateVendor.mutate({ id, phone: null }); setPhoneVal('') }} className="text-slate-300 hover:text-red-500 transition-colors ml-0.5">
                  <X size={9} />
                </button>
              )}
            </span>
          )}
          {/* Hide unit toggle */}
          <button
            onClick={() => updateVendor.mutate({ id, hide_unit: !hide_unit })}
            title={hide_unit ? 'Enheter döljs i meddelanden — klicka för att visa' : 'Klicka för att dölja enheter i meddelanden'}
            className={`flex items-center gap-1 text-xs transition-colors rounded px-1 ${hide_unit ? 'text-indigo-600 font-medium' : 'text-slate-300 hover:text-slate-500'}`}
          >
            <span className="tabular-nums">#</span>
            {hide_unit ? 'Antal only' : 'Antal only'}
          </button>
          {/* ChefsCulinar toggle */}
          <button
            onClick={() => updateVendor.mutate({ id, use_chefsculinar: use_chefsculinar === false ? true : false })}
            title={use_chefsculinar === false ? 'Blockerad från ChefsCulinar-webhook — klicka för att återställa' : 'Klicka för att blockera denna leverantör från ChefsCulinar-webhook'}
            className={`flex items-center gap-1 text-xs transition-colors rounded px-1 ${use_chefsculinar === false ? 'text-red-500 font-medium' : 'text-slate-300 hover:text-slate-500'}`}
          >
            🍴 {use_chefsculinar === false ? 'Blockerad' : 'ChefsCulinar'}
          </button>
        </div>
      </div>
      <button
        onClick={onDelete}
        className="p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100 shrink-0 mt-0.5"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function VendorSection() {
  const { data: vendors, isLoading } = useVendors()
  const createVendor = useCreateVendor()
  const deleteVendor = useDeleteVendor()
  const reorderVendors = useReorderVendors()
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleAdd = async () => {
    const name = input.trim()
    if (!name) return
    setSaving(true)
    try { await createVendor.mutateAsync(name); toast.success('Vendor added'); setInput('') }
    finally { setSaving(false) }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id || !vendors) return
    const ids = vendors.map(v => v.id)
    const newIds = arrayMove(ids, ids.indexOf(active.id as string), ids.indexOf(over.id as string))
    reorderVendors.mutate(newIds)
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-50">
        <span className="text-slate-400"><Tag size={18} /></span>
        <h2 className="font-semibold text-slate-900">Vendors</h2>
      </div>
      <div className="p-4 border-b border-slate-50">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="e.g. Beverages Co."
            className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleAdd}
            disabled={saving || !input.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center gap-1.5"
          >
            {saving ? <Spinner size={14} className="border-white border-t-white/30" /> : <Plus size={15} />}
            Add
          </button>
        </div>
      </div>
      <div className="p-4">
        {isLoading ? <div className="flex justify-center py-4"><Spinner /></div>
          : !vendors?.length ? <p className="text-slate-400 text-sm text-center py-2">None yet.</p>
          : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={vendors.map(v => v.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-0.5">
                  {vendors.map(v => (
                    <SortableVendorRow
                      key={v.id}
                      id={v.id}
                      name={v.name}
                      email={v.email}
                      phone={v.phone}
                      hide_unit={v.hide_unit}
                      use_chefsculinar={v.use_chefsculinar}
                      onDelete={async () => {
                        try { await deleteVendor.mutateAsync(v.id) }
                        catch { toast.error('Delete failed — vendor may be in use') }
                      }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: locations, isLoading: loadingLocs } = useAdminLocations()
  const { data: employees, isLoading: loadingEmps } = useAdminEmployees()
  const { data: categories, isLoading: loadingCats } = useCategories()
  const { data: units, isLoading: loadingUnits } = useUnits()

  const createLocation = useCreateLocation()
  const deleteLocation = useDeleteLocation()
  const createEmployee = useCreateEmployee()
  const updateEmployee = useUpdateEmployee()
  const deleteEmployee = useDeleteEmployee()
  const createCategory = useCreateCategory()
  const deleteCategory = useDeleteCategory()
  const renameCategory = useRenameCategory()
  const createUnit = useCreateUnit()
  const deleteUnit = useDeleteUnit()
  const renameUnit = useRenameUnit()

  const [locModal, setLocModal] = useState(false)
  const [empModal, setEmpModal] = useState(false)
  const [editingEmp, setEditingEmp] = useState<EmployeeWithLocations | null>(null)
  const [locName, setLocName] = useState('')
  const [empForm, setEmpForm] = useState({ name: '', location_ids: [] as string[], active: true })

  const handleCreateLocation = async () => {
    if (!locName.trim()) return
    try { await createLocation.mutateAsync(locName.trim()); toast.success('Location created'); setLocName(''); setLocModal(false) }
    catch { toast.error('Failed to create location') }
  }

  const openAddEmployee = () => {
    setEditingEmp(null)
    setEmpForm({ name: '', location_ids: [], active: true })
    setEmpModal(true)
  }

  const openEditEmployee = (emp: EmployeeWithLocations) => {
    setEditingEmp(emp)
    setEmpForm({
      name: emp.name,
      location_ids: emp.employee_locations.map(el => el.location_id),
      active: emp.active,
    })
    setEmpModal(true)
  }

  const handleSaveEmployee = async () => {
    if (!empForm.name.trim()) { toast.error('Name is required'); return }
    if (empForm.location_ids.length === 0) { toast.error('Select at least one location'); return }
    try {
      if (editingEmp) {
        await updateEmployee.mutateAsync({ id: editingEmp.id, name: empForm.name, location_ids: empForm.location_ids, active: empForm.active })
        toast.success('Employee updated')
      } else {
        await createEmployee.mutateAsync({ name: empForm.name, location_ids: empForm.location_ids, active: empForm.active })
        toast.success('Employee added')
      }
      setEmpModal(false)
    } catch { toast.error('Failed to save employee') }
  }

  const handleDeleteMeta = async (fn: (id: string) => Promise<unknown>, id: string) => {
    try { await fn(id) }
    catch { toast.error('Delete failed — item may be in use') }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-400 text-sm mt-1">Manage locations, employees, and product options</p>
      </div>

      {/* Locations */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50">
          <div className="flex items-center gap-2"><MapPin size={18} className="text-slate-400" /><h2 className="font-semibold text-slate-900">Locations</h2></div>
          <button onClick={() => setLocModal(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"><Plus size={14} /> Add</button>
        </div>
        <div className="divide-y divide-slate-50">
          {loadingLocs ? <div className="flex justify-center py-8"><Spinner /></div>
            : locations?.map(loc => (
              <div key={loc.id} className="flex items-center justify-between px-5 py-3">
                <Link to={`/admin/locations/${loc.id}`}
                  className="flex items-center gap-1.5 text-sm font-medium text-slate-700 hover:text-indigo-600 transition-colors group flex-1 min-w-0">
                  {loc.name}
                  <ChevronRight size={14} className="text-slate-300 group-hover:text-indigo-400 transition-colors shrink-0" />
                </Link>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/order/${toSlug(loc.name)}`)
                      toast.success('Order link copied!')
                    }}
                    title="Copy order page link"
                    className="p-1.5 rounded-lg text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 transition-colors"
                  >
                    <Link2 size={15} />
                  </button>
                  <button onClick={async () => { if (!confirm(`Delete "${loc.name}"?`)) return; try { await deleteLocation.mutateAsync(loc.id); toast.success('Deleted') } catch { toast.error('Failed') } }}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          {!loadingLocs && !locations?.length && <div className="px-5 py-6 text-center text-slate-400 text-sm">No locations yet.</div>}
        </div>
      </div>

      {/* Employees */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50">
          <div className="flex items-center gap-2"><Users size={18} className="text-slate-400" /><h2 className="font-semibold text-slate-900">Employees</h2></div>
          <button onClick={openAddEmployee} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"><Plus size={14} /> Add</button>
        </div>
        <div className="divide-y divide-slate-50">
          {loadingEmps ? <div className="flex justify-center py-8"><Spinner /></div>
            : employees?.map(emp => (
              <div key={emp.id} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-700">{emp.name}</p>
                  <p className="text-xs text-slate-400">
                    {emp.employee_locations.map(el => el.location?.name).filter(Boolean).join(', ') || '—'}
                    {' · '}{emp.active ? 'Active' : 'Inactive'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => openEditEmployee(emp)} className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"><Pencil size={15} /></button>
                  <button onClick={async () => { if (!confirm(`Remove ${emp.name}?`)) return; try { await deleteEmployee.mutateAsync(emp.id); toast.success('Removed') } catch { toast.error('Failed') } }}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          {!loadingEmps && !employees?.length && <div className="px-5 py-6 text-center text-slate-400 text-sm">No employees yet.</div>}
        </div>
      </div>

      {/* Vendors */}
      <VendorSection />

      {/* Categories */}
      <MetaSection icon={<Layers size={18} />} title="Categories" items={categories} loading={loadingCats}
        placeholder="e.g. Dry Goods"
        onAdd={async name => { await createCategory.mutateAsync(name); toast.success('Category added') }}
        onDelete={id => handleDeleteMeta(deleteCategory.mutateAsync, id)}
        onRename={async (id, name) => { await renameCategory.mutateAsync({ id, name }); toast.success('Renamed') }} />

      {/* Units */}
      <MetaSection icon={<Ruler size={18} />} title="Units" items={units} loading={loadingUnits}
        placeholder="e.g. kg"
        onAdd={async name => { await createUnit.mutateAsync(name); toast.success('Unit added') }}
        onDelete={id => handleDeleteMeta(deleteUnit.mutateAsync, id)}
        onRename={async (id, name) => { await renameUnit.mutateAsync({ id, name }); toast.success('Renamed') }} />

      {/* Modals */}
      <Modal open={locModal} onClose={() => setLocModal(false)} title="Add Location">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Location Name</label>
            <input value={locName} onChange={e => setLocName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateLocation()}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. Downtown" autoFocus />
          </div>
          <button onClick={handleCreateLocation} disabled={createLocation.isPending}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {createLocation.isPending && <Spinner size={18} className="border-white border-t-white/30" />} Add Location
          </button>
        </div>
      </Modal>

      <Modal open={empModal} onClose={() => setEmpModal(false)} title={editingEmp ? 'Edit Employee' : 'Add Employee'}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Name</label>
            <input value={empForm.name} onChange={e => setEmpForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Employee name" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-2">Locations</label>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {locations?.map(l => {
                const checked = empForm.location_ids.includes(l.id)
                return (
                  <label key={l.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors ${checked ? 'bg-indigo-50 border border-indigo-200' : 'border border-slate-100 hover:bg-slate-50'}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => setEmpForm(f => ({
                        ...f,
                        location_ids: e.target.checked
                          ? [...f.location_ids, l.id]
                          : f.location_ids.filter(id => id !== l.id),
                      }))}
                      className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 accent-indigo-600"
                    />
                    <span className={`text-sm font-medium ${checked ? 'text-indigo-700' : 'text-slate-700'}`}>{l.name}</span>
                  </label>
                )
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setEmpForm(f => ({ ...f, active: !f.active }))}
              className={`relative w-10 h-6 rounded-full transition-colors ${empForm.active ? 'bg-indigo-600' : 'bg-slate-200'}`}>
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${empForm.active ? 'translate-x-5' : 'translate-x-1'}`} />
            </button>
            <span className="text-sm text-slate-600">Active</span>
          </div>
          <button onClick={handleSaveEmployee} disabled={createEmployee.isPending || updateEmployee.isPending}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
            {(createEmployee.isPending || updateEmployee.isPending) && <Spinner size={18} className="border-white border-t-white/30" />}
            {editingEmp ? 'Save Changes' : 'Add Employee'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
