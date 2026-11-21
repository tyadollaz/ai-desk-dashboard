// Synthetic DEMO data. No network calls. Not real bus information.
import type { BusArrival, BusLoad, BusService } from '../../../shared/contracts.js';
import type { AdapterFactory } from '../types.js';

export const createDemoAdapter: AdapterFactory<'lta'> = ({ now }) => ({
  id: 'lta',
  mode: 'demo',
  async setupStatus() {
    return { connection: 'connected', requirement: null };
  },
  configKey: () => 'demo',
  async fetch() {
    const t = now().getTime();
    const arr = (sec: number | null, load: BusLoad | null, monitored: boolean | null): BusArrival => ({
      estimatedArrival: sec === null ? null : new Date(t + sec * 1000).toISOString(),
      load,
      monitored,
    });
    const svc = (serviceNo: string, arrivals: BusArrival[]): BusService => ({ serviceNo, operator: 'DEMO', arrivals });
    return {
      data: {
        stops: [
          {
            code: '01012',
            nickname: 'Demo stop A',
            error: null,
            services: [
              svc('7', [arr(45, 'SEA', true), arr(8 * 60 + 20, 'SDA', true), arr(17 * 60, 'LSD', true)]),
              svc('36A', [arr(3 * 60 + 10, 'SDA', true), arr(12 * 60, 'SEA', false)]),
              svc('36', [arr(119, 'SEA', true), arr(14 * 60, 'SEA', true), arr(null, null, null)]),
            ],
          },
          {
            code: '01019',
            nickname: 'Demo stop B',
            error: null,
            services: [svc('190', [arr(5 * 60, 'LSD', false), arr(null, null, null)]), svc('61', [arr(9 * 60, 'SEA', true)])],
          },
        ],
      },
      sourceUpdatedAt: now().toISOString(),
      validUntil: null,
      coverage: null,
      detailUrl: null,
    };
  },
});
