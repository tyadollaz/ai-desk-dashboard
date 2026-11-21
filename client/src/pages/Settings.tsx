import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PROVIDER_IDS, type ProviderId, type Settings, type SettingsResponse, type WidgetId } from '../../../shared/contracts';
import { ApiError, api } from '../api';
import { providerName } from '../components/Card';
import Shell from '../components/Shell';

interface StopDraft {
  code: string;
  nickname: string;
  services: string;
}

const WIDGET_NAMES: Record<WidgetId, string> = {
  calendar: 'Calendar (Google)',
  canvas: 'Canvas deadlines',
  lta: 'Bus arrivals',
  weather: 'Weather',
  garmin: 'Garmin activity',
};

function describeIssues(body: unknown): string[] {
  const issues = body && typeof body === 'object' && 'issues' in body ? (body as { issues: unknown }).issues : null;
  if (!Array.isArray(issues)) return [];
  return issues.map((i) => {
    if (typeof i === 'string') return i;
    if (i && typeof i === 'object') {
      const o = i as { path?: unknown; message?: unknown };
      const path = Array.isArray(o.path) ? o.path.join('.') : '';
      const msg = typeof o.message === 'string' ? o.message : 'Invalid value';
      return path ? `${path}: ${msg}` : msg;
    }
    return 'Invalid value';
  });
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [resp, setResp] = useState<SettingsResponse | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [stops, setStops] = useState<StopDraft[]>([]);
  const [areas, setAreas] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);

  function adopt(r: SettingsResponse) {
    setResp(r);
    setDraft(r.settings);
    setStops(r.settings.bus.stops.map((s) => ({ code: s.code, nickname: s.nickname ?? '', services: s.services.join(', ') })));
  }

  useEffect(() => {
    let cancelled = false;
    api
      .settings()
      .then((r) => !cancelled && adopt(r))
      .catch(() => !cancelled && setLoadError('Could not load settings.'));
    api
      .dashboard()
      .then((d) => !cancelled && setAreas(d.envelopes.weather.data?.availableAreas ?? []))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* leave anyway */
    }
    navigate('/login', { replace: true });
  }

  if (loadError) return <p className="boot form-error">{loadError}</p>;
  if (!draft || !resp)
    return (
      <p className="boot" role="status">
        Loading settings…
      </p>
    );

  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });

  function moveWidget(i: number, dir: -1 | 1) {
    if (!draft) return;
    const w = [...draft.widgets];
    const j = i + dir;
    const a = w[i];
    const b = w[j];
    if (!a || !b) return;
    w[i] = b;
    w[j] = a;
    set({ widgets: w });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    setIssues([]);
    const settings: Settings = {
      ...draft,
      bus: {
        stops: stops.map((s) => ({
          code: s.code,
          nickname: s.nickname.trim() === '' ? null : s.nickname.trim(),
          services: s.services
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
        })),
      },
      calendar: { calendarIds: draft.calendar.calendarIds.map((c) => c.trim()).filter(Boolean) },
    };
    try {
      adopt(await api.patchSettings(settings));
      setMessage('Settings saved.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const list = describeIssues(err.body);
        setIssues(list.length ? list : [err.message]);
        setMessage('Settings were not saved. Fix the problems below.');
      } else setMessage('Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function disconnect(id: ProviderId) {
    if (!window.confirm(`Disconnect ${providerName(id)}? Stored credentials and cached data for it will be removed.`)) return;
    try {
      await api.disconnect(id);
      adopt(await api.settings());
      setMessage(`${providerName(id)} disconnected.`);
    } catch {
      setMessage(`Could not disconnect ${providerName(id)}.`);
    }
  }

  const areaOptions = [...new Set([...(draft.weather.area ? [draft.weather.area] : []), ...areas])].sort();

  return (
    <Shell onLogout={() => void logout()}>
      <div className="page settings">
        <header className="page-head">
          <h1>Settings</h1>
          <Link className="btn" to="/">
            Back to dashboard
          </Link>
        </header>
        <form onSubmit={save} className="settings-form">
          <fieldset>
            <legend>Widgets</legend>
            <ul className="plain">
              {draft.widgets.map((w, i) => (
                <li key={w.id} className="setting-row">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={w.visible}
                      onChange={(e) => set({ widgets: draft.widgets.map((x) => (x.id === w.id ? { ...x, visible: e.target.checked } : x)) })}
                    />
                    {WIDGET_NAMES[w.id]}
                  </label>
                  <span className="btn-group">
                    <button
                      type="button"
                      className="btn"
                      disabled={i === 0}
                      onClick={() => moveWidget(i, -1)}
                      aria-label={`Move ${WIDGET_NAMES[w.id]} up`}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={i === draft.widgets.length - 1}
                      onClick={() => moveWidget(i, 1)}
                      aria-label={`Move ${WIDGET_NAMES[w.id]} down`}
                    >
                      Down
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </fieldset>

          <fieldset>
            <legend>Bus stops (up to 3)</legend>
            {stops.map((s, i) => (
              <div key={i} className="stop-edit">
                <label>
                  Stop code (5 digits)
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="\d{5}"
                    maxLength={5}
                    value={s.code}
                    onChange={(e) => setStops(stops.map((x, j) => (j === i ? { ...x, code: e.target.value.replace(/\D/g, '') } : x)))}
                  />
                </label>
                <label>
                  Nickname
                  <input
                    type="text"
                    maxLength={40}
                    value={s.nickname}
                    onChange={(e) => setStops(stops.map((x, j) => (j === i ? { ...x, nickname: e.target.value } : x)))}
                  />
                </label>
                <label>
                  Services (comma-separated, blank for all)
                  <input
                    type="text"
                    placeholder="e.g. 36, 36A, 124"
                    value={s.services}
                    onChange={(e) => setStops(stops.map((x, j) => (j === i ? { ...x, services: e.target.value } : x)))}
                  />
                </label>
                <button type="button" className="btn" onClick={() => setStops(stops.filter((_, j) => j !== i))}>
                  Remove stop
                </button>
              </div>
            ))}
            {stops.length < 3 && (
              <button type="button" className="btn" onClick={() => setStops([...stops, { code: '', nickname: '', services: '' }])}>
                Add bus stop
              </button>
            )}
          </fieldset>

          <fieldset>
            <legend>Weather area</legend>
            {areaOptions.length === 0 ? (
              <p className="muted">Forecast areas appear here after the first weather fetch. Wait a moment, then reload this page.</p>
            ) : (
              <label>
                Forecast area
                <select value={draft.weather.area ?? ''} onChange={(e) => set({ weather: { area: e.target.value === '' ? null : e.target.value } })}>
                  <option value="">Not chosen</option>
                  {areaOptions.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>

          <fieldset>
            <legend>Google Calendar IDs</legend>
            {draft.calendar.calendarIds.map((c, i) => (
              <div key={i} className="inline-row">
                <input
                  type="text"
                  aria-label={`Calendar ID ${i + 1}`}
                  value={c}
                  onChange={(e) => set({ calendar: { calendarIds: draft.calendar.calendarIds.map((x, j) => (j === i ? e.target.value : x)) } })}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={draft.calendar.calendarIds.length <= 1}
                  onClick={() => set({ calendar: { calendarIds: draft.calendar.calendarIds.filter((_, j) => j !== i) } })}
                >
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => set({ calendar: { calendarIds: [...draft.calendar.calendarIds, ''] } })}>
              Add calendar ID
            </button>
            <p className="muted">Use "primary" for your main calendar.</p>
          </fieldset>

          <fieldset>
            <legend>Providers</legend>
            <ul className="plain">
              {PROVIDER_IDS.map((id) => {
                const setup = resp.providerSetup[id];
                return (
                  <li key={id} className="provider-row">
                    <div>
                      <strong>{providerName(id)}</strong>
                      <p className="muted">{setup.configured ? 'Configured' : `Setup needed: ${setup.requirement ?? 'not configured'}`}</p>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={draft.providers[id].enabled}
                        onChange={(e) => set({ providers: { ...draft.providers, [id]: { enabled: e.target.checked } } })}
                      />
                      Enabled
                    </label>
                    <span className="btn-group">
                      {id === 'google' && (
                        <a className="btn" href="/api/google/connect">
                          Connect Google Calendar
                        </a>
                      )}
                      <button type="button" className="btn" onClick={() => void disconnect(id)}>
                        Disconnect
                      </button>
                    </span>
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <fieldset>
            <legend>Privacy</legend>
            <label className="check">
              <input type="checkbox" checked={draft.privacy.enabled} onChange={(e) => set({ privacy: { enabled: e.target.checked } })} />
              Privacy mode (mask event and assignment titles, course names and health values)
            </label>
          </fieldset>

          <fieldset>
            <legend>AI briefing</legend>
            <label className="check">
              <input type="checkbox" checked={draft.ai.enabled} onChange={(e) => set({ ai: { ...draft.ai, enabled: e.target.checked } })} />
              Enable AI briefing
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.ai.includeTitles}
                onChange={(e) => set({ ai: { ...draft.ai, includeTitles: e.target.checked } })}
              />
              Include calendar and Canvas titles
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={draft.ai.includeHealth}
                onChange={(e) => set({ ai: { ...draft.ai, includeHealth: e.target.checked } })}
              />
              Include Garmin health data (off by default)
            </label>
            <p className="muted">
              Titles and health data are sent to an external model only if you tick the boxes above. Nothing is sent while AI briefing is disabled.
            </p>
            <p className="disclosure">{resp.aiDisclosure}</p>
          </fieldset>

          {message && <p role="status">{message}</p>}
          {issues.length > 0 && (
            <ul className="form-error" role="alert">
              {issues.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </form>
      </div>
    </Shell>
  );
}
