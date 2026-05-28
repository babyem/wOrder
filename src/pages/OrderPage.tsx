import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChefHat, Bell, MapPin, X, ChevronDown, LayoutDashboard } from 'lucide-react'
import LocationSelector from '../components/employee/LocationSelector'
import EmployeeSelector from '../components/employee/EmployeeSelector'
import ProductGrid from '../components/employee/ProductGrid'
import CartBar from '../components/employee/CartBar'
import OrderModal from '../components/employee/OrderModal'
import LocationOrders from '../components/employee/LocationOrders'
import { useLocationAlarms } from '../hooks/useLocationAlarms'
import { useAdminLocations } from '../hooks/useAdminData'
import { toSlug } from '../lib/slug'
import type { LocationAlarm } from '../hooks/useLocationAlarms'

// ── Alarm sound (Web Audio API) ───────────────────────────────────────────────

function useAlarmSound(playing: boolean) {
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!playing) {
      stopRef.current?.()
      stopRef.current = null
      return
    }

    let active = true
    let ctx: AudioContext | null = null

    const start = () => {
      ctx = new AudioContext()

      const beep = () => {
        if (!active || !ctx) return
        // Two-tone beep: high then low
        const tones = [880, 660]
        tones.forEach((freq, i) => {
          const osc = ctx!.createOscillator()
          const gain = ctx!.createGain()
          osc.connect(gain)
          gain.connect(ctx!.destination)
          osc.type = 'sine'
          osc.frequency.value = freq
          const t = ctx!.currentTime + i * 0.18
          gain.gain.setValueAtTime(0, t)
          gain.gain.linearRampToValueAtTime(0.35, t + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16)
          osc.start(t)
          osc.stop(t + 0.16)
        })
        setTimeout(() => { if (active) beep() }, 1200)
      }

      beep()
    }

    start()
    stopRef.current = () => { active = false; ctx?.close() }
    return () => { active = false; ctx?.close() }
  }, [playing])
}

// ── Alarm modal ───────────────────────────────────────────────────────────────

function AlarmModal({ locationId }: { locationId: string }) {
  const { data: alarms } = useLocationAlarms(locationId)
  const [active, setActive] = useState<LocationAlarm | null>(null)
  const fired = useRef(new Set<string>())

  useAlarmSound(!!active)

  useEffect(() => {
    if (!alarms) return

    const check = () => {
      const now = new Date()
      const day = now.getDay()
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const minuteKey = `${now.toDateString()}-${currentTime}`

      for (const alarm of alarms) {
        if (!alarm.active || !alarm.days.includes(day) || alarm.time !== currentTime) continue
        const key = `${alarm.id}-${minuteKey}`
        if (!fired.current.has(key)) {
          fired.current.add(key)
          setActive(alarm)
          return
        }
      }
    }

    check()
    const id = setInterval(check, 15_000)
    return () => clearInterval(id)
  }, [alarms])

  const dismiss = () => setActive(null)

  return (
    <AnimatePresence>
      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Modal */}
          <motion.div
            className="relative bg-white rounded-3xl p-8 w-full max-w-sm shadow-2xl text-center space-y-6"
            initial={{ opacity: 0, scale: 0.8, y: 32 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', damping: 18, stiffness: 280 } }}
            exit={{ opacity: 0, scale: 0.9, y: 16, transition: { duration: 0.2 } }}
          >
            <button
              onClick={dismiss}
              className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-300 hover:text-slate-500 hover:bg-slate-100 transition-colors"
            >
              <X size={16} />
            </button>

            {/* Animated bell */}
            <div className="relative flex items-center justify-center mx-auto w-24 h-24">
              {/* Pulse rings */}
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="absolute inset-0 rounded-full bg-amber-300/40"
                  animate={{ scale: [1, 1.8], opacity: [0.6, 0] }}
                  transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.45, ease: 'easeOut' }}
                />
              ))}
              <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center relative z-10">
                <motion.div
                  animate={{ rotate: [0, -18, 18, -14, 14, -8, 8, 0] }}
                  transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 0.8 }}
                >
                  <Bell size={36} className="text-amber-500" />
                </motion.div>
              </div>
            </div>

            <div>
              <motion.h2
                className="text-2xl font-bold text-slate-900"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { delay: 0.15 } }}
              >
                {active.label}
              </motion.h2>
              <motion.p
                className="text-slate-400 text-sm mt-1.5"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.25 } }}
              >
                Time to place your supply order
              </motion.p>
            </div>

            <motion.div
              className="flex gap-3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.3 } }}
            >
              <button
                onClick={dismiss}
                className="flex-1 py-3.5 rounded-2xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50 active:scale-95 transition-all"
              >
                No order today
              </button>
              <button
                onClick={dismiss}
                className="flex-1 py-3.5 rounded-2xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 active:scale-95 transition-all"
              >
                Order Now
              </button>
            </motion.div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const LS_LOCATION = 'order_location_id'
