import {
  ActionIcon,
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Loader,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconRefresh, IconTrash } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface Row {
  ts: string;
  event: string;
  target: string;
  http_code: number | null;
  ok: number | boolean;
  error: string | null;
}

export function Fwdlog() {
  const { data, loading, error, reload } = useAsync<{ rows: Row[] }>(() => apiGet('fwdlog'), []);

  async function clearLog() {
    if (!confirm('Очистить лог пересылки?')) return;
    const r = await apiPost<{ ok: boolean; msg?: string }>('clear_fwdlog', {});
    if (r.ok) {
      notifications.show({ color: 'teal', message: r.msg || 'Очищено' });
      reload();
    }
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data) return <Center h={200}><Loader color="teal" /></Center>;
  const rows = data.rows ?? [];

  return (
    <Stack>
      <Card withBorder radius="md" p={0}>
        <Group justify="space-between" p="md" pb="xs">
          <Title order={5}>Лог пересылки (последние 300)</Title>
          <Group gap="xs">
            <Tooltip label="Обновить">
              <ActionIcon variant="default" onClick={reload} loading={loading} aria-label="Обновить"><IconRefresh size={16} /></ActionIcon>
            </Tooltip>
            <ActionIcon variant="light" color="red" onClick={clearLog} aria-label="Очистить"><IconTrash size={16} /></ActionIcon>
          </Group>
        </Group>
        <Text size="sm" c="dimmed" px="md" pb="sm">
          Исходящие пересылки вебхука адресатам. <b>ok</b> = адресат ответил 2xx.
        </Text>
        <Table.ScrollContainer minWidth={640}>
          <Table highlightOnHover fz="sm" verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Время</Table.Th>
                <Table.Th>Событие</Table.Th>
                <Table.Th>Адресат</Table.Th>
                <Table.Th>Код</Table.Th>
                <Table.Th>Результат</Table.Th>
                <Table.Th>Ошибка</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.length === 0 ? (
                <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="lg">Пусто</Text></Table.Td></Table.Tr>
              ) : (
                rows.map((r, i) => (
                  <Table.Tr key={i}>
                    <Table.Td c="dimmed" style={{ whiteSpace: 'nowrap' }}>{r.ts}</Table.Td>
                    <Table.Td>{r.event}</Table.Td>
                    <Table.Td style={{ wordBreak: 'break-all' }}>{r.target}</Table.Td>
                    <Table.Td c="dimmed">{r.http_code ?? '—'}</Table.Td>
                    <Table.Td>
                      <Badge color={r.ok ? 'teal' : 'red'} variant="light">{r.ok ? 'ok' : 'fail'}</Badge>
                    </Table.Td>
                    <Table.Td c="dimmed" style={{ maxWidth: 240 }}>
                      <Text size="sm" lineClamp={1}>{r.error || ''}</Text>
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
    </Stack>
  );
}
