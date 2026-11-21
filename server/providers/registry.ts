import type { ProviderId } from '../../shared/contracts.js';
import { PROVIDER_IDS } from '../../shared/contracts.js';
import { createHttpClient } from '../http/client.js';
import type { Config } from '../config.js';
import type { AdapterFactory, ProviderAdapter, ProviderDeps, TokenStore } from './types.js';
import { createDemoAdapter as ltaDemo } from './lta/demo.js';
import { createLiveAdapter as ltaLive } from './lta/live.js';
import { createDemoAdapter as weatherDemo } from './weather/demo.js';
import { createLiveAdapter as weatherLive } from './weather/live.js';
import { createDemoAdapter as canvasDemo } from './canvas/demo.js';
import { createLiveAdapter as canvasLive } from './canvas/live.js';
import { createDemoAdapter as googleDemo } from './google/demo.js';
import { createLiveAdapter as googleLive } from './google/live.js';
import { createDemoAdapter as garminDemo } from './garmin/demo.js';
import { createLiveAdapter as garminLive } from './garmin/live.js';

export type AdapterMap = { [K in ProviderId]: ProviderAdapter<K> };

type Factories = { [K in ProviderId]: AdapterFactory<K> };
const DEMO: Factories = { lta: ltaDemo, weather: weatherDemo, canvas: canvasDemo, google: googleDemo, garmin: garminDemo };
const LIVE: Factories = { lta: ltaLive, weather: weatherLive, canvas: canvasLive, google: googleLive, garmin: garminLive };

/** Returns the https hostname of CANVAS_BASE_URL, or null if unset/invalid/not https. */
export function canvasHost(env: Record<string, string | undefined>): string | null {
  const raw = env.CANVAS_BASE_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

export function allowedHostsFor(id: ProviderId, env: Record<string, string | undefined>): string[] {
  switch (id) {
    case 'lta':
      return ['datamall2.mytransport.sg'];
    case 'weather':
      return ['api-open.data.gov.sg'];
    case 'canvas': {
      const h = canvasHost(env);
      return h ? [h] : [];
    }
    case 'google':
      return ['oauth2.googleapis.com', 'www.googleapis.com'];
    case 'garmin':
      return ['personal.connectapi.garmin.com'];
  }
}

export interface RegistryOptions {
  now: () => Date;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  tokens: TokenStore;
  overrides?: Partial<AdapterMap>;
}

export function createAdapters(config: Config, opts: RegistryOptions): AdapterMap {
  const factories = config.demoMode ? DEMO : LIVE;
  const build = <K extends ProviderId>(id: K): ProviderAdapter<K> => {
    const override = opts.overrides?.[id] as ProviderAdapter<K> | undefined;
    if (override) return override;
    const deps: ProviderDeps = {
      env: config.providerEnv,
      now: opts.now,
      tokens: opts.tokens,
      http: createHttpClient({
        allowedHosts: allowedHostsFor(id, config.providerEnv),
        fetchImpl: opts.fetchImpl,
        now: opts.now,
        sleep: opts.sleep,
      }),
    };
    const adapter = (factories[id] as AdapterFactory<K>)(deps);
    if (id === 'canvas' && !config.demoMode && config.providerEnv.CANVAS_BASE_URL && !canvasHost(config.providerEnv)) {
      return {
        ...adapter,
        async setupStatus() {
          return { connection: 'needs_setup', requirement: 'CANVAS_BASE_URL must be an https URL' };
        },
      };
    }
    return adapter;
  };
  return Object.fromEntries(PROVIDER_IDS.map((id) => [id, build(id)])) as unknown as AdapterMap;
}
