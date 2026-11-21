import {
  REFRESH_POLICY,
  type Connection,
  type FetchState,
  type Freshness,
  type Mode,
  type ProviderId,
  type SafeError,
  type WidgetEnvelope,
  PROVIDER_IDS,
} from '../../shared/contracts.js';
import type { SettingsStore } from '../storage/settings.js';
import type { SnapshotPayload, SnapshotStore } from '../storage/snapshots.js';
import type { SyncMetaStore } from '../storage/sync-meta.js';
import { ProviderError, type FetchResult, type ProviderAdapter, type SetupStatus, type TokenStore } from './types.js';
import type { AdapterMap } from './registry.js';

export type RefreshStatus = 'accepted' | 'in_flight' | 'cooldown' | 'disabled';

export const MANUAL_MIN_SPACING_MS = 10_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const FETCH_BUDGET_MS = 60_000;

export interface ManagerDeps {
  adapters: AdapterMap;
  mode: Mode;
  settings: SettingsStore;
  snapshots: SnapshotStore;
  syncMeta: SyncMetaStore;
  tokens: TokenStore;
  now: () => Date;
  log: { warn(obj: Record<string, unknown>, msg: string): void };
}

interface State {
  gen: number;
  configKey: string;
  snapshot: SnapshotPayload | null;
  lastAttemptAt: number | null;
  cooldownUntil: number | null;
  failures: number;
  error: SafeError | null;
  fetchState: FetchState;
  /** After auth failure: no automatic retries until settings/tokens change or a manual refresh. */
  blocked: boolean;
  enabled: boolean;
  inFlight: Promise<void> | null;
}

export function toSafeError(e: unknown): SafeError {
  if (e instanceof ProviderError) return { code: e.code, message: e.safeMessage };
  return { code: 'internal', message: 'Something went wrong while refreshing this provider' };
}

export class ProviderManager {
  private state = new Map<ProviderId, State>();

  constructor(private deps: ManagerDeps) {
    for (const id of deps.snapshots.purgeOtherModes(deps.mode)) deps.syncMeta.delete(id);
    const settings = deps.settings.get();
    for (const id of PROVIDER_IDS) {
      const adapter = this.adapter(id);
      const configKey = adapter.configKey?.(settings) ?? '';
      const meta = deps.syncMeta.get(id);
      const snapshot = deps.snapshots.get(id, deps.mode, configKey);
      this.state.set(id, {
        gen: 0,
        configKey,
        snapshot,
        lastAttemptAt: meta?.lastAttemptAt ? Date.parse(meta.lastAttemptAt) : null,
        cooldownUntil: meta?.cooldownUntil ? Date.parse(meta.cooldownUntil) : null,
        failures: meta?.consecutiveFailures ?? 0,
        error: null,
        fetchState: 'idle',
        blocked: false,
        enabled: settings.providers[id].enabled,
        inFlight: null,
      });
    }
  }

  private adapter(id: ProviderId): ProviderAdapter {
    return this.deps.adapters[id] as unknown as ProviderAdapter;
  }

  private st(id: ProviderId): State {
    return this.state.get(id) as State;
  }

  /** Detects settings changes: a new configKey discards the old snapshot; re-enabling clears the auth block. */
  private sync(id: ProviderId): void {
    const settings = this.deps.settings.get();
    const st = this.st(id);
    const key = this.adapter(id).configKey?.(settings) ?? '';
    if (key !== st.configKey) {
      st.gen++;
      st.inFlight = null;
      st.configKey = key;
      st.snapshot = null;
      st.error = null;
      st.cooldownUntil = null;
      st.failures = 0;
      st.blocked = false;
      st.lastAttemptAt = null;
      st.fetchState = 'idle';
      this.deps.snapshots.delete(id);
      this.deps.syncMeta.delete(id);
    }
    const enabled = settings.providers[id].enabled;
    if (enabled && !st.enabled) st.blocked = false;
    st.enabled = enabled;
  }

