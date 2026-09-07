import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Code,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconPlus, IconTrash } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface Override {
  id: number;
  match_type: string;
  match_value: string;
  reason: string;
  source: string;
  username: string | null;
  note: string | null;
  updated_at: string;
  created_at: string;
}
interface Data {
  overrides: Override[];
  ov_expire: Record<string, number>;
  grace_days: number;
}

function tillCell(o: Override, ovExpire: Record<string, number>, graceDays: number): string {
  if (o.reason === 'blocked') return 'бессрочно';
  if (o.reason !== 'expired') return '—';
  const now = Date.now() / 1000;
  const ovExp = o.match_type === 'shortuuid' && ovExpire[o.match_value] ? ovExpire[o.match_value] : 0;
  let till = 0;
  if (ovExp > now) till = ovExp;
  else if (graceDays <= 0) return 'до продления';
  else {
    const since = ovExp || (o.created_at ? Date.parse(o.created_at) / 1000 : 0);
    if (since) till = since + graceDays * 86400;
  }
  if (till > 0) return new Date(till * 1000).toISOString().slice(0, 10);
  return '—';
}

export function Overrides() {
  const { data, error, reload } = useAsync<Data>(() => apiGet('overrides'), []);
  const [mt, setMt] = useState('shortuuid');
  const [mv, setMv] = useState('');
  const [reason, setReason] = useState('expired');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!mv.trim()) return;
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string; error?: string }>('add_override', { match_type: mt, match_value: mv.trim(), reason, note });
      if (r.ok) { notifications.show({ color: 'teal', message: r.msg || 'Добавлено' }); setMv(''); setNote(''); reload(); }
      else notifications.show({ color: 'red', message: r.error || 'Ошибка' });
    } finally {
      setBusy(false);
    }
  }
  async function del(id: number) {
    if (!confirm('Удалить оверрайд?')) return;
    const r = await apiPost<{ ok: boolean }>('del_override', { id });
    if (r.ok) { notifications.show({ color: 'teal', message: 'Удалён' }); reload(); }
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data) return <Center h={200}><Loader color="teal" /></Center>;
  const rows = data.overrides ?? [];

  return (
    <Stack gap="lg">
      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Добавить оверрайд вручную</Title>
        <Text size="sm" c="dimmed" mb="md">
          <b>blocked</b> — жёсткая блокировка (конфиг-заглушка). <b>expired</b> — пометка истёкшей подписки.
        </Text>
        <Group align="flex-end" gap="sm" wrap="wrap">
          <Select label="Тип" w={140} value={mt} onChange={(v) => setMt(v || 'shortuuid')} data={[{ value: 'shortuuid', label: 'shortUuid' }, { value: 'hwid', label: 'HWID' }]} allowDeselect={false} />
          <TextInput label="Значение" placeholder="shortUuid или HWID" value={mv} onChange={(e) => setMv(e.currentTarget.value)} style={{ flex: 1, minWidth: 200 }} />
          <Select label="Причина" w={140} value={reason} onChange={(v) => setReason(v || 'expired')} data={[{ value: 'expired', label: 'expired' }, { value: 'blocked', label: 'blocked' }]} allowDeselect={false} />
          <TextInput label="Заметка" value={note} onChange={(e) => setNote(e.currentTarget.value)} w={160} />
          <Button leftSection={<IconPlus size={16} />} onClick={add} loading={busy}>Добавить</Button>
        </Group>
      </Card>

      <Card withBorder radius="md" p={0}>
        <Title order={5} p="md" pb="xs">Активные оверрайды ({rows.length})</Title>
        <Table.ScrollContainer minWidth={820}>
          <Table highlightOnHover fz="sm" verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Тип</Table.Th><Table.Th>Значение</Table.Th><Table.Th>Причина</Table.Th>
                <Table.Th>Источник</Table.Th><Table.Th>Юзер</Table.Th><Table.Th>Заметка</Table.Th>
                <Table.Th>Обновлён</Table.Th><Table.Th>Действует до</Table.Th><Table.Th /></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.length === 0 ? (
                <Table.Tr><Table.Td colSpan={9}><Text c="dimmed" ta="center" py="lg">Пусто</Text></Table.Td></Table.Tr>
              ) : (
                rows.map((o) => (
                  <Table.Tr key={o.id}>
                    <Table.Td>{o.match_type}</Table.Td>
                    <Table.Td><Code>{o.match_value}</Code></Table.Td>
                    <Table.Td><Badge variant="light" color={o.reason === 'blocked' ? 'red' : 'orange'}>{o.reason}</Badge></Table.Td>
                    <Table.Td><Badge variant="light" color="gray">{o.source}</Badge></Table.Td>
                    <Table.Td>{o.username || ''}</Table.Td>
                    <Table.Td c="dimmed">{o.note || ''}</Table.Td>
                    <Table.Td c="dimmed" style={{ whiteSpace: 'nowrap' }}>{o.updated_at}</Table.Td>
                    <Table.Td c="dimmed" style={{ whiteSpace: 'nowrap' }}>{tillCell(o, data.ov_expire, data.grace_days)}</Table.Td>
                    <Table.Td>
                      <ActionIcon variant="subtle" color="red" onClick={() => del(o.id)} aria-label="Удалить"><IconTrash size={16} /></ActionIcon>
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
