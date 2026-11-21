import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useTheme, type ThemeChoice } from '../theme';
import Icon, { type IconName } from './Icon';

export interface DashboardActions {
  privacy: boolean;
  onTogglePrivacy: () => void;
  onRefreshAll: () => void;
  refreshingAll: boolean;
}

interface Props {
  children: ReactNode;
  onLogout: () => void;
  /** Present on the dashboard only: refresh-all and privacy controls. */
  dashboard?: DashboardActions;
}

const THEME_ICON: Record<ThemeChoice, IconName> = { light: 'sun', dark: 'moon', system: 'monitor' };
const THEME_LABEL: Record<ThemeChoice, string> = { light: 'Light', dark: 'Dark', system: 'System' };

/** Left rail on wide screens, a compact top row on narrow ones. The rail is the "Dashboard actions" nav. */
export default function Shell({ children, onLogout, dashboard }: Props) {
  const { theme, cycle } = useTheme();
  return (
    <div className="shell">
      <nav className="rail" aria-label="Dashboard actions">
        <span className="logo" aria-hidden="true">
          D
        </span>
        <NavLink end className="icon-btn rail-btn" to="/" aria-label="Dashboard" title="Dashboard">
          <Icon name="home" />
          <span className="sr-only">Dashboard</span>
        </NavLink>
        {dashboard && (
          <>
            <button
              type="button"
              className="icon-btn rail-btn"
              onClick={dashboard.onRefreshAll}
              disabled={dashboard.refreshingAll}
              aria-label="Refresh all"
              title="Refresh all"
            >
              <Icon name="refresh" />
              <span className="sr-only">Refresh all</span>
            </button>
            <button
              type="button"
              className="icon-btn rail-btn"
              aria-pressed={dashboard.privacy}
              onClick={dashboard.onTogglePrivacy}
              aria-label={`Privacy: ${dashboard.privacy ? 'On' : 'Off'}`}
              title={`Privacy: ${dashboard.privacy ? 'On' : 'Off'}`}
            >
              <Icon name={dashboard.privacy ? 'eye-off' : 'eye'} />
              <span className="sr-only">Privacy: {dashboard.privacy ? 'On' : 'Off'}</span>
            </button>
          </>
        )}
        <NavLink className="icon-btn rail-btn" to="/settings" aria-label="Settings" title="Settings">
          <Icon name="settings" />
          <span className="sr-only">Settings</span>
        </NavLink>
        <div className="spacer" />
        <button
          type="button"
          className="icon-btn rail-btn"
          onClick={cycle}
          aria-label={`Theme: ${THEME_LABEL[theme]}`}
          title={`Theme: ${THEME_LABEL[theme]} (click to change)`}
        >
          <Icon name={THEME_ICON[theme]} />
          <span className="sr-only">Theme: {THEME_LABEL[theme]}</span>
        </button>
        <button type="button" className="icon-btn rail-btn" onClick={onLogout} aria-label="Log out" title="Log out">
          <Icon name="logout" />
          <span className="sr-only">Log out</span>
        </button>
      </nav>
      <div className="content">{children}</div>
    </div>
  );
}