const LS_EMPLOYEE = 'order_employee_id'

export default function OrderPage() {
  const { slug } = useParams<{ slug?: string }>()
  const { data: locations } = useAdminLocations()

  // Resolve locationId from slug or localStorage
  const fixedLocation = !!slug
  const resolvedId = slug
    ? (locations?.find(l => toSlug(l.name) === slug)?.id ?? '')
    : (localStorage.getItem(LS_LOCATION) ?? '')

  const [locationId, setLocationId] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [showLocationPicker, setShowLocationPicker] = useState(false)

  // Set locationId once locations load (needed for slug-based pages)
  useEffect(() => {
    if (resolvedId) setLocationId(resolvedId)
  }, [resolvedId])

  useEffect(() => {
    if (locationId && !fixedLocation) localStorage.setItem(LS_LOCATION, locationId)
  }, [locationId, fixedLocation])

  useEffect(() => {
    if (employeeId) localStorage.setItem(LS_EMPLOYEE, employeeId)
  }, [employeeId])

  const handleLocationChange = (id: string) => {
    setLocationId(id)
    setEmployeeId('')
    localStorage.removeItem(LS_EMPLOYEE)
  }

  const locationName = locations?.find(l => l.id === locationId)?.name
  const ready = locationId && employeeId

  return (
    <div className="min-h-screen bg-slate-50">
      {locationId && <AlarmModal locationId={locationId} />}

      {/* Scroll gradient fades */}
      <div className="fixed top-[69px] left-0 right-0 h-10 bg-gradient-to-b from-slate-50 to-transparent pointer-events-none z-20" />
      <div className="fixed bottom-0 left-0 right-0 h-28 bg-gradient-to-t from-slate-50 to-transparent pointer-events-none z-20" />

      <header className="bg-white border-b border-slate-100 sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center shrink-0">
            <ChefHat size={20} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-slate-900 leading-tight">Staff Orders</h1>
            {locationId && locationName ? (
              <button
                onClick={() => setShowLocationPicker(true)}
                className="text-xs text-indigo-500 flex items-center gap-1 hover:text-indigo-700 transition-colors"
              >
                <MapPin size={10} /> {locationName} <ChevronDown size={10} />
              </button>
            ) : (
              <p className="text-xs text-slate-400">Internal supply ordering</p>
            )}
          </div>
          <Link
            to="/admin"
            title="Backoffice"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 transition-colors shrink-0"
          >
            <LayoutDashboard size={14} />
            <span className="hidden sm:inline">Backoffice</span>
          </Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        <AnimatePresence>
          {locationId && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <LocationOrders locationId={locationId} />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-5">
          {!fixedLocation && (
            <LocationSelector selected={locationId} onSelect={handleLocationChange} />
          )}
          <AnimatePresence>
            {locationId && (
              <motion.div
                initial={fixedLocation ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className={fixedLocation ? '' : 'border-t border-slate-100 pt-5'}>
                  <EmployeeSelector
                    locationId={locationId}
                    selected={employeeId}
                    onSelect={setEmployeeId}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {ready ? (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
            >
              <ProductGrid locationId={locationId} />
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-16 text-slate-400 text-sm"
            >
              {!locationId ? 'Select your location to get started' : 'Select your name to continue'}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="h-24" />
      </main>

      {ready && (
        <>
          <CartBar onOpen={() => setCartOpen(true)} />
          <OrderModal
            open={cartOpen}
            onClose={() => setCartOpen(false)}
            locationId={locationId}
            employeeId={employeeId}
          />
        </>
      )}

      {/* Location picker bottom sheet */}
      <AnimatePresence>
        {showLocationPicker && (
          <div className="fixed inset-0 z-50 flex items-end justify-center">
            <motion.div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLocationPicker(false)}
            />
            <motion.div
              className="relative bg-white rounded-t-3xl p-6 w-full max-w-lg shadow-2xl"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            >
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-semibold text-slate-900">Change Location</h2>
                <button onClick={() => setShowLocationPicker(false)} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                  <X size={16} />
                </button>
              </div>
              <LocationSelector
                selected={locationId}
                onSelect={id => { handleLocationChange(id); setShowLocationPicker(false) }}
              />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
