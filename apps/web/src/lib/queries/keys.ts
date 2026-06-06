/**
 * Query Keys Factory
 */
export const queryKeys = {
  auth: {
    me: ['auth', 'me'] as const,
  },
  configs: {
    all: ['configs'] as const,
    list: () => [...queryKeys.configs.all, 'list'] as const,
  },
  oauth: {
    status: ['oauth', 'status'] as const,
  },
  reports: {
    all: ['reports'] as const,
    logs: (filters?: Record<string, any>) => [...queryKeys.reports.all, 'logs', filters] as const,
    stats: () => [...queryKeys.reports.all, 'stats'] as const,
  },
  dashboard: {
    stats: ['dashboard', 'stats'] as const,
    pollStatus: ['dashboard', 'poll-status'] as const,
  },
  batch: {
    status: ['batch', 'status'] as const,
  },
  scheduled: {
    list: ['scheduled', 'list'] as const,
  },
  queue: {
    jobs: (status?: string) => ['queue', 'jobs', status] as const,
    stats: ['queue', 'stats'] as const,
    job: (id: string) => ['queue', 'job', id] as const,
  },
  contacts: {
    all: ['contacts'] as const,
    lists: () => [...queryKeys.contacts.all, 'lists'] as const,
    list: (listId: string) => [...queryKeys.contacts.all, 'list', listId] as const,
    contacts: (listId: string, filters?: Record<string, any>) =>
      [...queryKeys.contacts.all, 'contacts', listId, filters] as const,
    search: (q: string) => [...queryKeys.contacts.all, 'search', q] as const,
    importHistory: () => [...queryKeys.contacts.all, 'import-history'] as const,
  },
  templates: {
    all: ['templates'] as const,
    list: (filters?: Record<string, any>) => ['templates', 'list', filters] as const,
    detail: (id: string) => ['templates', 'detail', id] as const,
    starters: ['templates', 'starters'] as const,
  },
  campaigns: {
    all: ['campaigns'] as const,
    list: (filters?: Record<string, any>) => ['campaigns', 'list', filters] as const,
    detail: (id: string) => ['campaigns', 'detail', id] as const,
    stats: (id: string) => ['campaigns', 'stats', id] as const,
    dashboard: ['campaigns', 'dashboard'] as const,
  },
  automations: {
    all: ['automations'] as const,
    list: ['automations', 'list'] as const,
    detail: (id: string) => ['automations', 'detail', id] as const,
  },
  routing: {
    scores: ['routing', 'scores'] as const,
    dashboard: ['routing', 'dashboard'] as const,
    config: ['routing', 'config'] as const,
    history: (days?: number) => ['routing', 'history', days] as const,
  },
  warmup: {
    all: ['warmup'] as const,
    list: (status?: string) => ['warmup', 'list', status] as const,
    detail: (id: string) => ['warmup', 'detail', id] as const,
    progress: (id: string) => ['warmup', 'progress', id] as const,
  },
  analytics: {
    all: ['analytics'] as const,
    summary: ['analytics', 'summary'] as const,
    reports: ['analytics', 'reports'] as const,
    campaign: (id: string) => ['analytics', 'campaign', id] as const,
    devices: ['analytics', 'devices'] as const,
    geo: ['analytics', 'geo'] as const,
    time: ['analytics', 'time'] as const,
  },
  plugins: {
    all: ['plugins'] as const,
    list: (type?: string) => ['plugins', 'list', type] as const,
    providers: ['plugins', 'providers'] as const,
  },
}
