import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { refreshSession, session, setAccessToken, setSignedOutHandler, type Me } from '@/api'

type AuthState = {
  status: 'loading' | 'anonymous' | 'signedIn'
  user: Me | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading')
  const [user, setUser] = useState<Me | null>(null)

  const load = useCallback(async () => {
    try {
      setUser(await session.me())
      setStatus('signedIn')
    } catch {
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  // On page load there is no token in memory: ask for one with the refresh cookie.
  useEffect(() => {
    setSignedOutHandler(() => {
      setUser(null)
      setStatus('anonymous')
    })
    void (async () => {
      if (await refreshSession()) await load()
      else setStatus('anonymous')
    })()
  }, [load])

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      login: async (username, password) => {
        await session.login(username, password)
        await load()
      },
      logout: async () => {
        await session.logout()
        setAccessToken(null)
        setUser(null)
        setStatus('anonymous')
      },
    }),
    [status, user, load],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
