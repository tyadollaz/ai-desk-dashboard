import { useState } from 'react';
import type { Briefing, DashboardResponse } from '../../../shared/contracts';
import { bulletText } from '../../../shared/display/privacy';
import { fmtTime } from '../../../shared/display/time';

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
        <h2>{shown.kind === 'ai' ? 'AI briefing' : 'Overview'}</h2>
        <span className="muted">Generated {fmtTime(shown.generatedAt)}</span>
        <div className="spacer" />
        {ai.available && (
          <button type="button" className="btn small" onClick={generate} disabled={busy}>
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
                <li key={i}>
                  <span>{bulletText(b, privacy)}</span>{' '}
                  {b.sources.map((s) => (
                    <span key={s} className="chip">
                      {s}
                    </span>
                  ))}
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
