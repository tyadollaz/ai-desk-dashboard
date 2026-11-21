import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DashboardResponse, ProviderId, RefreshResponse, Settings, WidgetId } from '../../../shared/contracts';
import { ApiError, api } from '../api';
import BriefingStrip from '../components/BriefingStrip';
import BusCard from '../components/BusCard';
import CalendarCard from '../components/CalendarCard';
import CanvasCard from '../components/CanvasCard';
import ErrorBoundary from '../components/ErrorBoundary';
import GarminCard from '../components/GarminCard';
import Header from '../components/Header';
import Shell from '../components/Shell';
import WeatherCard from '../components/WeatherCard';
import { useNow } from '../useNow';

const PROVIDER_FOR: Record<WidgetId, ProviderId> = {
  calendar: 'google',
  canvas: 'canvas',
  lta: 'lta',
  weather: 'weather',
  garmin: 'garmin',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const now = useNow();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Set<ProviderId>>(new Set());
  const [statuses, setStatuses] = useState<Partial<Record<ProviderId, RefreshResponse['status']>>>({});
  const [refreshingAll, setRefreshingAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.dashboard());
      setError(null);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) setError('Could not reach the server. Showing the last data received.');
    }
  }, []);

  // Poll every 15 s while visible; pause when hidden; fetch immediately on becoming visible.
  useEffect(() => {
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      void load();
      timer = window.setInterval(() => void load(), 15_000);
    };
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop());
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    api
      .settings()
      .then((r) => !cancelled && setSettings(r.settings))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshOne(id: ProviderId) {
    setBusy((b) => new Set(b).add(id));
    try {
      const r = await api.refresh(id);
      setStatuses((s) => ({ ...s, [id]: r.status }));
    } catch {
      /* the next dashboard load shows the provider's error state */
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(id);
        return n;
      });
      void load();
    }
  }

  async function refreshAll() {
    setRefreshingAll(true);
    const ids = settings?.widgets.filter((w) => w.visible).map((w) => PROVIDER_FOR[w.id]) ?? [];
    await Promise.all(ids.map((id) => refreshOne(id)));
    setRefreshingAll(false);
  }

  async function togglePrivacy() {
    if (!settings) return;
    const next = { enabled: !settings.privacy.enabled };
    setSettings({ ...settings, privacy: next });
    try {
      const r = await api.patchSettings({ privacy: next });
      setSettings(r.settings);
    } catch {
      setSettings(settings);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      /* leave anyway */
    }
    setData(null);
    setSettings(null);
    navigate('/login', { replace: true });
  }

  async function generate() {
    try {
      await api.briefing();
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.message);
      throw e;
    }
    await load();
  }

  // Fail closed: keep titles and health values masked until the owner's privacy setting has loaded.
  const privacy = settings ? settings.privacy.enabled : true;
  const widgets = settings?.widgets.filter((w) => w.visible) ?? [];

  function renderWidget(id: WidgetId) {
    if (!data) return null;
    const pid = PROVIDER_FOR[id];
    const common = {
      now,
      privacy,
      onRefresh: () => void refreshOne(pid),
      refreshing: busy.has(pid),
      refreshStatus: statuses[pid],
    };
    switch (id) {
      case 'calendar':
        return <CalendarCard env={data.envelopes.google} {...common} />;
      case 'canvas':
        return <CanvasCard env={data.envelopes.canvas} {...common} />;
      case 'lta':
        return <BusCard env={data.envelopes.lta} {...common} />;
      case 'weather':
        return <WeatherCard env={data.envelopes.weather} {...common} />;
      case 'garmin':
        return <GarminCard env={data.envelopes.garmin} {...common} />;
    }
  }

  return (
    <Shell
      onLogout={() => void logout()}
      dashboard={{
        privacy,
        onTogglePrivacy: () => void togglePrivacy(),
        onRefreshAll: () => void refreshAll(),
        refreshingAll,
      }}
    >
      <div className="page">
        <Header now={now} />
        {data?.mode === 'demo' && (
          <p className="banner" role="status">
            Demo mode — synthetic data, no provider is connected
          </p>
        )}
        {error && (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        )}
        {!data ? (
          <p className="boot" role="status">
            Loading dashboard…
          </p>
        ) : (
          <>
            {settings && widgets.length === 0 && <p className="empty">All widgets are hidden. Turn some on in Settings.</p>}
            <main className="grid">
              <div className="cell cell-briefing">
                <BriefingStrip overview={data.overview} aiBriefing={data.aiBriefing} ai={data.ai} privacy={privacy} onGenerate={generate} />
              </div>
              {widgets.map((w) => (
                <div key={w.id} className={`cell cell-${w.id}`}>
                  <ErrorBoundary label={w.id}>{renderWidget(w.id)}</ErrorBoundary>
                </div>
              ))}
            </main>
          </>
        )}
      </div>
    </Shell>
  );
}
