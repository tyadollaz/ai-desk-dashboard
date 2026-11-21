import { Link } from 'react-router-dom';
import { fmtClock, fmtDateLong } from '../../../shared/display/time';

interface Props {
  now: number;
  privacy: boolean;
  onTogglePrivacy: () => void;
  onRefreshAll: () => void;
  refreshingAll: boolean;
  onLogout: () => void;
}

export default function Header({ now, privacy, onTogglePrivacy, onRefreshAll, refreshingAll, onLogout }: Props) {
  return (
    <header className="app-header">
      <div className="clock">
        <p className="time" aria-label="Current time in Singapore">
          {fmtClock(now)}
        </p>
        <p className="date">{fmtDateLong(now)} · Singapore</p>
      </div>
      <nav className="actions" aria-label="Dashboard actions">
        <button type="button" className="btn" onClick={onRefreshAll} disabled={refreshingAll}>
          {refreshingAll ? 'Refreshing…' : 'Refresh all'}
        </button>
        <button type="button" className="btn" aria-pressed={privacy} onClick={onTogglePrivacy}>
          Privacy: {privacy ? 'On' : 'Off'}
        </button>
        <Link className="btn" to="/settings">
          Settings
        </Link>
        <button type="button" className="btn" onClick={onLogout}>
          Log out
        </button>
      </nav>
    </header>
  );
}
