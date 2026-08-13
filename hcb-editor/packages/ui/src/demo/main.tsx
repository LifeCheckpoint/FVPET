import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppShell } from '../components/AppShell.js';
import '../theme/tokens.css';
import '../styles/ui.css';
import '@xyflow/react/dist/style.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <AppShell />
    </StrictMode>,
  );
}
