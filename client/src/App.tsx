import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { api, setUnauthorizedHandler } from './api';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Settings from './pages/Settings';

/** Verifies the session once on mount; any 401 afterwards sends the user to /login. */
function AuthGate() {
  const navigate = useNavigate();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => navigate('/login', { replace: true }));
    let cancelled = false;
    api
      .session()
      .then((s) => {
        if (cancelled) return;
        if (s.authenticated) setOk(true);
        else navigate('/login', { replace: true });
      })
      .catch(() => {
        if (!cancelled) navigate('/login', { replace: true });
      });
    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, [navigate]);

  if (!ok) return <p className="boot" role="status">Loading…</p>;
  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<AuthGate />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
