// A 1×1 PNG so an uploaded photo really renders in the timeline.
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

// Stages with sign-in set these; stages without leave them empty and the app opens straight to the garden.
export const login = {
  user: process.env.SMOKE_LOGIN_USER,
  password: process.env.SMOKE_LOGIN_PASSWORD ?? '',
}
