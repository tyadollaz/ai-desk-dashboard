import type { BusData, BusStop } from '../../../shared/contracts';
import { busArrivalViews, isBusStale } from '../../../shared/display/bus';
import { fmtTime } from '../../../shared/display/time';
import Card, { hasData, type WidgetProps } from './Card';
import type { WidgetEnvelope } from '../../../shared/contracts';

function Stop({ stop, now, stale }: { stop: BusStop; now: number; stale: boolean }) {
  return (
    <div className="bus-stop">
      <h3>
        {stop.nickname ? `${stop.nickname} ` : ''}
        <span className="muted">({stop.code})</span>
      </h3>
      {stop.error && <p className="inline-error">Error: {stop.error.message}</p>}
      {stop.services.length === 0 && !stop.error && <p className="muted">No services reported for this stop.</p>}
      <ul className="plain">
        {stop.services.map((s) => {
          const views = busArrivalViews(s.arrivals, now, stale);
          const allUpdate = stale && views.length > 0;
          return (
            <li key={s.serviceNo} className="bus-service">
              <span className="svc">{s.serviceNo}</span>
              {allUpdate ? (
                <span className="eta muted">Update needed</span>
              ) : views.length === 0 ? (
                <span className="eta muted">No estimate</span>
              ) : (
                <ul className="plain etas">
                  {views.map((v, i) => (
                    <li key={i} className={`eta ${v.kind}`}>
                      <span className="num">{v.text}</span>
                      {v.scheduled && <span className="tag">Scheduled</span>}
                      {v.occupancy && <span className="tag">{v.occupancy}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function BusCard(props: WidgetProps<BusData>) {
  const { env, now } = props;
  return (
    <Card provider="lta" {...props} env={env as WidgetEnvelope}>
      {hasData(env) && <BusBody env={env} now={now} />}
    </Card>
  );
}

function BusBody({ env, now }: { env: WidgetEnvelope<BusData> & { data: BusData }; now: number }) {
  const stale = isBusStale(env.lastSuccessAt, now);
  const stops = env.data.stops;
  if (stops.length === 0) return <p className="empty">No bus stops yet. Add up to three stops in Settings.</p>;
  return (
    <>
      {stale && <p className="status-problem">Update needed — last update {env.lastSuccessAt ? fmtTime(env.lastSuccessAt) : 'never'}</p>}
      {stops.map((s) => (
        <Stop key={s.code} stop={s} now={now} stale={stale} />
      ))}
    </>
  );
}
