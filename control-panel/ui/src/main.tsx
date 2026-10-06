import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { Toaster } from '@/components/ui/sonner'
import { ActionsProvider } from '@/components/actions'
import { AppShell } from '@/components/AppShell'
import { Overview } from '@/pages/Overview'
import { Deployments } from '@/pages/Deployments'
import { DeploymentDetail } from '@/pages/DeploymentDetail'
import { Observability } from '@/pages/Observability'
import { LoadTests } from '@/pages/LoadTests'
import { Pipelines } from '@/pages/Pipelines'
import { Activity } from '@/pages/Activity'
import './index.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 1000 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ActionsProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Overview />} />
                <Route path="deployments" element={<Deployments />} />
                <Route path="deployments/:id" element={<DeploymentDetail />} />
                <Route path="observability" element={<Observability />} />
                <Route path="loadtests" element={<LoadTests />} />
                <Route path="pipelines" element={<Pipelines />} />
                <Route path="activity" element={<Activity />} />
              </Route>
            </Routes>
          </ActionsProvider>
        </BrowserRouter>
        <Toaster richColors position="bottom-right" closeButton />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
