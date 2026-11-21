import type {
  Briefing,
  DashboardResponse,
  ProviderId,
  RefreshResponse,
  SessionResponse,
  Settings,
  SettingsPatch,
  SettingsResponse,
} from '../../shared/contracts';

export class ApiError extends Error {
  status: number;
  body: unknown;
  retryAfterSec: number | null;
  constructor(status: number, message: string, body: unknown, retryAfterSec: number | null) {
    super(message);
    this.status = status;
    this.body = body;
    this.retryAfterSec = retryAfterSec;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

interface Opts {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  /** Do not treat 401 as "session expired" (login form). */
  allow401?: boolean;
}

function errorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const e = (body as { error: unknown }).error;
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
      return (e as { message: string }).message;
    }
  }
  return `Request failed (${status})`;
}

async function request<T>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') headers['X-Desk-Request'] = '1';
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin' });
  if (res.status === 204) return undefined as T;
  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !opts.allow401) onUnauthorized?.();
    const ra = Number(res.headers.get('Retry-After'));
    throw new ApiError(res.status, errorMessage(parsed, res.status), parsed, Number.isFinite(ra) && ra > 0 ? ra : null);
  }
  return parsed as T;
}

export const api = {
  session: () => request<SessionResponse>('/auth/session', { allow401: true }),
  login: (password: string) => request<void>('/auth/login', { method: 'POST', body: { password }, allow401: true }),
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  dashboard: () => request<DashboardResponse>('/dashboard'),
  settings: () => request<SettingsResponse>('/settings'),
  patchSettings: (patch: SettingsPatch) => request<SettingsResponse>('/settings', { method: 'PATCH', body: patch }),
  refresh: (id: ProviderId) => request<RefreshResponse>(`/providers/${id}/refresh`, { method: 'POST' }),
  disconnect: (id: ProviderId) => request<void>(`/providers/${id}/disconnect`, { method: 'POST' }),
  briefing: () => request<{ briefing: Briefing; ai: DashboardResponse['ai'] }>('/briefing', { method: 'POST' }),
};

export type { Settings };
