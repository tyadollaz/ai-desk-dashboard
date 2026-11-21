// Synthetic DEMO forecast. No network calls.
import type { AdapterFactory } from '../types.js';

const HOUR = 3_600_000;

export const createDemoAdapter: AdapterFactory<'weather'> = ({ now }) => ({
  id: 'weather',
  mode: 'demo',
  async setupStatus() {
    return { connection: 'connected', requirement: null };
  },
  configKey: () => 'demo',
  isExpired: (result, at) => !!result.validUntil && Date.parse(result.validUntil) <= at.getTime(),
  async fetch() {
    const t = now().getTime();
    const slotStart = Math.floor(t / HOUR) * HOUR;
    const validUntil = new Date(slotStart + 2 * HOUR).toISOString();
    return {
      data: {
        area: 'Demo Area',
        forecast: 'Partly Cloudy (Day)',
        validFrom: new Date(slotStart).toISOString(),
        validUntil,
        issuedAt: now().toISOString(),
        availableAreas: ['Demo Area', 'Demo Bay', 'Demo Heights', 'Demo Park', 'Demo Quay'],
      },
      sourceUpdatedAt: now().toISOString(),
      validUntil,
      coverage: null,
      detailUrl: null,
    };
  },
});
