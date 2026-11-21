import { useState } from 'react';
import type { CalendarData, CalendarEvent, WidgetEnvelope } from '../../../shared/contracts';
import {
  eventEndMs,
  eventStartMs,
  eventTimeLabel,
  eventWhenLabel,
  groupByDay,
  nextEvent,
  todaysAgenda,
} from '../../../shared/display/calendar';
import { MASK } from '../../../shared/display/privacy';
import { DAY_MS, dateKeyToMs, relativeDue, sgDateKey } from '../../../shared/display/time';
import { safeExternalUrl } from '../../../shared/display/url';
import Card, { hasData, type WidgetProps } from './Card';

function titleOf(e: CalendarEvent, privacy: boolean): string {
  return privacy ? MASK : (e.title ?? '(No title)');
}

const STRIP_START_H = 7;
const STRIP_END_H = 23;
const TICKS = [8, 12, 16, 20];

/** Today's timed events (SGT, 07:00-23:00) as blocks on a strip, with a marker for the current time. */
function DayStrip({ events, now, privacy }: { events: CalendarEvent[]; now: number; privacy: boolean }) {
  const dayStart = dateKeyToMs(sgDateKey(now));
  const from = dayStart + STRIP_START_H * 3600_000;
  const to = dayStart + STRIP_END_H * 3600_000;
  const span = to - from;
  const pct = (ms: number) => ((Math.min(to, Math.max(from, ms)) - from) / span) * 100;
  const timed = events
    .filter((e) => !e.allDay && eventEndMs(e) > from && eventStartMs(e) < Math.min(to, dayStart + DAY_MS))
    .map((e) => ({ e, left: pct(eventStartMs(e)), right: pct(eventEndMs(e)), lane: 0 }));
  const laneEnds: number[] = [];
  for (const b of timed) {
    let lane = laneEnds.findIndex((end) => end <= b.left);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = b.right;
    b.lane = lane;
  }
  const lanes = Math.max(1, laneEnds.length);
  const nowPct = now >= from && now <= to ? pct(now) : null;
  return (
    <div className="strip" role="img" aria-label={`Today's timeline, ${timed.length} timed ${timed.length === 1 ? 'event' : 'events'}`}>
      <div className="strip-track" style={{ height: `${lanes * 18 + 8}px` }}>
        {TICKS.map((h) => (
          <i key={h} className="strip-tick" style={{ left: `${((h - STRIP_START_H) / (STRIP_END_H - STRIP_START_H)) * 100}%` }} />
        ))}
        {timed.map(({ e, left, right, lane }) => (
          <span
            key={e.id}
            className={`strip-block ${eventEndMs(e) <= now ? 'ended' : ''}`}
            title={`${eventTimeLabel(e)} ${titleOf(e, privacy)}`}
            style={{ left: `${left}%`, width: `${Math.max(1.5, right - left)}%`, top: `${4 + lane * 18}px` }}
          />
        ))}
        {nowPct !== null && (
          <span className="strip-now" style={{ left: `${nowPct}%` }} />
        )}
      </div>
      <div className="strip-labels">
        {TICKS.map((h) => (
          <span key={h} style={{ left: `${((h - STRIP_START_H) / (STRIP_END_H - STRIP_START_H)) * 100}%` }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  );
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
      <DayStrip events={agenda} now={now} privacy={privacy} />
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
