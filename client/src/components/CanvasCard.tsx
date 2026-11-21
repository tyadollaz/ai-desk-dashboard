import type { CanvasData, CanvasItem, WidgetEnvelope } from '../../../shared/contracts';
import { canvasCoverageLabel, groupCanvasItems } from '../../../shared/display/canvas';
import { MASK } from '../../../shared/display/privacy';
import { relativeDue } from '../../../shared/display/time';
import { safeExternalUrl } from '../../../shared/display/url';
import Card, { hasData, type WidgetProps } from './Card';

function Item({ item, when, privacy }: { item: CanvasItem; when: string; privacy: boolean }) {
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
        <span className="muted">{privacy ? MASK : (item.courseName ?? 'No course')}</span>
      </div>
      {when && <span className="row-when">{when}</span>}
    </li>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="group">
      <h3>{title}</h3>
      <ul className="plain">{children}</ul>
    </div>
  );
}

function CanvasBody({ data, now, privacy }: { data: CanvasData; now: number; privacy: boolean }) {
  const g = groupCanvasItems(data.items, now);
  const none = g.dueSoon.length + g.pastDue.length + g.reminders.length + g.noDue.length === 0;
  return (
    <>
      <p className="coverage muted">{canvasCoverageLabel(data)}</p>
      {none && <p className="empty">Nothing due in this window.</p>}
      {g.dueSoon.length > 0 && (
        <Group title="Due soon">
          {g.dueSoon.map((i) => (
            <Item key={i.id} item={i} privacy={privacy} when={relativeDue(i.dueAt, now)} />
          ))}
        </Group>
      )}
      {g.pastDue.length > 0 && (
        <Group title="Past due — check status">
          {g.pastDue.map((i) => (
            <Item key={i.id} item={i} privacy={privacy} when={relativeDue(i.dueAt, now)} />
          ))}
        </Group>
      )}
      {g.reminders.length > 0 && (
        <Group title="Reminders">
          {g.reminders.map((i) => (
            <Item key={i.id} item={i} privacy={privacy} when={i.plannerDate ? relativeDue(i.plannerDate, now) : ''} />
          ))}
        </Group>
      )}
      {g.noDue.length > 0 && (
        <Group title="No due date">
          {g.noDue.map((i) => (
            <Item key={i.id} item={i} privacy={privacy} when="" />
          ))}
        </Group>
      )}
      {g.done.length > 0 && (
        <details className="group">
          <summary>Submitted/complete ({g.done.length})</summary>
          <ul className="plain">
            {g.done.map((i) => (
              <Item key={i.id} item={i} privacy={privacy} when="" />
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
