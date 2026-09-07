import { useEffect, useState } from 'react';
import { Alert, Button, Card, Center, Group, Loader, SimpleGrid, Stack, Text, Textarea, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDeviceFloppy } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

export function Hwid() {
  const { data, error } = useAsync<{ blocked_remarks: string }>(() => apiGet('hwid'), []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data) setText(data.blocked_remarks); }, [data]);

  async function save() {
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string }>('save_hwid', { blocked_remarks: text });
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || (r.ok ? 'Сохранено' : 'Ошибка') });
    } finally {
      setBusy(false);
    }
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data) return <Center h={200}><Loader color="teal" /></Center>;

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  return (
    <Stack gap="lg" maw={900}>
      <Alert color="blue" variant="light">
        Что увидит юзер, заблокированный по HWID (Пользователи → Устройства → Блок) или вручную (Оверрайды, причина
        <b> blocked</b>). Жёсткая блокировка не зависит от грейс-периода.
      </Alert>
      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="md">Ремарки для заблокированной подписки</Title>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <div>
            <Textarea
              autosize
              minRows={5}
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              placeholder={'🚫 Доступ заблокирован\nПоддержка: @your_bot'}
            />
            <Text size="xs" c="dimmed" mt="xs">Каждая строка = отдельный «сервер»-заглушка в списке клиента.</Text>
            <Button mt="md" leftSection={<IconDeviceFloppy size={16} />} onClick={save} loading={busy}>Сохранить</Button>
          </div>
          <Card withBorder radius="md" padding={0} style={{ overflow: 'hidden', alignSelf: 'start', background: '#070b12' }}>
            <div style={{ background: '#0b1220', padding: '12px 14px', borderBottom: '1px solid #1f2a3a' }}>
              <Text size="xs" c="dimmed" tt="uppercase">VPN-клиент · подписка</Text>
              <Text fw={700} c="#e2e8f0">Подписка заблокирована</Text>
            </div>
            <Stack gap={0}>
              {lines.length === 0 ? (
                <Text p="md" size="sm" c="dimmed" ta="center">— строк нет —</Text>
              ) : (
                lines.map((l, i) => (
                  <Group key={i} gap="sm" px="md" py="sm" style={{ borderBottom: '1px solid #121a26' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#475569', flex: '0 0 auto' }} />
                    <Text size="sm" c="#e2e8f0" style={{ wordBreak: 'break-word' }}>{l}</Text>
                  </Group>
                ))
              )}
            </Stack>
          </Card>
        </SimpleGrid>
      </Card>
    </Stack>
  );
}
