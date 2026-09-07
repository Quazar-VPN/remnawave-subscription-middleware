import { useState } from 'react';
import { Alert, Badge, Card, Center, Code, Group, Loader, Pagination, Table, Text, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { apiGet } from '../api';
import { useAsync } from '../hooks';

interface Row {
  username: string;
  short_uuid: string;
  created_ts: number;
  grace_until: number;
}
const PER = 50;

function fmt(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function GraceUsers() {
  const { data, error } = useAsync<{ rows: Row[] }>(() => apiGet('grace_users'), []);
  const [page, setPage] = useState(1);

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data) return <Center h={200}><Loader color="teal" /></Center>;

  const rows = data.rows ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / PER));
  const pageRows = rows.slice((page - 1) * PER, page * PER);
  const now = Date.now() / 1000;

  return (
    <Card withBorder radius="md" p={0}>
      <Group justify="space-between" p="md" pb="xs">
        <Title order={5}>Грейс-юзеры ({rows.length})</Title>
      </Group>
      <Text size="sm" c="dimmed" px="md" pb="sm">
        Юзеры, переведённые в грейс-сквад. «Грейс до» — момент возврата в исходный сквад и истечения, если не продлят.
      </Text>
      <Table.ScrollContainer minWidth={560}>
        <Table highlightOnHover fz="sm" verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Пользователь</Table.Th>
              <Table.Th>Переведён</Table.Th>
              <Table.Th>Грейс до</Table.Th>
              <Table.Th>Статус</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {pageRows.length === 0 ? (
              <Table.Tr><Table.Td colSpan={4}><Text c="dimmed" ta="center" py="lg">Пусто — грейс-юзеров нет.</Text></Table.Td></Table.Tr>
            ) : (
              pageRows.map((g, i) => (
                <Table.Tr key={i}>
                  <Table.Td>{g.username ? <Text fw={600}>{g.username}</Text> : <Code>{g.short_uuid}</Code>}</Table.Td>
                  <Table.Td c="dimmed" style={{ whiteSpace: 'nowrap' }}>{fmt(g.created_ts)}</Table.Td>
                  <Table.Td style={{ whiteSpace: 'nowrap' }}>{fmt(g.grace_until)}</Table.Td>
                  <Table.Td>
                    {g.grace_until > now
                      ? <Badge color="teal" variant="light">активен</Badge>
                      : <Badge color="orange" variant="light">завершён</Badge>}
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {pages > 1 && (
        <Group justify="flex-end" p="md"><Pagination total={pages} value={page} onChange={setPage} color="teal" size="sm" /></Group>
      )}
    </Card>
  );
}
