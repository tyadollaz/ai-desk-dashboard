import type { WeatherData, WidgetEnvelope } from '../../../shared/contracts';
import { fmtTime, toMs } from '../../../shared/display/time';
import { weatherView } from '../../../shared/display/weather';
import Card, { hasData, type WidgetProps } from './Card';
import Icon, { type IconName } from './Icon';

/** Chooses a glyph from the forecast wording (e.g. "Thundery Showers", "Partly Cloudy (Night)"). */
export function weatherGlyph(forecast: string): IconName {
  const f = forecast.toLowerCase();
  if (/thunder|storm/.test(f)) return 'storm';
  if (/rain|shower|drizzle/.test(f)) return 'rain';
  if (/partly|fair|breezy|windy/.test(f)) return f.includes('night') ? 'cloud' : 'cloud-sun';
  if (/cloud|overcast|haz|mist|fog/.test(f)) return 'cloud';
  if (/sun|clear/.test(f)) return 'sun';
  return 'cloud-sun';
}

/** Share of the forecast's valid period that has elapsed, or null without a usable start and end. */
function elapsedFraction(data: WeatherData, now: number): number | null {
  const from = toMs(data.validFrom);
  const until = toMs(data.validUntil);
  if (from === null || until === null || until <= from) return null;
  return Math.min(1, Math.max(0, (now - from) / (until - from)));
}

function WeatherBody({ env, now }: { env: WidgetEnvelope<WeatherData> & { data: WeatherData }; now: number }) {
  const v = weatherView(env.data, env.validUntil, now);
  if (v.state === 'no_area') return <p className="empty">Choose a forecast area in Settings.</p>;
  if (v.state === 'empty') return <p className="empty">No forecast available for {v.area} yet.</p>;
  const frac = elapsedFraction(env.data, now);
  return (
    <div className="weather">
      <div className="weather-main">
        {v.state === 'ok' && (
          <span className="glyph" aria-hidden="true">
            <Icon name={weatherGlyph(v.forecast)} size={52} />
          </span>
        )}
        <div>
          <p className="eyebrow">{v.area}</p>
          {v.state === 'ok' ? <p className="big-text">{v.forecast}</p> : <p className="big-text muted">Forecast expired</p>}
        </div>
      </div>
      <div className="weather-foot">
        {frac !== null && (
          <div className="elapsed">
            <div
              className="bar"
              role="progressbar"
              aria-label="Forecast period elapsed"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(frac * 100)}
            >
              <i style={{ width: `${Math.round(frac * 100)}%` }} />
            </div>
            <div className="bar-ends">
              <span>{fmtTime(env.data.validFrom)}</span>
              <span>{fmtTime(env.data.validUntil)}</span>
            </div>
          </div>
        )}
        <p className={v.state === 'expired' ? 'status-problem' : 'muted'}>{v.validity}</p>
      </div>
    </div>
  );
}

export default function WeatherCard(props: WidgetProps<WeatherData>) {
  const { env, now } = props;
  return (
    <Card provider="weather" {...props} env={env as WidgetEnvelope}>
      {hasData(env) && <WeatherBody env={env} now={now} />}
    </Card>
  );
}
