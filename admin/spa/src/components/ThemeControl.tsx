import { SegmentedControl, useMantineColorScheme } from '@mantine/core';
import { IconDeviceDesktop, IconSun, IconMoon, IconCircleFilled } from '@tabler/icons-react';
import { applyMode, currentMode, type ThemeMode } from '../themeMode';

// Четыре режима как в легаси: Авто / Светлая / Тёмная / Чёрная(OLED).
export function ThemeControl() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const mode = currentMode(colorScheme);

  const onChange = (value: string) => {
    setColorScheme(applyMode(value as ThemeMode));
  };

  const opt = (value: ThemeMode, Icon: typeof IconSun, label: string) => ({
    value,
    label: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <Icon size={14} />
        {label}
      </span>
    ),
  });

  return (
    <SegmentedControl
      size="xs"
      fullWidth
      value={mode}
      onChange={onChange}
      data={[
        opt('auto', IconDeviceDesktop, 'Авто'),
        opt('light', IconSun, 'День'),
        opt('dark', IconMoon, 'Ночь'),
        opt('black', IconCircleFilled, 'OLED'),
      ]}
    />
  );
}
