import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, localStorageColorSchemeManager } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

import '@mantine/core/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/notifications/styles.css';
import './global.css';

import { theme } from './theme';
import { App } from './App';
import { applyOledFromStorage } from './themeMode';

// Восстанавливаем OLED-флаг до первой отрисовки, чтобы не мигал фон.
applyOledFromStorage();

const colorSchemeManager = localStorageColorSchemeManager({ key: 'submw-color-scheme' });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto" colorSchemeManager={colorSchemeManager}>
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </React.StrictMode>
);
