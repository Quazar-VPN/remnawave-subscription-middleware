import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Бирюза «Квазар» — тот же тон, что в легаси-admin.css (--accent #14b8a6).
// Индекс 6 — базовый оттенок для filled-кнопок.
const teal: MantineColorsTuple = [
  '#e6fbf7',
  '#d0f5ee',
  '#a2ebdd',
  '#71e1cb',
  '#4cd8bc',
  '#35d3b3',
  '#22d0ad', // 6 — светлый акцент
  '#14b8a6', // 7 — базовый (совпадает с легаси dark --accent)
  '#0f9f90',
  '#0b8a7d',
];

export const theme = createTheme({
  primaryColor: 'teal',
  primaryShade: { light: 8, dark: 7 },
  colors: { teal },
  fontFamily: "'Onest', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  fontFamilyMonospace: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  defaultRadius: 'md',
  headings: {
    fontFamily: "'Onest', system-ui, sans-serif",
    fontWeight: '700',
  },
});