  /** Call after settings or stored tokens change so blocked providers may retry. */
  onSettingsChanged(): void {
    for (const id of PROVIDER_IDS) {
      this.sync(id);
      this.st(id).blocked = false;
    }
  }

  private async setup(id: ProviderId): Promise<SetupStatus> {
    try {
      return await this.adapter(id).setupStatus(this.deps.settings.get());
    } catch {
      return { connection: 'needs_setup', requirement: 'Provider setup check failed' };
    }
  }

  private isDue(id: ProviderId): boolean {
    const st = this.st(id);
    const t = this.deps.now().getTime();
    if (st.inFlight || st.blocked) return false;
    if (st.cooldownUntil && st.cooldownUntil > t) return false;
    return st.lastAttemptAt === null || t - st.lastAttemptAt >= REFRESH_POLICY[id].intervalMs;
  }

  async getEnvelope(id: ProviderId): Promise<WidgetEnvelope> {
    this.sync(id);
    const settings = this.deps.settings.get();
    const st = this.st(id);
    const adapter = this.adapter(id);
    const enabled = settings.providers[id].enabled;
    const setup = enabled ? await this.setup(id) : null;
    const nowDate = this.deps.now();
    const t = nowDate.getTime();

    let connection: Connection;
    if (!enabled) connection = 'disabled';
    else if (setup && setup.connection !== 'connected') connection = setup.connection;
    else if (st.blocked || st.error?.code === 'auth_failed' || st.error?.code === 'reauth_required') connection = 'reauth_required';
    else connection = 'connected';

    const showData = connection !== 'disabled' && connection !== 'needs_setup' && connection !== 'unsupported';
    const snap = showData ? st.snapshot : null;

    let freshness: Freshness = 'unknown';
    if (snap) {
      const result: FetchResult<never> = {
        data: snap.data as never,
        sourceUpdatedAt: snap.sourceUpdatedAt,
        validUntil: snap.validUntil,
        coverage: snap.coverage,
      };
      if (adapter.isExpired?.(result, nowDate)) freshness = 'expired';
      else if (t - Date.parse(snap.lastSuccessAt) > REFRESH_POLICY[id].staleAfterMs) freshness = 'stale';
      else freshness = 'fresh';
    }

    const nextAllowed = Math.max(st.cooldownUntil ?? 0, st.lastAttemptAt ? st.lastAttemptAt + MANUAL_MIN_SPACING_MS : 0);
    return {
      provider: id,
      mode: adapter.mode,
      connection,
      fetchState: st.inFlight ? 'fetching' : st.fetchState,
      freshness,
      data: snap?.data ?? null,
      lastAttemptAt: st.lastAttemptAt ? new Date(st.lastAttemptAt).toISOString() : null,
      lastSuccessAt: snap?.lastSuccessAt ?? null,
      sourceUpdatedAt: snap?.sourceUpdatedAt ?? null,
      validUntil: snap?.validUntil ?? null,
      coverage: snap?.coverage ?? null,
      error: showData ? st.error : null,
      nextAllowedRefreshAt: nextAllowed > t ? new Date(nextAllowed).toISOString() : null,
      detailUrl: snap?.detailUrl ?? null,
    };
  }

  /** Returns cached envelopes immediately; due providers refresh in the background. */
  async getEnvelopes(): Promise<{ [K in ProviderId]: WidgetEnvelope }> {
    const out = {} as { [K in ProviderId]: WidgetEnvelope };
    for (const id of PROVIDER_IDS) {
      this.sync(id);
      const settings = this.deps.settings.get();
      if (settings.providers[id].enabled && this.isDue(id)) {
        const setup = await this.setup(id);
        if (setup.connection === 'connected' && this.isDue(id)) this.start(id);
      }
      out[id] = await this.getEnvelope(id);
    }
    return out;
  }

