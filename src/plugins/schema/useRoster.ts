import { useQuery } from '@tanstack/react-query'
import { schemaSupabase } from './schemaClient'

export type ShiftTone = 'neutral' | 'brand' | 'info' | 'accent' | 'warning' | 'success' | 'danger'

export interface RosterRow {
  id: string
  name: string
  start: string // "10:00"
  end: string
  tone: ShiftTone
}

export interface RosterGroup {
  restaurantId: string
  restaurantName: string
  rows: RosterRow[]
}

interface ShiftTypeRule {
  tone: ShiftTone
  start_from: string | null
  start_to: string | null
  end_from: string | null
  end_to: string | null
  sort_order: number
  is_active: boolean
}

// Samma fallback som Schema-appen (src/lib/shiftTypes.ts) om shift_types är tom.
const DEFAULT_RULES: ShiftTypeRule[] = [
  { tone: 'warning', start_from: '09:00', start_to: '11:30', end_from: '13:00', end_to: '15:00', sort_order: 10, is_active: true },
  { tone: 'accent', start_from: '12:00', start_to: '16:00', end_from: '18:00', end_to: '20:00', sort_order: 20, is_active: true },
  { tone: 'info', start_from: null, start_to: null, end_from: '18:00', end_to: null, sort_order: 30, is_active: true },
]

const toMinutes = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

const inWindow = (v: number, from: string | null, to: string | null) =>
  (from === null || v >= toMinutes(from)) && (to === null || v <= toMinutes(to))

// Första aktiva regeln i sorteringsordning som matchar — samma logik som Schemas classifyShift.
function classify(start: string, end: string, rules: ShiftTypeRule[]): ShiftTone {
  const s = toMinutes(start)
  const e = toMinutes(end)
  const hit = rules
    .filter(r => r.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .find(r => inWindow(s, r.start_from, r.start_to) && inWindow(e, r.end_from, r.end_to))
  return hit?.tone ?? 'neutral'
}

export function stockholmDate(daysAhead: number): string {
  const s = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (!daysAhead) return s
  const [y, m, d] = s.split('-').map(Number)
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.UTC(y, m - 1, d + daysAhead)))
}

/** Vem som jobbar ett visst datum, per restaurang — läses från Schema-appens databas. */
export function useRoster(date: string) {
  return useQuery({
    queryKey: ['schema-roster', date],
    enabled: schemaSupabase !== null,
    queryFn: async (): Promise<RosterGroup[]> => {
      const db = schemaSupabase!
      const [shifts, restaurants, types] = await Promise.all([
        db.from('shifts').select('id, employee_id, restaurant_id, start_time, end_time, employees(name)').eq('date', date).not('employee_id', 'is', null),
        db.from('restaurants').select('id, name, sort_order').order('sort_order'),
        db.from('shift_types').select('tone, start_from, start_to, end_from, end_to, sort_order, is_active'),
      ])
      if (shifts.error) throw shifts.error
      if (restaurants.error) throw restaurants.error
      const rules: ShiftTypeRule[] = !types.error && types.data?.length ? types.data : DEFAULT_RULES

      const byRestaurant = new Map<string, RosterRow[]>()
      for (const s of shifts.data ?? []) {
        const emp = Array.isArray(s.employees) ? s.employees[0] : s.employees
        if (!emp?.name) continue
        const start = String(s.start_time).slice(0, 5)
        const end = String(s.end_time).slice(0, 5)
        const rows = byRestaurant.get(s.restaurant_id) ?? []
        rows.push({ id: s.id, name: emp.name, start, end, tone: classify(start, end, rules) })
        byRestaurant.set(s.restaurant_id, rows)
      }

      const minutes = (r: RosterRow) => toMinutes(r.end) - toMinutes(r.start)
      return (restaurants.data ?? [])
        .map(r => ({
          restaurantId: r.id,
          restaurantName: r.name,
          // Flest timmar överst, sedan namn — som i Schema-appen.
          rows: (byRestaurant.get(r.id) ?? []).sort((a, b) => minutes(b) - minutes(a) || a.name.localeCompare(b.name, 'sv')),
        }))
        .filter(g => g.rows.length > 0)
    },
    refetchInterval: 5 * 60_000,
  })
}
