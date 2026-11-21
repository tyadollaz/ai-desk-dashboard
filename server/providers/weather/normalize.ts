// Pure parsing/normalization of data.gov.sg v2 two-hr-forecast responses.
import { z } from 'zod';
import type { WeatherData } from '../../../shared/contracts.js';
import { ProviderError } from '../types.js';

const itemSchema = z
  .object({
    update_timestamp: z.string(),
    timestamp: z.string(),
    valid_period: z.object({ start: z.string(), end: z.string() }).passthrough(),
    forecasts: z.array(z.object({ area: z.string(), forecast: z.string() }).passthrough()),
  })
  .passthrough();

export const forecastResponseSchema = z
  .object({
    code: z.number(),
    errorMsg: z.string().nullish(),
    data: z
      .object({
        area_metadata: z.array(z.object({ name: z.string() }).passthrough()),
        items: z.array(itemSchema),
      })
      .passthrough(),
  })
  .passthrough();

function iso(s: string): string | null {
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export interface NormalizedWeather {
  data: WeatherData;
  sourceUpdatedAt: string | null;
  validUntil: string | null;
}

export function normalizeWeather(body: unknown, area: string | null): NormalizedWeather {
  const parsed = forecastResponseSchema.safeParse(body);
  if (!parsed.success) throw new ProviderError('malformed', 'The weather service returned an unexpected response');
  const r = parsed.data;
  if (r.code !== 0 || (r.errorMsg && r.errorMsg.trim() !== '')) {
    throw new ProviderError('upstream', 'The weather service reported an error');
  }
  const availableAreas = [...new Set(r.data.area_metadata.map((a) => a.name))].sort((a, b) => a.localeCompare(b));

  let latest: z.infer<typeof itemSchema> | null = null;
  let latestMs = -Infinity;
  for (const it of r.data.items) {
    const ms = Date.parse(it.timestamp);
    if (Number.isNaN(ms)) continue;
    if (ms > latestMs) {
      latest = it;
      latestMs = ms;
    }
  }
  const validFrom = latest ? iso(latest.valid_period.start) : null;
  const validUntil = latest ? iso(latest.valid_period.end) : null;
  const issuedAt = latest ? iso(latest.update_timestamp) : null;

  let forecast: string | null = null;
  if (area !== null && latest) {
    const match = latest.forecasts.find((f) => f.area === area);
    if (!match) {
      throw new ProviderError('needs_setup', `Forecast area "${area}" is not in the provider area list; choose another in Settings`);
    }
    forecast = match.forecast;
  }
  return {
    data: { area, forecast, validFrom, validUntil, issuedAt, availableAreas },
    sourceUpdatedAt: issuedAt,
    validUntil,
  };
}
