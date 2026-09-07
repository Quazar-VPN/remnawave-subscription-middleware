import { useCallback, useEffect, useState } from 'react';
import { Center, Loader, Stack, Text } from '@mantine/core';
import { fetchBootstrap, setCsrf, type Bootstrap } from './api';
import { Login } from './components/Login';
import { Shell } from './components/Shell';

export function App() {
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const b = await fetchBootstrap();
      setCsrf(b.csrf);
      setBoot(b);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (err) {
    return (
      <Center h="100vh" p="md">
        <Stack align="center" gap="xs">
          <Text c="red" fw={600}>
            Не удалось связаться с сервером
          </Text>
          <Text c="dimmed" size="sm">
            {err}
          </Text>
        </Stack>
      </Center>
    );
  }

  if (!boot) {
    return (
      <Center h="100vh">
        <Loader color="teal" />
      </Center>
    );
  }

  if (!boot.installed) {
    return (
      <Center h="100vh" p="md">
        <Stack align="center" gap="xs" maw={420}>
          <Text fw={600}>Прослойка ещё не установлена</Text>
          <Text c="dimmed" size="sm" ta="center">
            Пройдите первичную настройку в мастере{' '}
            <a href="/admin/">/admin/</a>, затем вернитесь сюда.
          </Text>
        </Stack>
      </Center>
    );
  }

  if (!boot.authed) {
    return <Login onSuccess={load} />;
  }

  // Сессия протухла в процессе работы — возвращаемся к экрану логина.
  const onUnauthorized = () => setBoot({ ...boot, authed: false });

  return <Shell boot={boot} onUnauthorized={onUnauthorized} />;
}
