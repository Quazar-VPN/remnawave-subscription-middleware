// Четыре режима темы как в легаси: system / light / dark / black(OLED).
// Mantine знает только light/dark/auto, поэтому «чёрную» держим отдельным
// флагом data-oled на <html> поверх dark-схемы.
import type { MantineColorScheme } from '@mantine/core';

export type ThemeMode = 'auto' | 'light' | 'dark' | 'black';

const OLED_KEY = 'submw-oled';

export function loadOled(): boolean {
  try {
    return localStorage.getItem(OLED_KEY) === '1';
  } catch {
    return false;
  }
}

function setOled(on: boolean) {
  try {
    localStorage.setItem(OLED_KEY, on ? '1' : '0');
  } catch {
    /* приватный режим — не критично */
  }
  document.documentElement.setAttribute('data-oled', on ? '1' : '0');
}

export function applyOledFromStorage() {
  document.documentElement.setAttribute('data-oled', loadOled() ? '1' : '0');
}

// Текущий режим = комбинация Mantine-схемы и oled-флага.
export function currentMode(scheme: MantineColorScheme): ThemeMode {
  if (loadOled() && scheme === 'dark') return 'black';
  if (scheme === 'auto') return 'auto';
  return scheme === 'light' ? 'light' : 'dark';
}

// Возвращает Mantine-схему, которую надо выставить для выбранного режима.
export function applyMode(mode: ThemeMode): MantineColorScheme {
  if (mode === 'black') {
    setOled(true);
    return 'dark';
  }
  setOled(false);
  return mode; // auto | light | dark
}
