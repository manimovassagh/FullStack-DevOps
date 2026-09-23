// Must match the backend's inline list: only these are safe to render as <img>.
export const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

export function isInlineImage(contentType: string): boolean {
  return INLINE_IMAGE_TYPES.has(contentType)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// Parse "YYYY-MM-DD" as a *local* date (new Date("2026-09-20") would be UTC midnight
// and can show as the previous day in western time zones).
export function parseDate(s: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s)
}

export function formatDate(s: string): string {
  return parseDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function todayISO(): string {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}
