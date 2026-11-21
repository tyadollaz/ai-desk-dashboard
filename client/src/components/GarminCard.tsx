import type { GarminData, WidgetEnvelope } from '../../../shared/contracts';
import { garminView } from '../../../shared/display/garmin';
import { MASK } from '../../../shared/display/privacy';
import Card, { hasData, type WidgetProps } from './Card';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function GarminBody({ data, now, privacy }: { data: GarminData; now: number; privacy: boolean }) {
  const v = garminView(data, now);
  const m = (s: string) => (privacy ? MASK : s);
  return (
    <dl className="stats">
      {v.latest ? (
        <div className="stat wide">
          <dt>Latest activity</dt>
          <dd>
            {m(`${v.latest.type} · ${v.latest.start} · ${v.latest.duration} · ${v.latest.distance}`)}
          </dd>
        </div>
      ) : (
        <div className="stat wide">
          <dt>Latest activity</dt>
          <dd>{m('No recent activity')}</dd>
        </div>
      )}
      <Stat label={v.week.label} value={m(v.week.running)} />
      {v.week.partial && (
        <div className="stat wide">
          <dt className="status-problem">Partial week data</dt>
        </div>
      )}
      <Stat label={v.steps.label} value={m(v.steps.value)} />
      <Stat label={v.sleep.label} value={m(v.sleep.value)} />
      {v.restingHr && <Stat label={v.restingHr.label} value={m(v.restingHr.value)} />}
    </dl>
  );
}

export default function GarminCard(props: WidgetProps<GarminData>) {
  const { env, now, privacy } = props;
  return (
    <Card provider="garmin" {...props} env={env as WidgetEnvelope}>
      {hasData(env) && <GarminBody data={env.data} now={now} privacy={privacy} />}
    </Card>
  );
}
