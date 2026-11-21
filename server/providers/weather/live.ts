// Live weather adapter: data.gov.sg v2 real-time two-hr-forecast (works without an API key).
import type { AdapterFactory } from '../types.js';
import { normalizeWeather } from './normalize.js';

const URL_ = 'https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast';
const DETAIL_URL = 'https://www.nea.gov.sg/weather';

export const createLiveAdapter: AdapterFactory<'weather'> = ({ env, http }) => ({
  id: 'weather',
  mode: 'live',
  async setupStatus() {
    // Connected even without an area so the fetch can supply the area picker list.
    return { connection: 'connected', requirement: null };
  },
  configKey: (settings) => settings.weather.area ?? '',
  isExpired: (result, at) => !!result.validUntil && Date.parse(result.validUntil) < at.getTime(),
  async fetch(settings, signal) {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (env.DATA_GOV_SG_API_KEY) headers['x-api-key'] = env.DATA_GOV_SG_API_KEY;
    const res = await http.request(URL_, { headers, signal });
    const n = normalizeWeather(await res.json(), settings.weather.area);
    return { data: n.data, sourceUpdatedAt: n.sourceUpdatedAt, validUntil: n.validUntil, coverage: null, detailUrl: DETAIL_URL };
  },
});
