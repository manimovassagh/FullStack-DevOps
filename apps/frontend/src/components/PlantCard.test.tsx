import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { PlantSummary } from '@/types'
import { PlantCard } from './PlantCard'

const plant = (over: Partial<PlantSummary> = {}): PlantSummary => ({
  id: 'p1',
  name: 'Monstera',
  species: 'Monstera deliciosa',
  location: 'Window',
  notes: '',
  water_every_days: 7,
  last_watered_on: '2026-09-16',
  next_water_on: '2026-09-23',
  days_until_water: 0,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  cover_media_id: null,
  media_count: 0,
  ...over,
})

const renderCard = (p: PlantSummary, onWater = vi.fn().mockResolvedValue(undefined)) => {
  render(
    <MemoryRouter>
      <PlantCard plant={p} onWater={onWater} />
    </MemoryRouter>,
  )
  return onWater
}

describe('PlantCard', () => {
  it('shows the name, details and water status', () => {
    renderCard(plant())
    expect(screen.getByRole('link', { name: 'Monstera' })).toHaveAttribute('href', '/plants/p1')
    expect(screen.getByText('Monstera deliciosa · Window')).toBeInTheDocument()
    expect(screen.getByText('Water today')).toBeInTheDocument()
  })

  it('calls onWater with the plant id', async () => {
    const onWater = renderCard(plant())
    await userEvent.click(screen.getByRole('button', { name: 'Water Monstera' }))
    expect(onWater).toHaveBeenCalledWith('p1')
  })

  it('renders the cover photo only when there is one', () => {
    renderCard(plant({ cover_media_id: 'm1', media_count: 2 }))
    expect(screen.getByRole('img', { name: 'Monstera' })).toHaveAttribute('src', '/api/media/m1')
  })

  it('renders a placeholder without a cover photo', () => {
    renderCard(plant())
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
