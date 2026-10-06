import { Link, Route, Routes } from 'react-router'
import { Layout } from '@/components/Layout'
import { useAuth } from '@/auth'
import { Button } from '@/components/ui/button'
import { RequireAuth } from '@/components/RequireAuth'
import { HomePage } from '@/pages/HomePage'
import { LoginPage } from '@/pages/LoginPage'
import { PlantPage } from '@/pages/PlantPage'

export default function App() {
  const { status } = useAuth()
  if (status === 'loading') return <div className="grid min-h-svh place-items-center text-muted-foreground">Loading…</div>
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="plants/:id" element={<RequireAuth><PlantPage /></RequireAuth>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

function NotFound() {
  return (
    <div className="grid place-items-center gap-4 py-24 text-center">
      <p className="text-6xl">🥀</p>
      <h1 className="font-heading text-3xl font-semibold">This page wilted</h1>
      <Button asChild>
        <Link to="/">Back to the garden</Link>
      </Button>
    </div>
  )
}