  async refresh(id: ProviderId, opts: { manual: boolean }): Promise<RefreshStatus> {
    this.sync(id);
    const settings = this.deps.settings.get();
    if (!settings.providers[id].enabled) return 'disabled';
    if ((await this.setup(id)).connection !== 'connected') return 'disabled';
    const st = this.st(id);
    const t = this.deps.now().getTime();
    if (st.inFlight) return 'in_flight';
    if (st.cooldownUntil && st.cooldownUntil > t) return 'cooldown';
    if (opts.manual && st.lastAttemptAt !== null && t - st.lastAttemptAt < MANUAL_MIN_SPACING_MS) return 'cooldown';
    this.start(id);
    return 'accepted';
  }

  /** Refreshes every enabled, ready provider once and waits (used for instant demo data). */
  async prime(): Promise<void> {
    for (const id of PROVIDER_IDS) await this.refresh(id, { manual: false });
    await this.whenIdle();
  }

  async whenIdle(): Promise<void> {
    await Promise.all([...this.state.values()].map((s) => s.inFlight).filter((p): p is Promise<void> => !!p));
  }

  private start(id: ProviderId): void {
    const st = this.st(id);
    const adapter = this.adapter(id);
    const settings = this.deps.settings.get();
    const gen = st.gen;
    const configKey = st.configKey;
    st.lastAttemptAt = this.deps.now().getTime();
    st.fetchState = 'fetching';
    st.blocked = false;
    const signal = AbortSignal.timeout(FETCH_BUDGET_MS);

    st.inFlight = (async () => {
      await null; // ensure st.inFlight is assigned before any synchronous failure reaches `finally`
      try {
        const result = await adapter.fetch(settings, signal);
        if (st.gen !== gen) return;
        const at = this.deps.now();
        st.snapshot = {
          data: result.data,
          sourceUpdatedAt: result.sourceUpdatedAt,
          validUntil: result.validUntil,
          coverage: result.coverage,
          detailUrl: result.detailUrl ?? null,
          lastSuccessAt: at.toISOString(),
        };
        this.deps.snapshots.save(id, adapter.mode, configKey, st.snapshot, at.toISOString());
        st.error = null;
        st.failures = 0;
        st.cooldownUntil = null;
        st.fetchState = 'ok';
      } catch (e) {
        if (st.gen !== gen) return;
        st.failures++;
        st.error = toSafeError(e);
        st.fetchState = 'error';
        if (e instanceof ProviderError) {
          if (e.code === 'rate_limited') st.cooldownUntil = this.deps.now().getTime() + (e.opts.retryAfterMs ?? DEFAULT_COOLDOWN_MS);
          if (e.code === 'auth_failed' || e.code === 'reauth_required') st.blocked = true;
        }
        // Only name/message are logged: never headers, URLs or tokens.
        this.deps.log.warn(
          { provider: id, errName: e instanceof Error ? e.name : 'unknown', errMessage: e instanceof ProviderError ? e.safeMessage : 'unexpected error' },
          'provider refresh failed',
        );
      } finally {
        if (st.gen === gen) {
          st.inFlight = null;
          this.persistMeta(id);
        }
      }
    })();
  }

  private persistMeta(id: ProviderId): void {
    const st = this.st(id);
    this.deps.syncMeta.save(id, {
      lastAttemptAt: st.lastAttemptAt ? new Date(st.lastAttemptAt).toISOString() : null,
      lastSuccessAt: st.snapshot?.lastSuccessAt ?? null,
      cooldownUntil: st.cooldownUntil ? new Date(st.cooldownUntil).toISOString() : null,
      consecutiveFailures: st.failures,
    });
  }

  async disconnect(id: ProviderId): Promise<void> {
    const current = this.deps.settings.get();
    this.deps.settings.patch({ providers: { ...current.providers, [id]: { enabled: false } } });
    const st = this.st(id);
    st.gen++;
    st.inFlight = null;
    st.snapshot = null;
    st.error = null;
    st.cooldownUntil = null;
    st.failures = 0;
    st.blocked = false;
    st.lastAttemptAt = null;
    st.fetchState = 'idle';
    st.enabled = false;
    this.deps.snapshots.delete(id);
    this.deps.syncMeta.delete(id);
    await this.deps.tokens.clear(id);
  }
}
