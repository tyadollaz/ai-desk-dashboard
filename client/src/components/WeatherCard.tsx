import type { WeatherData, WidgetEnvelope } from '../../../shared/contracts';
import { weatherView } from '../../../shared/display/weather';
import Card, { hasData, type WidgetProps } from './Card';

function WeatherBody({ env, now }: { env: WidgetEnvelope<WeatherData> & { data: WeatherData }; now: number }) {
  const v = weatherView(env.data, env.validUntil, now);
  if (v.state === 'no_area') return <p className="empty">Choose a forecast area in Settings.</p>;
  if (v.state === 'empty') return <p className="empty">No forecast available for {v.area} yet.</p>;
  return (
    <div className="weather">
      <p className="muted">{v.area}</p>
      {v.state === 'ok' ? <p className="big-text">{v.forecast}</p> : <p className="big-text muted">Forecast expired</p>}
      <p className={v.state === 'expired' ? 'status-problem' : 'muted'}>{v.validity}</p>
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
