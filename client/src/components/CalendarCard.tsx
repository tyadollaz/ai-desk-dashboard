import { useState } from 'react';
import type { CalendarData, CalendarEvent, WidgetEnvelope } from '../../../shared/contracts';
import {
  eventEndMs,
  eventTimeLabel,
  eventWhenLabel,
  groupByDay,
  nextEvent,
  todaysAgenda,
} from '../../../shared/display/calendar';
import { MASK } from '../../../shared/display/privacy';
import { relativeDue } from '../../../shared/display/time';
import { safeExternalUrl } from '../../../shared/display/url';
import Card, { hasData, type WidgetProps } from './Card';

function titleOf(e: CalendarEvent, privacy: boolean): string {
  return privacy ? MASK : (e.title ?? '(No title)');
}

function EventRow({ e, now, privacy }: { e: CalendarEvent; now: number; privacy: boolean }) {
  const url = privacy ? null : safeExternalUrl(e.htmlLink);
  const t = titleOf(e, privacy);
  const ended = eventEndMs(e) <= now;
  return (
    <li className={`row ${ended ? 'ended' : ''}`}>
      <span className="row-when">{eventTimeLabel(e)}</span>
      <span className="row-title">
        {url ? (
          <a href={url} target="_blank" rel="noopener noreferrer">
            {t}
          </a>
        ) : (
          t
        )}
        {ended && <span className="tag">Ended</span>}
      </span>
    </li>
  );
}

function CalendarBody({ data, now, privacy }: { data: CalendarData; now: number; privacy: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const next = nextEvent(data.events, now);
  const agenda = todaysAgenda(data.events, now);
  const failed = data.calendars.filter((c) => !c.ok);
  return (
    <>
      {failed.map((c) => (
        <p key={c.calendarId} className="inline-error">
          Calendar {privacy ? MASK : c.calendarId}: {c.error?.message ?? 'could not be read'}
        </p>
      ))}
      {next ? (
        <div className="next">
          <p className="eyebrow">Next</p>
          <p className="big-text">{titleOf(next, privacy)}</p>
          <p className="muted">
            {eventWhenLabel(next)}
            {!next.allDay && ` · ${relativeDue(next.start.dateTime, now)}`}
          </p>
        </div>
      ) : (
        <p className="empty">No upcoming events in the next 7 days.</p>
      )}
      <div className="group">
        <h3>Today</h3>
        {agenda.length === 0 ? (
          <p className="muted">Nothing scheduled today.</p>
        ) : (
          <ul className="plain">
            {agenda.map((e) => (
              <EventRow key={e.id} e={e} now={now} privacy={privacy} />
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="btn small" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
        {expanded ? 'Hide 7-day view' : 'Show 7-day view'}
      </button>
      {expanded &&
        groupByDay(data.events).map((g) => (
          <div className="group" key={g.dayKey}>
            <h3>{g.label}</h3>
            <ul className="plain">
              {g.events.map((e) => (
                <EventRow key={e.id} e={e} now={now} privacy={privacy} />
              ))}
            </ul>
          </div>
        ))}
    </>
  );
}

export default function CalendarCard(props: WidgetProps<CalendarData>) {
  const { env, now, privacy } = props;
  return (
    <Card provider="google" {...props} env={env as WidgetEnvelope}>
      {hasData(env) && <CalendarBody data={env.data} now={now} privacy={privacy} />}
    </Card>
  );
}
