import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '@/auth'

// Pages that need a signed-in user send visitors to the login form and bring them back afterwards.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'loading') return null
  if (status === 'anonymous') return <Navigate replace to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} />
  return children
}
