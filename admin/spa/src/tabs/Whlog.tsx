import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Group,
  Loader,
  Pagination,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertTriangle, IconDownload, IconSearch } from '@tabler/icons-react';
import { apiGet } from '../api';
import { useAsync } from '../hooks';

interface Row {
  ts: string;
  event: string;
  short_uuid: string | null;
  username: string | null;
  status: string | null;
  sig_ok: number | null;
  action: string | null;
}
interface WhData {
  ok: true;
  rows: Row[];
  events: { event: string; count: number }[];
  actions: string[];
  total: number;
  matched: number;
}

function eventColor(e: string): string {
  if (e.startsWith('user_hwid')) return 'violet';
  if (['user.expired', 'user.disabled', 'user.limited'].includes(e)) return 'orange';
  if (['user.deleted', 'user.revoked'].includes(e)) return 'red';
  if (e.startsWith('user.')) return 'cyan';
  return 'gray';
}

const HOURS = [
  { value: '0', label: 'Время: всё' },
  { value: '1', label: 'За час' },
  { value: '24', label: 'За сутки' },
  { value: '168', label: 'За неделю' },
];
const SIG = [
  { value: '', label: 'Подпись: любая' },
  { value: '1', label: 'Только ok' },
  { value: '0', label: 'Только bad' },
];
const PER = 50;

export function Whlog() {
  const [scope, setScope] = useState<'user' | 'other'>('user');
  const [event, setEvent] = useState('');
  const [action, setAction] = useState('');
  const [sig, setSig] = useState('');
  const [hours, setHours] = useState('0');
  const [flt, setFlt] = useState('');
  const [page, setPage] = useState(1);

  const { data, loading, error } = useAsync<WhData>(
    () => apiGet('whlog', { scope, event, action, sig, hours, flt }),
    [scope, event, action, sig, hours, flt]
  );

  const rows = data?.rows ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / PER));
  const pageRows = useMemo(() => rows.slice((page - 1) * PER, page * PER), [rows, page]);

  function exportCsv() {
    const cols = ['ts', 'event', 'short_uuid', 'username', 'status', 'sig_ok', 'action'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = rows.map((r) => cols.map((c) => esc((r as unknown as Record<string, unknown>)[c])).join(';')).join('\n');
    const blob = new Blob(['﻿' + cols.join(';') + '\n' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `webhook_log_${scope}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const isUser = scope === 'user';

  return (
    <Stack gap="md">
      <SegmentedControl
        value={scope}
        onChange={(v) => { setScope(v as 'user' | 'other'); setPage(1); setEvent(''); setAction(''); }}
        data={[{ value: 'user', label: 'Юзер-лог' }, { value: 'other', label: 'Прочие события' }]}
        w="fit-content"
      />

      <Card withBorder radius="md" p={0}>
        <Group justify="space-between" p="md" pb="xs" wrap="wrap">
          <Title order={5}>
            {isUser ? 'Юзер-лог вебхуков' : 'Прочие события'}{' '}
            <Text span size="sm" c="dimmed" fw={500}>
              хранится: {data?.total ?? 0} · в выборке: {data?.matched ?? 0}
              {(data?.matched ?? 0) > 3000 ? ' (последние 3000)' : ''}
            </Text>
          </Title>
          <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} onClick={exportCsv} disabled={!rows.length}>
            CSV
          </Button>
        </Group>

        <Group px="md" pb="sm" gap="xs" wrap="wrap">
          <Select
            w={220}
            value={event}
            onChange={(v) => { setEvent(v || ''); setPage(1); }}
            data={[{ value: '', label: 'Событие: все' }, ...(data?.events ?? []).map((e) => ({ value: e.event, label: `${e.event} (${e.count})` }))]}
            allowDeselect={false}
          />
          {isUser && (
            <Select
              w={180}
              value={action}
              onChange={(v) => { setAction(v || ''); setPage(1); }}
              data={[{ value: '', label: 'Действие: все' }, ...(data?.actions ?? []).map((a) => ({ value: a, label: a }))]}
              allowDeselect={false}
            />
          )}
          <Select w={160} value={sig} onChange={(v) => { setSig(v || ''); setPage(1); }} data={SIG} allowDeselect={false} />
          <Select w={150} value={hours} onChange={(v) => { setHours(v || '0'); setPage(1); }} data={HOURS} allowDeselect={false} />
          {isUser && (
            <TextInput
              w={200}
              placeholder="shortUuid / имя"
              leftSection={<IconSearch size={14} />}
              value={flt}
              onChange={(e) => { setFlt(e.currentTarget.value); setPage(1); }}
            />
          )}
        </Group>

        {error ? (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} m="md">{error}</Alert>
        ) : !data && loading ? (
          <Center h={160}><Loader color="teal" /></Center>
        ) : (
          <Table.ScrollContainer minWidth={isUser ? 760 : 420}>
            <Table highlightOnHover fz="sm" verticalSpacing="xs" stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Время</Table.Th>
                  <Table.Th>Событие</Table.Th>
                  {isUser && <Table.Th>Пользователь</Table.Th>}
                  <Table.Th>Статус</Table.Th>
                  {isUser && <Table.Th>Действие</Table.Th>}
                  <Table.Th>Подпись</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageRows.length === 0 ? (
                  <Table.Tr><Table.Td colSpan={isUser ? 6 : 4}><Text c="dimmed" ta="center" py="lg">Пусто</Text></Table.Td></Table.Tr>
                ) : (
                  pageRows.map((r, i) => (
                    <Table.Tr key={i}>
                      <Table.Td c="dimmed" style={{ whiteSpace: 'nowrap' }}>{r.ts}</Table.Td>
                      <Table.Td>
                        <Badge color={eventColor(r.event)} variant="light" style={{ textTransform: 'none' }}>{r.event}</Badge>
                      </Table.Td>
                      {isUser && (
                        <Table.Td>
                          <Text size="sm" fw={r.username ? 600 : 400}>{r.username || r.short_uuid || '—'}</Text>
                        </Table.Td>
                      )}
                      <Table.Td c="dimmed">{r.status || '—'}</Table.Td>
                      {isUser && <Table.Td c="dimmed">{r.action || '—'}</Table.Td>}
                      <Table.Td>
                        {r.sig_ok === null ? (
                          <Text c="dimmed">—</Text>
                        ) : (
                          <Badge color={r.sig_ok ? 'teal' : 'red'} variant="light">{r.sig_ok ? 'ok' : 'bad'}</Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}

        {pages > 1 && (
          <Group justify="flex-end" p="md">
            <Pagination total={pages} value={page} onChange={setPage} color="teal" size="sm" />
          </Group>
        )}
      </Card>
    </Stack>
  );
}
