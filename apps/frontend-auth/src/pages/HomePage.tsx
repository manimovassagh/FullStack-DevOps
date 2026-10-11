import { useAuth } from '@/auth'
import { GardenPage } from '@/pages/GardenPage'
import { WelcomePage } from '@/pages/WelcomePage'

// "/" is public: visitors get the welcome page, signed-in users their garden.
export function HomePage() {
  const { status } = useAuth()
  if (status === 'loading') return null
  return status === 'signedIn' ? <GardenPage /> : <WelcomePage />
}
