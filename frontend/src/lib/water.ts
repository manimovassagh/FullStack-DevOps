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
  // TODO(you): implement — see water.test.ts for the exact expected labels.
  throw new Error(`waterStatus not implemented (daysUntil=${daysUntil})`)
}
