// Synthetic. Internal GarminRawSnapshot shape — NOT a Garmin API payload.
import type { GarminRawActivity } from '../../../server/providers/garmin/normalize.js';

export const run = (id: string, startTime: string, distanceM: number | null, extra: Partial<GarminRawActivity> = {}): GarminRawActivity => ({
  id, type: 'running', startTime, durationSec: 1800, distanceM, ...extra,
});
