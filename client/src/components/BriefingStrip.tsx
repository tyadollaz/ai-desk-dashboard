import { useState } from 'react';
import type { Briefing, DashboardResponse } from '../../../shared/contracts';
import { bulletText } from '../../../shared/display/privacy';
import { fmtTime } from '../../../shared/display/time';
import Icon, { type IconName } from './Icon';

const SOURCE_ICON: Record<string, IconName> = { google: 'calendar', canvas: 'book', weather: 'cloud-sun', garmin: 'activity' };

const KEY = 'desk.briefingCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

interface Props {
  overview: Briefing;
  aiBriefing: Briefing | null;
  ai: DashboardResponse['ai'];
  privacy: boolean;
  onGenerate: () => Promise<void>;
}

export default function BriefingStrip({ overview, aiBriefing, ai, privacy, onGenerate }: Props) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = aiBriefing ?? overview;

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {
      /* preference only */
    }
  }

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      await onGenerate();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate a briefing.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="briefing" aria-label="Briefing">
      <div className="briefing-head">
        <span className="tile" aria-hidden="true">
          <Icon name="sparkle" size={20} />
        </span>
        <h2>{shown.kind === 'ai' ? 'AI briefing' : 'Overview'}</h2>
        <span className="meta">Generated {fmtTime(shown.generatedAt)}</span>
        <div className="spacer" />
        {ai.available && (
          <button type="button" className="btn small primary" onClick={generate} disabled={busy}>
            {busy ? 'Generating…' : `Generate AI briefing (${ai.remainingToday} left today)`}
          </button>
        )}
        <button type="button" className="btn small" aria-expanded={!collapsed} onClick={toggle}>
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!collapsed && (
        <>
          {shown.bullets.length === 0 ? (
            <p className="muted">Nothing to report yet.</p>
          ) : (
            <ul className="bullets">
              {shown.bullets.slice(0, 3).map((b, i) => (
                <li key={i} className={`tint tint-${(i % 3) + 1}`}>
                  <span className="li-icon" aria-hidden="true">
                    <Icon name={SOURCE_ICON[b.sources[0] ?? ''] ?? 'sparkle'} size={18} />
                  </span>
                  <div className="li-body">
                    <span>{bulletText(b, privacy)}</span>
                    {b.sources.length > 0 && (
                      <span className="chips">
                        {b.sources.map((src) => (
                          <span key={src} className="chip">
                            {src}
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {shown.notice && <p className="muted">{shown.notice}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
