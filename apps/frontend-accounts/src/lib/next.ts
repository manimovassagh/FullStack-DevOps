// Only local paths: never send someone off to another site after signing in.
export function safeNext(raw: string | null): string {
  return raw?.startsWith('/') && !raw.startsWith('//') ? raw : '/'
}
