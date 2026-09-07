import { Suspense } from 'react';
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Burger,
  Center,
  Code,
  Group,
  Loader,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconLogout, IconExternalLink } from '@tabler/icons-react';
import type { Bootstrap } from '../api';
import { logout } from '../api';
import { useTab } from '../hooks';
import { NAV, findTab, legacyUrl } from '../tabs/registry';
import { ThemeControl } from './ThemeControl';

export function Shell({
  boot,
  onUnauthorized,
}: {
  boot: Bootstrap;
  onUnauthorized: () => void;
}) {
  const [opened, { toggle, close }] = useDisclosure();
  const [tab, setTab] = useTab('sysinfo');

  const active = findTab(tab);
  const Component = active?.component;

  async function doLogout() {
    try {
      await logout();
    } catch {
      /* всё равно возвращаемся к логину */
    }
    onUnauthorized();
  }

  function openTab(id: string) {
    const def = findTab(id);
    if (def?.component) {
      setTab(id);
      close();
    } else {
      // Немигрированный таб — уходим в легаси-админку.
      window.location.href = legacyUrl(id);
    }
  }

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 270, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={4} lineClamp={1}>
              {active?.label ?? 'Админка'}
            </Title>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Badge variant="light" color="teal" visibleFrom="xs" style={{ textTransform: 'none' }}>
              {boot.mode === 'panel' ? 'panel' : 'mirror'}
            </Badge>
            <Tooltip label="Выйти">
              <ActionIcon variant="subtle" color="gray" onClick={doLogout} aria-label="Выйти">
                <IconLogout size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <AppShell.Section grow component={ScrollArea}>
          <Stack gap="lg">
            {NAV.map((section) => (
              <Box key={section.label}>
                <Text size="xs" fw={700} c="dimmed" tt="uppercase" px="xs" mb={4} style={{ letterSpacing: '.06em' }}>
                  {section.label}
                </Text>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const migrated = !!item.component;
                  return (
                    <NavLink
                      key={item.id}
                      active={item.id === tab && migrated}
                      label={item.label}
                      leftSection={<Icon size={18} stroke={1.6} />}
                      rightSection={
                        migrated ? undefined : <IconExternalLink size={14} opacity={0.5} />
                      }
                      onClick={() => openTab(item.id)}
                      variant="filled"
                    />
                  );
                })}
              </Box>
            ))}
          </Stack>
        </AppShell.Section>

        <AppShell.Section pt="sm">
          <Stack gap="xs">
            <ThemeControl />
            <Group justify="space-between" px={4}>
              <Text size="xs" c="dimmed">
                Версия
              </Text>
              <Code fz="xs">{boot.version.slice(0, 7) || 'dev'}</Code>
            </Group>
          </Stack>
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        {Component ? (
          <Suspense fallback={<Center h={240}><Loader color="teal" /></Center>}>
            <Component />
          </Suspense>
        ) : (
          <Text c="dimmed">
            Этот раздел ещё не перенесён в новую панель.{' '}
            <a href={legacyUrl(tab)}>Открыть в старой админке →</a>
          </Text>
        )}
      </AppShell.Main>
    </AppShell>
  );
}
