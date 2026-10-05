// A load test that behaves like real Plant Parent users: sign in (on stages with Cognito), look at the
// garden, add a plant, open it, water it, delete it. Metrics stream live to Prometheus → Grafana.
//
//   make -C loadtest load STAGE=ecs-cognito        (see the Makefile for profiles and stages)
import http from 'k6/http'
import { check, group, sleep } from 'k6'
import { Counter } from 'k6/metrics'

const BASE = __ENV.BASE_URL || 'http://host.docker.internal:8096'
const AUTH = __ENV.AUTH === 'true'
const USERS = (__ENV.USERS || 'alice@plant.example,bob@plant.example').split(',')
const PASSWORD = __ENV.PASSWORD || 'Plant-Parent-2026!'
const PROFILE = __ENV.PROFILE || 'smoke'
const plantsCreated = new Counter('plants_created')

// Each profile is one scenario shape. Thresholds turn the run red when the app is too slow or failing.
const PROFILES = {
  smoke: { executor: 'constant-vus', vus: 1, duration: '30s' },
  load: { executor: 'ramping-vus', startVUs: 0, stages: [
    { duration: '1m', target: 20 }, { duration: '3m', target: 20 }, { duration: '30s', target: 0 }] },
  spike: { executor: 'ramping-vus', startVUs: 0, stages: [
    { duration: '20s', target: 5 }, { duration: '10s', target: 50 }, { duration: '1m', target: 50 }, { duration: '20s', target: 0 }] },
  stress: { executor: 'ramping-vus', startVUs: 0, stages: [
    { duration: '1m', target: 20 }, { duration: '1m', target: 50 }, { duration: '1m', target: 100 }, { duration: '30s', target: 0 }] },
  // Keep adding users until it breaks: the abort thresholds below stop the run at the breaking point.
  breakpoint: { executor: 'ramping-vus', startVUs: 0, gracefulRampDown: '10s', stages: [
    { duration: '8m', target: Number(__ENV.MAX_VUS || 1000) }, { duration: '30s', target: 0 }] },
}

// The breakpoint profile stops itself once the app is clearly overloaded, and the summary shows where.
const ABORT = PROFILE === 'breakpoint'
  ? { http_req_failed: [{ threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '20s' }],
      'http_req_duration{expected_response:true}': [{ threshold: 'p(95)<2000', abortOnFail: true, delayAbortEval: '20s' }] }
  : {}

export const options = {
  scenarios: { [PROFILE]: PROFILES[PROFILE] },
  thresholds: {
    http_req_failed: ['rate<0.01'], // under 1% errors
    'http_req_duration{expected_response:true}': ['p(95)<500'], // 95% of good requests under 500 ms
    checks: ['rate>0.99'],
    ...ABORT,
  },
  // One time series per endpoint instead of per URL (ids would explode the label count).
  tags: { stage: __ENV.STAGE || 'unknown' },
}

// Sign every test user in once; the access token is valid for an hour, longer than any profile.
export function setup() {
  if (!AUTH) return { tokens: [null] }
  const tokens = USERS.map((u) => {
    const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({ username: u, password: PASSWORD }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'POST /api/auth/login' } })
    check(r, { 'sign-in works': (x) => x.status === 200 })
    return r.json('access_token')
  })
  return { tokens }
}

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length]
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  const req = (method, path, body, name) =>
    http.request(method, `${BASE}${path}`, body ? JSON.stringify(body) : null, { headers, tags: { name } })

  group('browse the garden', () => {
    check(req('GET', '/api/plants', null, 'GET /api/plants'), { 'list 200': (r) => r.status === 200 })
    check(http.get(`${BASE}/`, { tags: { name: 'GET / (frontend)' } }), { 'frontend 200': (r) => r.status === 200 })
  })
  sleep(1)

  group('look after a plant', () => {
    const created = req('POST', '/api/plants', { name: `Load fern ${__VU}-${__ITER}`, species: 'Nephrolepis', water_every_days: 3 }, 'POST /api/plants')
    if (!check(created, { 'create 201': (r) => r.status === 201 })) return
    plantsCreated.add(1)
    const id = created.json('id')
    check(req('GET', `/api/plants/${id}`, null, 'GET /api/plants/:id'), { 'get 200': (r) => r.status === 200 })
    sleep(0.5)
    check(req('POST', `/api/plants/${id}/water`, {}, 'POST /api/plants/:id/water'), { 'water 200': (r) => r.status === 200 })
    check(req('DELETE', `/api/plants/${id}`, null, 'DELETE /api/plants/:id'), { 'delete 204': (r) => r.status === 204 })
  })
  sleep(1)
}
