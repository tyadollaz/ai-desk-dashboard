import type { BusData, BusStop } from '../../../shared/contracts';
import { busArrivalViews, isBusStale, occupancyText } from '../../../shared/display/bus';
import { fmtTime } from '../../../shared/display/time';
import Card, { hasData, type WidgetProps } from './Card';
import type { BusLoad, WidgetEnvelope } from '../../../shared/contracts';
import Value from './Value';

/** Occupancy as 1-3 filled segments: seats available, standing available, limited standing. */
const LOADS: BusLoad[] = ['SEA', 'SDA', 'LSD'];
function loadLevel(label: string | null): number {
  const i = LOADS.findIndex((l) => occupancyText(l) === label);
  return i + 1;
}

function LoadMeter({ label }: { label: string }) {
  const level = loadLevel(label);
  if (level === 0) return null;
  return (
    <span className={`load load-${level}`} role="img" aria-label={label} title={label}>
      {[1, 2, 3].map((n) => (
        <i key={n} className={n <= level ? 'on' : ''} />
      ))}
    </span>
  );
}

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
                    <li key={i} className={`eta ${v.kind} ${i === 0 ? 'eta-first' : ''}`}>
                      <span className="num">
                        <Value text={v.text} />
                      </span>
                      {v.occupancy && <LoadMeter label={v.occupancy} />}
                      {v.scheduled && <span className="tag">Scheduled</span>}
                    </li>
                  ))}
                </ul>
              )}
              {!allUpdate && views[0]?.occupancy && <span className="occ-note">Next bus: {views[0].occupancy}</span>}
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
