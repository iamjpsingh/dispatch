/**
 * Mock D1Database for testing Cloudflare Workers.
 *
 * Uses a query-matcher registry so individual tests can control what
 * specific SQL statements return without touching global state.
 */

type QueryMatcher = (sql: string) => boolean
interface MockResponse {
  results?: any[]
  first?: any
  runMeta?: { changes: number }
}

interface MockRegistration {
  matcher: QueryMatcher
  response: MockResponse
}

export function createMockD1() {
  const registrations: MockRegistration[] = []

  function buildStatement(response: MockResponse) {
    const stmt: any = {
      bind: (..._args: any[]) => buildStatement(response),
      run: () =>
        Promise.resolve({
          success: true,
          meta: { changes: response.runMeta?.changes ?? 1 },
        }),
      first: () => Promise.resolve(response.first ?? null),
      all: () =>
        Promise.resolve({
          results: response.results ?? [],
          success: true,
        }),
    }
    return stmt
  }

  const defaultResponse: MockResponse = { results: [], first: null }

  const db: any = {
    prepare: (sql: string) => {
      // Walk registrations in reverse so the most recent mock wins
      for (let i = registrations.length - 1; i >= 0; i--) {
        if (registrations[i].matcher(sql)) {
          return buildStatement(registrations[i].response)
        }
      }
      return buildStatement(defaultResponse)
    },
    batch: (stmts: any[]) => Promise.resolve(stmts.map(() => ({ results: [], success: true }))),
    exec: (_sql: string) => Promise.resolve({ count: 0 }),

    /**
     * Register a mock response for SQL queries that match the given predicate.
     *
     * @example
     *   db._mockQuery(
     *     sql => sql.includes('SELECT') && sql.includes('users'),
     *     { first: { id: '1', email: 'a@b.com' } }
     *   )
     */
    _mockQuery: (matcher: QueryMatcher, response: MockResponse) => {
      registrations.push({ matcher, response })
    },

    /** Remove all registered mocks. */
    _resetMocks: () => {
      registrations.length = 0
    },
  }

  return db
}

export function createMockEnv(overrides?: Partial<{ ALLOWED_ORIGINS: string }>) {
  return {
    DB: createMockD1(),
    ALLOWED_ORIGINS: overrides?.ALLOWED_ORIGINS || '',
  }
}

export function createMockExecutionContext() {
  const waitUntilPromises: Promise<any>[] = []
  return {
    waitUntil: (promise: Promise<any>) => {
      waitUntilPromises.push(promise)
    },
    passThroughOnException: () => {},
    /** Helper: await all background tasks so assertions can inspect side-effects. */
    _flush: () => Promise.all(waitUntilPromises),
  }
}
