import type { CanvasData, CanvasItem, WidgetEnvelope } from '../../../shared/contracts';
import { canvasCoverageLabel, groupCanvasItems } from '../../../shared/display/canvas';
import { MASK } from '../../../shared/display/privacy';
import { relativeDue } from '../../../shared/display/time';
import { safeExternalUrl } from '../../../shared/display/url';
import Card, { hasData, type WidgetProps } from './Card';

type Tone = 'warn' | 'bad' | 'info' | 'idle' | 'ok';

function Item({ item, when, privacy, status, tone }: { item: CanvasItem; when: string; privacy: boolean; status: string; tone: Tone }) {
  const url = privacy ? null : safeExternalUrl(item.htmlUrl);
  const title = privacy ? MASK : item.title;
  return (
    <li className="row">
      <div className="row-main">
        <span className="row-title">
          {url ? (
            <a href={url} target="_blank" rel="noopener noreferrer">
              {title}
            </a>
          ) : (
            title
          )}
        </span>
        <span className="muted row-sub">
          {privacy ? MASK : (item.courseName ?? 'No course')}
          {when && <span className="row-when"> · {when}</span>}
        </span>
      </div>
      <span className="pill">
        <i className={`dot dot-${tone}`} aria-hidden="true" />
        {status}
      </span>
    </li>
  );
}

function CanvasBody({ data, now, privacy }: { data: CanvasData; now: number; privacy: boolean }) {
  const g = groupCanvasItems(data.items, now);
  const none = g.dueSoon.length + g.pastDue.length + g.reminders.length + g.noDue.length === 0;
  return (
    <>
      <p className="coverage muted">{canvasCoverageLabel(data)}</p>
      {none && <p className="empty">Nothing due in this window.</p>}
      {!none && (
        <>
          <div className="table-head" aria-hidden="true">
            <span>Item · due</span>
            <span>Status</span>
          </div>
          <ul className="plain table">
            {g.dueSoon.map((i) => (
              <Item key={i.id} item={i} privacy={privacy} when={relativeDue(i.dueAt, now)} status="Due soon" tone="warn" />
            ))}
            {g.pastDue.map((i) => (
              <Item key={i.id} item={i} privacy={privacy} when={relativeDue(i.dueAt, now)} status="Past due — check status" tone="bad" />
            ))}
            {g.reminders.map((i) => (
              <Item key={i.id} item={i} privacy={privacy} when={i.plannerDate ? relativeDue(i.plannerDate, now) : ''} status="Reminder" tone="info" />
            ))}
            {g.noDue.map((i) => (
              <Item key={i.id} item={i} privacy={privacy} when="" status="No due date" tone="idle" />
            ))}
          </ul>
        </>
      )}
      {g.done.length > 0 && (
        <details className="group">
          <summary>Submitted/complete ({g.done.length})</summary>
          <ul className="plain table">
            {g.done.map((i) => (
              <Item key={i.id} item={i} privacy={privacy} when="" status="Done" tone="ok" />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

export default function CanvasCard(props: WidgetProps<CanvasData>) {
  const { env, now, privacy } = props;
  return (
    <Card provider="canvas" {...props} env={env as WidgetEnvelope}>
      {hasData(env) && <CanvasBody data={env.data} now={now} privacy={privacy} />}
    </Card>
  );
}
