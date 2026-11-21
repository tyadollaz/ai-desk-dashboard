// Live LTA DataMall BusArrival v3 adapter. One request per configured stop.
import type { BusStop, SafeError, Settings } from '../../../shared/contracts.js';
import type { AdapterFactory } from '../types.js';
import { ProviderError } from '../types.js';
import { normalizeBusArrival } from './normalize.js';

const BASE = 'https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival';
const NO_KEY = 'Set LTA_ACCOUNT_KEY in the server environment';
const NO_STOPS = 'Add a bus stop in Settings';

export const createLiveAdapter: AdapterFactory<'lta'> = ({ env, now, http }) => ({
  id: 'lta',
  mode: 'live',
  async setupStatus(settings: Settings) {
    if (!env.LTA_ACCOUNT_KEY) return { connection: 'needs_setup', requirement: NO_KEY };
    if (settings.bus.stops.length === 0) return { connection: 'needs_setup', requirement: NO_STOPS };
    return { connection: 'connected', requirement: null };
  },
  configKey: (settings) => JSON.stringify(settings.bus.stops),
  async fetch(settings, signal, previous) {
    const key = env.LTA_ACCOUNT_KEY;
    if (!key) throw new ProviderError('needs_setup', NO_KEY);
    const stops = settings.bus.stops.slice(0, 3);
    if (stops.length === 0) throw new ProviderError('needs_setup', NO_STOPS);

    const results: BusStop[] = [];
    const failures: ProviderError[] = [];
    for (const stop of stops) {
      try {
        const res = await http.request(`${BASE}?BusStopCode=${encodeURIComponent(stop.code)}`, {
          headers: { AccountKey: key, accept: 'application/json' },
          signal,
        });
        const services = normalizeBusArrival(await res.json(), stop.services);
        results.push({ code: stop.code, nickname: stop.nickname, services, error: null });
      } catch (e) {
        const pe = e instanceof ProviderError ? e : new ProviderError('internal', 'Unexpected error fetching bus arrivals');
        failures.push(pe);
        const error: SafeError = { code: pe.code, message: pe.safeMessage };
        // Carry forward this stop's last good services so a transient failure does not blank it; `error` marks it stale.
        const prior = previous?.stops.find((p) => p.code === stop.code);
        results.push({ code: stop.code, nickname: stop.nickname, services: prior?.services ?? [], error });
      }
    }
    if (failures.length === stops.length) throw failures[0]!;
    return { data: { stops: results }, sourceUpdatedAt: now().toISOString(), validUntil: null, coverage: null, detailUrl: null };
  },
});
