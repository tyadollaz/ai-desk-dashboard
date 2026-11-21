// Pure parsing/normalization of LTA DataMall BusArrival v3 responses.
import { z } from 'zod';
import type { BusArrival, BusLoad, BusService } from '../../../shared/contracts.js';
import { ProviderError } from '../types.js';

const str = z.union([z.string(), z.number()]).nullish();
const nextBusSchema = z
  .object({
    EstimatedArrival: str,
    Monitored: z.union([z.number(), z.string(), z.boolean()]).nullish(),
    Load: str,
  })
  .passthrough();

const serviceSchema = z
  .object({
    ServiceNo: z.union([z.string(), z.number()]),
    Operator: str,
    NextBus: nextBusSchema.nullish(),
    NextBus2: nextBusSchema.nullish(),
    NextBus3: nextBusSchema.nullish(),
  })
  .passthrough();

export const busArrivalResponseSchema = z
  .object({
    BusStopCode: str,
    Services: z.array(serviceSchema),
  })
  .passthrough();

const LOADS: readonly string[] = ['SEA', 'SDA', 'LSD'];

function parseArrival(raw: z.infer<typeof nextBusSchema> | null | undefined): BusArrival | null {
  if (!raw) return null;
  const est = typeof raw.EstimatedArrival === 'string' ? raw.EstimatedArrival.trim() : '';
  let estimatedArrival: string | null = null;
  if (est) {
    const ms = Date.parse(est);
    if (!Number.isNaN(ms)) estimatedArrival = new Date(ms).toISOString();
  }
  const loadRaw = typeof raw.Load === 'string' ? raw.Load.trim().toUpperCase() : '';
  const load = LOADS.includes(loadRaw) ? (loadRaw as BusLoad) : null;
  let monitored: boolean | null = null;
  const m = raw.Monitored;
  if (m === 1 || m === '1' || m === true) monitored = true;
  else if (m === 0 || m === '0' || m === false) monitored = false;
  if (estimatedArrival === null) return { estimatedArrival: null, load: null, monitored: null };
  return { estimatedArrival, load, monitored };
}

/** Normalize one BusArrival response body. `filter` (string compare) applies when non-empty. */
export function normalizeBusArrival(body: unknown, filter: readonly string[] = []): BusService[] {
  const parsed = busArrivalResponseSchema.safeParse(body);
  if (!parsed.success) throw new ProviderError('malformed', 'The bus service returned an unexpected response');
  const wanted = new Set(filter);
  const out: BusService[] = [];
  for (const s of parsed.data.Services) {
    const serviceNo = String(s.ServiceNo);
    if (wanted.size > 0 && !wanted.has(serviceNo)) continue;
    const arrivals = [s.NextBus, s.NextBus2, s.NextBus3].map(parseArrival).filter((a): a is BusArrival => a !== null);
    out.push({ serviceNo, operator: typeof s.Operator === 'string' && s.Operator ? s.Operator : null, arrivals });
  }
  return out;
}
