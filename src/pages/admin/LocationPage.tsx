import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Bell } from 'lucide-react'
import { useAdminLocations } from '../../hooks/useAdminData'
import {
  useLocationAlarms, useCreateAlarm, useUpdateAlarm, useDeleteAlarm,
} from '../../hooks/useLocationAlarms'
import type { LocationAlarm } from '../../hooks/useLocationAlarms'
import Spinner from '../../components/ui/Spinner'
import toast from 'react-hot-toast'

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_FULL   = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function AlarmRow({ alarm, locationId }: { alarm: LocationAlarm; locationId: string }) {
  const updateAlarm = useUpdateAlarm()
  const deleteAlarm = useDeleteAlarm()
  const [label, setLabel] = useState(alarm.label)
  const [time, setTime]   = useState(alarm.time)

  useEffect(() => { setLabel(alarm.label) }, [alarm.label])
  useEffect(() => { setTime(alarm.time) },   [alarm.time])

  const save = (updates: Partial<LocationAlarm>) =>
    updateAlarm.mutate({ id: alarm.id, ...updates })

  const toggleDay = (day: number) => {
    const days = alarm.days.includes(day)
      ? alarm.days.filter(d => d !== day)
      : [...alarm.days, day].sort((a, b) => a - b)
    save({ days })
  }

  return (
    <div className="flex items-center gap-3 px-5 py-3 flex-wrap">
      {/* Time */}
      <input
        type="time"
        value={time}
        onChange={e => setTime(e.target.value)}
        onBlur={() => { if (time !== alarm.time) save({ time }) }}
        className="px-2.5 py-1.5 rounded-xl border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
      />

      {/* Day toggles */}
      <div className="flex gap-1">
        {DAY_LABELS.map((d, i) => (
          <button
            key={i}
            onClick={() => toggleDay(i)}
            title={DAY_FULL[i]}
            className={`w-7 h-7 rounded-lg text-xs font-semibold transition-all ${
              alarm.days.includes(i)
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
            }`}
          >
            {d}
          </button>
        ))}
      </div>

      {/* Label */}
      <input
        value={label}
        onChange={e => setLabel(e.target.value)}
        onBlur={() => { const v = label.trim(); if (v !== alarm.label) save({ label: v || 'Alarm' }) }}
        onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        placeholder="Label"
        className="flex-1 min-w-[120px] px-3 py-1.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
      />

      {/* Active toggle */}
      <button
        onClick={() => save({ active: !alarm.active })}
        className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${alarm.active ? 'bg-indigo-600' : 'bg-slate-200'}`}
      >
        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${alarm.active ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>

      {/* Delete */}
      <button
        onClick={async () => {
          try { await deleteAlarm.mutateAsync({ id: alarm.id, locationId }) }
          catch { toast.error('Delete failed') }
        }}
        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
      >
        <Trash2 size={15} />
      </button>
    </div>
  )
}

export default function LocationPage() {
  const { locationId } = useParams<{ locationId: string }>()
  const navigate = useNavigate()
  const { data: locations } = useAdminLocations()
  const { data: alarms, isLoading } = useLocationAlarms(locationId!)
  const createAlarm = useCreateAlarm()

  const location = locations?.find(l => l.id === locationId)

  const handleAdd = async () => {
    if (!locationId) return
    try {
      await createAlarm.mutateAsync({
        location_id: locationId,
        label: 'Alarm',
        time: '09:00',
        days: [1, 2, 3, 4, 5],
        active: true,
      })
    } catch { toast.error('Failed to add alarm') }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/admin/settings')}
          className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-white transition-all"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{location?.name ?? '…'}</h1>
          <p className="text-slate-400 text-sm mt-0.5">Alarms &amp; schedules</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-50">
          <div className="flex items-center gap-2">
            <Bell size={18} className="text-slate-400" />
            <h2 className="font-semibold text-slate-900">Alarms</h2>
          </div>
          <button
            onClick={handleAdd}
            disabled={createAlarm.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            <Plus size={14} /> Add Alarm
          </button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : !alarms?.length ? (
          <p className="px-5 py-10 text-center text-slate-400 text-sm">
            No alarms yet — click Add Alarm to get started.
          </p>
        ) : (
          <div className="divide-y divide-slate-50">
            {alarms.map(alarm => (
              <AlarmRow key={alarm.id} alarm={alarm} locationId={locationId!} />
            ))}
          </div>
        )}
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-2xl px-5 py-4 text-sm text-amber-700">
        <p className="font-medium mb-1">How alarms work</p>
        <p className="text-amber-600 text-xs">Alarms fire as a notification banner while the admin panel is open. Set the time in 24h format and pick which days it should repeat.</p>
      </div>
    </div>
  )
}
