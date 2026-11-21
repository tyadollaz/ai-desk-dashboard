// Provider adapter interface. Each provider lives in server/providers/<id>/ and exports
// `createLiveAdapter(deps)` and `createDemoAdapter(deps)` returning ProviderAdapter.
import type { Connection, Coverage, ProviderDataMap, ProviderId, SafeErrorCode, Settings } from '../../shared/contracts.js';

export class ProviderError extends Error {
  constructor(
    public readonly code: SafeErrorCode,
    /** Safe, user-facing next step. Never include secrets or raw upstream bodies. */
    public readonly safeMessage: string,
    public readonly opts: { retryAfterMs?: number; retryable?: boolean } = {},
  ) {
    super(safeMessage);
  }
}

/** Fixed-host HTTP client provided by the core (server/http/client.ts). */
export interface HttpClient {
  /**
   * GET/POST to an allow-listed https host. Enforces: 10s timeout, bounded retries with jitter on
   * network/5xx, Retry-After on 429 (throws ProviderError 'rate_limited' with retryAfterMs),
   * no redirects to other hosts, never logs headers. 401/403 => ProviderError 'auth_failed' (not retried).
   */
  request(url: string, init?: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }): Promise<HttpResponse>;
}
export interface HttpResponse {
  status: number;
  headers: Headers;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface TokenStore {
  /** Encrypted-at-rest JSON blob per provider (AES-256-GCM, key from env). */
  get(provider: ProviderId): Promise<Record<string, unknown> | null>;
  set(provider: ProviderId, value: Record<string, unknown>): Promise<void>;
  clear(provider: ProviderId): Promise<void>;
}

export interface ProviderDeps {
  env: Record<string, string | undefined>;
  now: () => Date;
  http: HttpClient;
  tokens: TokenStore;
}

export interface FetchResult<T> {
  data: T;
  sourceUpdatedAt: string | null;
  validUntil: string | null;
  coverage: Coverage | null;
  detailUrl?: string | null;
}

export interface SetupStatus {
  connection: Connection; // 'connected' when ready to fetch
  /** Exact unmet requirement when not connected, e.g. "Set LTA_ACCOUNT_KEY in the server environment". */
  requirement: string | null;
}

export interface ProviderAdapter<K extends ProviderId = ProviderId> {
  id: K;
  mode: 'live' | 'demo';
  /** Cheap, synchronous-ish readiness check from env/settings/token presence. No network. */
  setupStatus(settings: Settings): Promise<SetupStatus>;
  /** Fetch & normalize. Throw ProviderError on failure. Must not mutate settings. */
  fetch(settings: Settings, signal: AbortSignal): Promise<FetchResult<ProviderDataMap[K]>>;
  /** Optional: provider-specific freshness override (e.g. weather expiry at validity end). */
  isExpired?(result: FetchResult<ProviderDataMap[K]>, now: Date): boolean;
  /** Optional: cache key so a settings change (e.g. different stops) invalidates the snapshot. */
  configKey?(settings: Settings): string;
}

export type AdapterFactory<K extends ProviderId> = (deps: ProviderDeps) => ProviderAdapter<K>;
