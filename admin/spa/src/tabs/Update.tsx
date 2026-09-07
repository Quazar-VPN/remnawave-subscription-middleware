import { useState } from 'react';
import { Alert, Badge, Button, Card, Center, Code, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDownload, IconRefresh, IconArrowBackUp, IconCircleCheck } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface Data {
  installed_commit: string;
  local_commit: string;
  branch: string;
  available: boolean;
  repo: string;
  root: string;
  web_user: string;
  in_docker: boolean;
  state: Record<string, unknown>;
  last_log: string[];
}

export function Update() {
  const { data, error, reload } = useAsync<Data>(() => apiGet('update'), []);
  const [busy, setBusy] = useState('');

  async function act(resource: string, label: string, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(label);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string }>(resource, {});
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || (r.ok ? 'Готово' : 'Ошибка') });
      reload();
    } finally {
      setBusy('');
    }
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data) return <Center h={200}><Loader color="teal" /></Center>;

  const st = data.state || {};
  const remote = (st.remote_commit || st.available_commit || st.latest || '') as string;

  return (
    <Stack gap="lg" maw={820}>
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" mb="md">
          <Title order={5}>Обновление прослойки</Title>
          {data.available ? <Badge color="orange" variant="light">доступно обновление</Badge> : <Badge color="teal" variant="light">актуально</Badge>}
        </Group>
        <Table variant="vertical" withRowBorders={false}>
          <Table.Tbody>
            <Table.Tr><Table.Th w={200}>Установленная версия</Table.Th><Table.Td><Code>{data.installed_commit ? data.installed_commit.slice(0, 12) : '—'}</Code></Table.Td></Table.Tr>
            {data.local_commit && <Table.Tr><Table.Th>Локальный git-коммит</Table.Th><Table.Td><Code>{data.local_commit.slice(0, 12)}</Code></Table.Td></Table.Tr>}
            {remote && <Table.Tr><Table.Th>Удалённый коммит</Table.Th><Table.Td><Code>{remote.slice(0, 12)}</Code></Table.Td></Table.Tr>}
            <Table.Tr><Table.Th>Ветка</Table.Th><Table.Td>{data.branch}</Table.Td></Table.Tr>
            {data.repo && <Table.Tr><Table.Th>Репозиторий</Table.Th><Table.Td><Text size="sm">{data.repo}</Text></Table.Td></Table.Tr>}
            {data.in_docker && <Table.Tr><Table.Th>Docker</Table.Th><Table.Td><Text size="sm" c="dimmed">образ обновляется пересборкой контейнера</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
        <Group mt="md" gap="sm">
          <Button variant="default" leftSection={<IconRefresh size={16} />} loading={busy === 'check'} onClick={() => act('update_check', 'check')}>Проверить</Button>
          <Button leftSection={<IconDownload size={16} />} loading={busy === 'apply'} disabled={data.in_docker || !data.available} onClick={() => act('update_apply', 'apply', 'Применить обновление? Файлы прослойки будут перезаписаны.')}>Применить</Button>
          <Button variant="default" leftSection={<IconArrowBackUp size={16} />} loading={busy === 'rollback'} disabled={data.in_docker} onClick={() => act('update_rollback', 'rollback', 'Откатить последнее обновление?')}>Откатить</Button>
          <Button variant="subtle" leftSection={<IconCircleCheck size={16} />} loading={busy === 'setcur'} onClick={() => act('update_set_current', 'setcur')}>Отметить текущую базовой</Button>
        </Group>
        {data.in_docker && <Text size="xs" c="dimmed" mt="xs">В Docker-режиме применение файлов отключено — обновляйте образ контейнера.</Text>}
      </Card>

      {data.last_log.length > 0 && (
        <Card withBorder radius="md" padding="lg">
          <Title order={6} mb="xs">Журнал последней операции ({data.last_log.length})</Title>
          <Code block style={{ maxHeight: 260, overflow: 'auto' }}>{data.last_log.join('\n')}</Code>
        </Card>
      )}
    </Stack>
  );
}
