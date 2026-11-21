import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/geist';
import App from './App';
import { applyTheme, readTheme } from './theme';
import './styles.css';

// Apply the saved theme before the first render so there is no flash of the wrong one.
applyTheme(readTheme());

const el = document.getElementById('root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}
