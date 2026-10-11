// The user pool's password policy (cognito.tf), checked as the person types. Cognito checks it again.
export const PASSWORD_RULES: { label: string; ok: (p: string) => boolean }[] = [
  { label: '12+ characters', ok: (p) => p.length >= 12 },
  { label: 'upper and lower case', ok: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { label: 'a number', ok: (p) => /\d/.test(p) },
  { label: 'a symbol', ok: (p) => /[^A-Za-z0-9]/.test(p) },
]
export const passwordOk = (p: string) => PASSWORD_RULES.every((r) => r.ok(p))
