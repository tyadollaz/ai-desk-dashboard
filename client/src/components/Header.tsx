import { fmtClock, fmtDateLong } from '../../../shared/display/time';

function greeting(now: number): string {
  const hour = Number(fmtClock(now).slice(0, 2));
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export default function Header({ now }: { now: number }) {
  return (
    <header className="app-header">
      <p className="greeting">{greeting(now)}</p>
      <p className="time" aria-label="Current time in Singapore">
        {fmtClock(now)}
      </p>
      <p className="date">{fmtDateLong(now)} · Singapore</p>
    </header>
  );
}
