import React from 'react';
import { createRoot } from 'react-dom/client';
import { AiDomainModelProvider } from './AiDomainModelContext';

import { App } from './App';
import { ChatGptAuthProvider } from './ChatGptAuthContext';
import { LlmProvider } from './LlmProviderContext';
import { ModelVisibilityProvider } from './ModelVisibilityContext';
import './styles.css';
import '../styles/ui-tokens.css';
import '../styles/ui-primitives.css';
import { bootstrapRendererTheme, ThemeProvider } from './ThemeProvider';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Renderer root element was not found.');
}

bootstrapRendererTheme();

// Platform flag for titlebar layout: macOS reserves room for the traffic lights
// inside the product chrome when the native titlebar is hidden.
const platform = navigator.platform.toLowerCase();
document.documentElement.dataset.platform = platform.includes('mac') ? 'darwin' : platform.includes('win') ? 'win32' : 'linux';

createRoot(rootElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <LlmProvider>
        <ChatGptAuthProvider>
            <AiDomainModelProvider>
            <ModelVisibilityProvider>
              <App />
            </ModelVisibilityProvider>
          </AiDomainModelProvider>
        </ChatGptAuthProvider>
      </LlmProvider>
    </ThemeProvider>
  </React.StrictMode>
);
