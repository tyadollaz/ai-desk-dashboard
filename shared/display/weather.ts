import type { WeatherData } from '../contracts.js';
import { fmtTime, toMs, type TimeInput } from './time.js';

export type WeatherView =
  | { state: 'no_area' }
  | { state: 'expired'; area: string; validity: string }
  | { state: 'ok'; area: string; forecast: string; validity: string }
  | { state: 'empty'; area: string };

/** Expiry is derived from validUntil vs now, independent of whether the last fetch succeeded. */
export function weatherView(data: WeatherData, envelopeValidUntil: TimeInput, nowMs: number): WeatherView {
  if (!data.area) return { state: 'no_area' };
  const until = toMs(data.validUntil ?? envelopeValidUntil);
  if (until === null || !data.forecast) {
    if (until !== null && until < nowMs) return { state: 'expired', area: data.area, validity: 'Forecast expired' };
    return { state: 'empty', area: data.area };
  }
  if (until < nowMs) return { state: 'expired', area: data.area, validity: 'Forecast expired' };
  return { state: 'ok', area: data.area, forecast: data.forecast, validity: `Valid until ${fmtTime(until)}` };
}
