import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { BrowserRouter } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
      <Toaster richColors position="bottom-right" />
    </ThemeProvider>
  </StrictMode>,
)
