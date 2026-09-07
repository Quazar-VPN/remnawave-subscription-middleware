import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Group,
  Loader,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDatabase, IconTrash } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface GcRow { title: string; total: number | null; old: Record<string, number | null> }
interface Data {
  driver: string;
  in_docker: boolean;
  env_db: { name?: string; user?: string } | null;
  db_info: { size: number; driver: string; location: string };
  gc: Record<string, GcRow>;
  gc_periods: number[];
  gc_free: number | null;
}

function fmtBytes(n: number | null): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function Migrate() {
  const { data, error, reload } = useAsync<Data>(() => apiGet('migrate'), []);
  const [busy, setBusy] = useState('');
  const [mysql, setMysql] = useState({ m_host: '127.0.0.1', m_port: '3306', m_name: '', m_user: '', m_pass: '' });
  const [days, setDays] = useState('30');
  const [tables, setTables] = useState<string[]>([]);

  async function migrateTo(to: string) {
    if (!confirm(`Мигрировать базу на ${to}? Данные будут перенесены и прослойка переключится.`)) return;
    setBusy('mig');
    try {
      const r = await apiPost<{ ok: boolean; msg?: string; error?: string }>('migrate_db', { to, ...mysql });
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || r.error || 'Готово' });
      reload();
    } finally { setBusy(''); }
  }
  async function purge() {
    setBusy('gc');
    try {
      const r = await apiPost<{ ok: boolean; msg?: string; error?: string }>('gc_purge', { days: Number(days), tables });
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || r.error || 'Готово' });
      reload();
    } finally { setBusy(''); }
  }
  async function compact() {
    setBusy('compact');
    try {
      const r = await apiPost<{ ok: boolean; msg?: string }>('gc_compact', {});
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || 'Готово' });
      reload();
    } finally { setBusy(''); }
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data) return <Center h={200}><Loader color="teal" /></Center>;

  return (
    <Stack gap="lg" maw={900}>
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" mb="md">
          <Title order={5}>База данных</Title>
          <Badge variant="light" color="teal" leftSection={<IconDatabase size={12} />}>{data.driver}</Badge>
        </Group>
        <Table variant="vertical" withRowBorders={false}>
          <Table.Tbody>
            <Table.Tr><Table.Th w={160}>Размер</Table.Th><Table.Td>{fmtBytes(data.db_info.size)}</Table.Td></Table.Tr>
            <Table.Tr><Table.Th>Расположение</Table.Th><Table.Td><Text size="sm" style={{ wordBreak: 'break-all' }}>{data.db_info.location}</Text></Table.Td></Table.Tr>
          </Table.Tbody>
        </Table>
        <Text size="sm" fw={500} mt="md" mb="xs">Миграция</Text>
        {data.driver === 'sqlite' ? (
          <>
            {!data.in_docker && (
              <SimpleGrid cols={{ base: 2, sm: 5 }} spacing="xs" mb="sm">
                <TextInput label="Host" value={mysql.m_host} onChange={(e) => setMysql({ ...mysql, m_host: e.currentTarget.value })} />
                <TextInput label="Port" value={mysql.m_port} onChange={(e) => setMysql({ ...mysql, m_port: e.currentTarget.value })} />
                <TextInput label="DB" value={mysql.m_name} onChange={(e) => setMysql({ ...mysql, m_name: e.currentTarget.value })} />
                <TextInput label="User" value={mysql.m_user} onChange={(e) => setMysql({ ...mysql, m_user: e.currentTarget.value })} />
                <TextInput label="Pass" type="password" value={mysql.m_pass} onChange={(e) => setMysql({ ...mysql, m_pass: e.currentTarget.value })} />
              </SimpleGrid>
            )}
            {data.in_docker && data.env_db && <Text size="xs" c="dimmed" mb="sm">Docker: параметры MySQL берутся из compose ({data.env_db.name} / {data.env_db.user}).</Text>}
            <Button loading={busy === 'mig'} onClick={() => migrateTo('mysql')}>Мигрировать на MySQL</Button>
          </>
        ) : (
          <Button variant="default" loading={busy === 'mig'} onClick={() => migrateTo('sqlite')}>Мигрировать на SQLite</Button>
        )}
      </Card>

      <Card withBorder radius="md" p={0}>
        <Title order={5} p="md" pb="xs">Очистка старых записей</Title>
        <Text size="sm" c="dimmed" px="md" pb="sm">Удаление старых строк логов/метрик. {data.gc_free != null && `Свободно на диске: ${fmtBytes(data.gc_free)}.`}</Text>
        <Table.ScrollContainer minWidth={560}>
          <Table fz="sm" verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={40} />
                <Table.Th>Таблица</Table.Th>
                <Table.Th>Всего</Table.Th>
                {data.gc_periods.map((d) => <Table.Th key={d}>&gt; {d} дн</Table.Th>)}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Object.entries(data.gc).map(([name, row]) => (
                <Table.Tr key={name}>
                  <Table.Td><Checkbox checked={tables.includes(name)} onChange={(e) => setTables((p) => e.currentTarget.checked ? [...p, name] : p.filter((t) => t !== name))} /></Table.Td>
                  <Table.Td>{row.title}</Table.Td>
                  <Table.Td>{row.total ?? '—'}</Table.Td>
                  {data.gc_periods.map((d) => <Table.Td key={d} c="dimmed">{row.old[String(d)] ?? '—'}</Table.Td>)}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
        <Group p="md" gap="sm" align="flex-end">
          <Select label="Старше" w={140} value={days} onChange={(v) => setDays(v || '30')} data={data.gc_periods.map((d) => ({ value: String(d), label: `${d} дней` }))} allowDeselect={false} />
          <Button color="red" variant="light" leftSection={<IconTrash size={16} />} loading={busy === 'gc'} disabled={tables.length === 0} onClick={purge}>Очистить выбранные</Button>
          {data.driver === 'sqlite' && <Button variant="default" loading={busy === 'compact'} onClick={compact}>Сжать базу (VACUUM)</Button>}
        </Group>
      </Card>
    </Stack>
  );
}
