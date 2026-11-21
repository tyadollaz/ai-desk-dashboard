// Synthetic, shaped per data.gov.sg v2 two-hr-forecast response observed 2026-11-21. Not a live capture.
export function forecastBody(over: { code?: number; errorMsg?: string; items?: unknown[] } = {}) {
  return {
    code: over.code ?? 0,
    data: {
      area_metadata: [
        { name: 'Bedok', label_location: { latitude: 1.32, longitude: 103.93 } },
        { name: 'Ang Mo Kio', label_location: { latitude: 1.375, longitude: 103.839 } },
        { name: 'Yishun', label_location: { latitude: 1.418, longitude: 103.839 } },
      ],
      items: over.items ?? [
        {
          update_timestamp: '2026-11-21T14:36:00+08:00',
          timestamp: '2026-11-21T14:30:00+08:00',
          valid_period: { start: '2026-11-21T14:30:00+08:00', end: '2026-11-21T16:30:00+08:00', text: '2.30 pm to 4.30 pm' },
          forecasts: [{ area: 'Bedok', forecast: 'Old' }, { area: 'Ang Mo Kio', forecast: 'Old' }],
        },
        {
          update_timestamp: '2026-11-21T15:06:51+08:00',
          timestamp: '2026-11-21T15:00:00+08:00',
          valid_period: { start: '2026-11-21T15:00:00+08:00', end: '2026-11-21T17:00:00+08:00', text: '3.00 pm to 5.00 pm' },
          forecasts: [{ area: 'Bedok', forecast: 'Light Rain' }, { area: 'Ang Mo Kio', forecast: 'Cloudy' }, { area: 'Yishun', forecast: 'Fair' }],
        },
      ],
    },
    errorMsg: over.errorMsg ?? '',
  };
}
