import type { ReactNode } from 'react';
import type { GarminData, WidgetEnvelope } from '../../../shared/contracts';
import { garminView } from '../../../shared/display/garmin';
import { MASK } from '../../../shared/display/privacy';
import Icon, { type IconName } from './Icon';
import Value from './Value';
import Card, { hasData, type WidgetProps } from './Card';

function Stat({ label, children, icon, wide = false }: { label: string; children: ReactNode; icon: IconName; wide?: boolean }) {
  return (
    <div className={`stat ${wide ? 'wide' : ''}`}>
      <dt>
        <span className="mini-tile" aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function GarminBody({ data, now, privacy }: { data: GarminData; now: number; privacy: boolean }) {
  const v = garminView(data, now);
  const val = (text: string, hm = false) => (privacy ? MASK : <Value text={text} hm={hm} />);
  const tiles: { key: string; label: string; icon: IconName; text: string; hm?: boolean }[] = [
    { key: 'week', label: v.week.label, icon: 'route', text: v.week.running },
    { key: 'steps', label: v.steps.label, icon: 'footprints', text: v.steps.value },
    { key: 'sleep', label: v.sleep.label, icon: 'bed', text: v.sleep.value, hm: true },
  ];
  if (v.restingHr) tiles.push({ key: 'hr', label: v.restingHr.label, icon: 'heart', text: v.restingHr.value });
  const oddLast = tiles.length % 2 === 1 ? tiles.length - 1 : -1;
  return (
    <dl className="stats">
      <Stat label="Latest activity" icon="activity" wide>
        {privacy ? (
          MASK
        ) : v.latest ? (
          <span className="activity">
            <span className="act-type">{v.latest.type}</span>
            <span className="act-nums">
              <span>
                <Value text={v.latest.distance} />
              </span>
              <span>
                <Value text={v.latest.duration} hm />
              </span>
            </span>
            <span className="act-when">{v.latest.start}</span>
          </span>
        ) : (
          'No recent activity'
        )}
      </Stat>
      {tiles.map((t, i) => (
        <Stat key={t.key} label={t.label} icon={t.icon} wide={i === oddLast}>
          {val(t.text, t.hm)}
        </Stat>
      ))}
      {v.week.partial && (
        <div className="stat wide">
          <dt className="status-problem">Partial week data</dt>
        </div>
      )}
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
