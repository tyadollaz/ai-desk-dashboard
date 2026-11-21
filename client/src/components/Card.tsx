import { useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ProviderId, RefreshResponse, WidgetEnvelope } from '../../../shared/contracts';
import { fmtTime } from '../../../shared/display/time';
import { safeExternalUrl } from '../../../shared/display/url';
import ErrorBoundary from './ErrorBoundary';
import Icon, { type IconName } from './Icon';

export interface WidgetProps<T> {
  env: WidgetEnvelope<T>;
  now: number;
  privacy: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  refreshStatus?: RefreshResponse['status'];
}

const LABELS: Record<ProviderId, { name: string; open: string }> = {
  lta: { name: 'Bus arrivals', open: 'LTA' },
  weather: { name: 'Weather', open: 'data.gov.sg' },
  canvas: { name: 'Canvas', open: 'Canvas' },
  google: { name: 'Google Calendar', open: 'Google Calendar' },
  garmin: { name: 'Garmin activity', open: 'Garmin Connect' },
};

const ICONS: Record<ProviderId, IconName> = {
  lta: 'bus',
  weather: 'cloud-sun',
  canvas: 'book',
  google: 'calendar',
  garmin: 'activity',
};

export function providerName(id: ProviderId): string {
  return LABELS[id].name;
}

/** Data is shown whenever it exists and the provider is not in a no-data state. */
export function hasData<T>(env: WidgetEnvelope<T>): env is WidgetEnvelope<T> & { data: T } {
  return env.data !== null && env.data !== undefined && !['needs_setup', 'unsupported', 'disabled'].includes(env.connection);
}

export function statusLines(env: WidgetEnvelope, now: number): string[] {
  const out: string[] = [];
  switch (env.connection) {
    case 'needs_setup':
      out.push(`Setup needed: ${env.error?.message ?? 'finish setup in Settings'}`);
      return out;
    case 'unsupported':
      out.push(`Not supported: ${env.error?.message ?? 'this provider is unavailable'}`);
      return out;
    case 'disabled':
      out.push('Disabled in Settings');
      return out;
    case 'reauth_required':
      out.push('Reconnect needed');
      break;
    default:
      break;
  }
  if (env.error && env.connection !== 'reauth_required') {
    out.push(`Error: ${env.error.message}${env.lastSuccessAt ? ` Showing data from ${fmtTime(env.lastSuccessAt)}.` : ''}`);
  } else if (env.error) {
    out.push(env.error.message);
  }
  if (env.freshness === 'expired') out.push('Expired');
  else if (env.freshness === 'stale') out.push(`Stale — last updated ${fmtTime(env.lastSuccessAt)}`);
  if (env.fetchState === 'fetching') out.push('Updating…');
  if (out.length === 0) {
    out.push(env.lastSuccessAt ? 'Up to date' : 'Waiting for first update');
  }
  void now;
  return out;
}

interface CardProps extends Omit<WidgetProps<unknown>, 'privacy'> {
  provider: ProviderId;
  className?: string;
  children?: ReactNode;
}

/** Marks the scroll area while more content is hidden below, so CSS can fade the bottom edge. */
function useOverflowMark<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      el.dataset.overflow = el.scrollHeight - el.scrollTop - el.clientHeight > 2 ? 'more' : 'none';
    };
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    el.addEventListener('scroll', check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', check);
    };
  });
  return ref;
}

export default function Card({ provider, env, now, onRefresh, refreshing, refreshStatus, className, children }: CardProps) {
  const bodyRef = useOverflowMark<HTMLDivElement>();
  const lines = statusLines(env, now);
  const detail = safeExternalUrl(env.detailUrl);
  const cooldownUntil = env.nextAllowedRefreshAt;
  const cooling = refreshStatus === 'cooldown';
  const canRefresh = env.connection !== 'needs_setup' && env.connection !== 'unsupported' && env.connection !== 'disabled';
  const problem = env.connection !== 'connected' || env.error !== null || env.freshness === 'stale' || env.freshness === 'expired';

  return (
    <section className={`card card-${provider} ${className ?? ''}`} aria-label={providerName(provider)}>
      <header className="card-head">
        <span className="tile" aria-hidden="true">
          <Icon name={ICONS[provider]} size={20} />
        </span>
        <h2>{providerName(provider)}</h2>
        {env.mode === 'demo' && <span className="badge">Demo</span>}
        <div className="spacer" />
        {env.lastSuccessAt && <span className="meta">Updated {fmtTime(env.lastSuccessAt)}</span>}
        {canRefresh && (
          <button
            type="button"
            className={`icon-btn ${refreshing ? 'spinning' : ''}`}
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={`Refresh ${providerName(provider)}`}
            title={refreshing ? 'Refreshing…' : `Refresh ${providerName(provider)}`}
          >
            <Icon name="refresh" size={18} />
          </button>
        )}
      </header>
      <div className={`status ${problem ? 'status-problem' : ''}`}>
        <span className="pill">
          <i className={`dot ${problem ? 'dot-warn' : 'dot-ok'}`} aria-hidden="true" />
          {lines.join(' · ')}
        </span>
        {env.connection === 'reauth_required' &&
          (provider === 'google' ? (
            <a className="btn small" href="/api/google/connect">
              Reconnect Google
            </a>
          ) : (
            <Link className="btn small" to="/settings">
              Reconnect in Settings
            </Link>
          ))}
        {(env.connection === 'needs_setup' || env.connection === 'unsupported' || env.connection === 'disabled') && (
          <Link className="btn small" to="/settings">
            Open Settings
          </Link>
        )}
      </div>
      <div className="card-body" ref={bodyRef}>
        <ErrorBoundary label={providerName(provider)}>{children}</ErrorBoundary>
      </div>
      <footer className="card-foot">
        <p className="times">
          {env.sourceUpdatedAt && <span>Source {fmtTime(env.sourceUpdatedAt)}</span>}
          <span>Fetched {env.lastSuccessAt ? fmtTime(env.lastSuccessAt) : 'never'}</span>
          {cooling && <span>Cooling down until {fmtTime(cooldownUntil)}</span>}
        </p>
        {detail && (
          <a href={detail} target="_blank" rel="noopener noreferrer" className="link">
            Open in {LABELS[provider].open}
            <Icon name="arrow-up-right" size={16} />
          </a>
        )}
      </footer>
    </section>
  );
}
