import { useState } from 'react';
import { Button, Card, Center, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconShieldLock } from '@tabler/icons-react';
import { login } from '../api';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await login(user, pass);
      if (r.ok) onSuccess();
      else setError(r.error || 'Неверный логин или пароль');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Center h="100vh" p="md">
      <Card withBorder shadow="md" radius="lg" p="xl" w={380} maw="100%">
        <Stack gap="lg">
          <Stack gap={4} align="center">
            <IconShieldLock size={34} color="var(--mantine-color-teal-6)" />
            <Title order={3}>Админка прослойки</Title>
            <Text c="dimmed" size="sm">
              Вход в панель управления
            </Text>
          </Stack>
          <form onSubmit={submit}>
            <Stack gap="sm">
              <TextInput
                label="Логин"
                value={user}
                onChange={(e) => setUser(e.currentTarget.value)}
                autoFocus
                required
              />
              <PasswordInput
                label="Пароль"
                value={pass}
                onChange={(e) => setPass(e.currentTarget.value)}
                required
              />
              {error && (
                <Text c="red" size="sm">
                  {error}
                </Text>
              )}
              <Button type="submit" loading={busy} fullWidth mt="xs">
                Войти
              </Button>
            </Stack>
          </form>
        </Stack>
      </Card>
    </Center>
  );
}
