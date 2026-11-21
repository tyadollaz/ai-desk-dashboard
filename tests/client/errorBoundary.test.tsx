// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { BusData, WeatherData, WidgetEnvelope } from '../../shared/contracts';
import BusCard from '../../client/src/components/BusCard';
import WeatherCard from '../../client/src/components/WeatherCard';
import ErrorBoundary from '../../client/src/components/ErrorBoundary';

afterEach(cleanup);

function env<T>(provider: WidgetEnvelope['provider'], data: T): WidgetEnvelope<T> {
  const t = new Date().toISOString();
  return {
    provider,
    mode: 'live',
    connection: 'connected',
    fetchState: 'ok',
    freshness: 'fresh',
    data,
    lastAttemptAt: t,
    lastSuccessAt: t,
    sourceUpdatedAt: t,
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
    coverage: null,
    error: null,
    nextAllowedRefreshAt: null,
    detailUrl: 'javascript:alert(1)',
  };
}

describe('card error isolation', () => {
  it('a card with malformed data fails alone; its sibling still renders', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const common = { now: Date.now(), privacy: false, onRefresh: () => undefined, refreshing: false };
    const malformed = env('lta', { stops: 'not-an-array' } as unknown as BusData);
    const weather = env<WeatherData>('weather', {
      area: 'Bedok',
      forecast: 'Fair',
      validFrom: null,
      validUntil: new Date(Date.now() + 3600_000).toISOString(),
      issuedAt: null,
      availableAreas: ['Bedok'],
    });
    render(
      <MemoryRouter>
        <ErrorBoundary label="Bus">
          <BusCard env={malformed} {...common} />
        </ErrorBoundary>
        <ErrorBoundary label="Weather">
          <WeatherCard env={weather} {...common} />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText(/This card could not be displayed/)).toBeTruthy();
    expect(screen.getByText('Fair')).toBeTruthy();
    // javascript: detail URL is never rendered as a link
    expect(screen.queryByText(/Open in/)).toBeNull();
  });
});
