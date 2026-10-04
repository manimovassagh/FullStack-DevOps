// How urgently a plant needs water, derived from the server's days_until_water.
// The tone drives the badge colour: overdue=red, today=amber, soon=sky, ok=emerald.
export type WaterTone = 'overdue' | 'today' | 'soon' | 'ok'

export interface WaterStatus {
  tone: WaterTone
  label: string
}

/**
 * Turn "days until the next watering" into a badge tone + label.
 *   daysUntil < 0  → the plant is overdue by -daysUntil days
 *   daysUntil = 0  → water today
 *   daysUntil > 0  → upcoming
 */
export function waterStatus(daysUntil: number): WaterStatus {
  if (daysUntil < 0) return { tone: 'overdue', label: `${-daysUntil}d overdue` }
  if (daysUntil === 0) return { tone: 'today', label: 'Water today' }
  if (daysUntil === 1) return { tone: 'soon', label: 'Tomorrow' }
  if (daysUntil <= 2) return { tone: 'soon', label: `In ${daysUntil} days` }
  return { tone: 'ok', label: `In ${daysUntil} days` }
}
