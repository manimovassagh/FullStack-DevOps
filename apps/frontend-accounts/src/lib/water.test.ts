import { describe, expect, it } from 'vitest'
import { waterStatus } from './water'

describe('waterStatus', () => {
  it.each([
    [-3, { tone: 'overdue', label: '3d overdue' }],
    [-1, { tone: 'overdue', label: '1d overdue' }],
    [0, { tone: 'today', label: 'Water today' }],
    [1, { tone: 'soon', label: 'Tomorrow' }],
    [2, { tone: 'soon', label: 'In 2 days' }],
    [5, { tone: 'ok', label: 'In 5 days' }],
  ])('%i days → %o', (days, expected) => {
    expect(waterStatus(days)).toEqual(expected)
  })
})
