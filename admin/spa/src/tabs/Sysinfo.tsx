import {
  Alert,
  Badge,
  Card,
  Center,
  Group,
  Loader,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { AreaChart } from '@mantine/charts';
import { IconAlertTriangle } from '@tabler/icons-react';
import { apiGet } from '../api';
import { useAsync } from '../hooks';

interface Sysinfo {
  ok: true;
  system: {
    php_version: string;
    sapi: string;
    os: string;
    server: string;
    load: number[] | null;
    cores: number | null;
    mem_limit: string;
    mem_peak: number;
    opcache: boolean;
    curl: boolean;
  };
  db: { driver: string; size: number; location: string; tables: Record<string, number | null> };
  load: {
    m1: number;
    m5: number;
    m60: number;
    h24: number;
    today: number;
    avg_ms: number;
    max_ms_60: number;
    mem_max_60: number;
    rpm_60: number;
  };
  series: { ts: number; hits: number; sub: number; ms: number }[];
  peaks: { minute_ts: number; hits: number; baseline: number; dur_ms_max: number; mem_max: number }[];
  panel: {
    stats: {
      users: { ACTIVE: number | null; LIMITED: number | null; EXPIRED: number | null; DISABLED: number | null; total: number | null };
      online: { now: number | null; day: number | null; week: number | null };
      nodes: { online: number | null; total: number | null };
    } | null;
    error: string | null;
    version: string;
  } | null;
  version: string;
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('ru-RU');
}

function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

function hhmm(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card withBorder radius="md" padding="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: '.04em' }}>
        {label}
      </Text>
      <Text fz={26} fw={700} mt={4} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed" mt={2}>
          {sub}
        </Text>
      )}
    </Card>
  );
}

export function Sysinfo() {
  const { data, loading, error, reload } = useAsync<Sysinfo>(() => apiGet<Sysinfo>('sysinfo'), []);

  if (loading && !data) {
    return (
      <Center h={240}>
        <Loader color="teal" />
      </Center>
    );
  }
  if (error) {
    return (
      <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Не удалось загрузить">
        <Group justify="space-between">
          <Text size="sm">{error}</Text>
          <Text size="sm" c="teal" style={{ cursor: 'pointer' }} onClick={reload}>
            Повторить
          </Text>
        </Group>
      </Alert>
    );
  }
  if (!data) return null;

  const { system, db, load, series, peaks, panel } = data;
  const chartData = series.map((p) => ({ time: hhmm(p.ts), Запросы: p.hits, Подписки: p.sub }));
  const loadStr = system.load ? system.load.map((n) => n.toFixed(2)).join(' / ') : '—';

  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="md">
        <Kpi label="Запросов / мин" value={fmtNum(load.rpm_60)} sub="скользящее за 60 мин" />
        <Kpi label="За минуту" value={fmtNum(load.m1)} sub={`5 мин: ${fmtNum(load.m5)}`} />
        <Kpi label="За час" value={fmtNum(load.m60)} sub={`24 ч: ${fmtNum(load.h24)}`} />
        <Kpi label="Отклик" value={`${fmtNum(load.avg_ms)} мс`} sub={`пик ${fmtNum(load.max_ms_60)} мс`} />
        <Kpi label="Load avg" value={loadStr} sub={system.cores ? `${system.cores} ядер` : undefined} />
        <Kpi label="База" value={fmtBytes(db.size)} sub={db.driver} />
      </SimpleGrid>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="md">
          Нагрузка за последний час
        </Title>
        {chartData.length ? (
          <AreaChart
            h={220}
            data={chartData}
            dataKey="time"
            withDots={false}
            curveType="monotone"
            withLegend
            series={[
              { name: 'Запросы', color: 'teal.6' },
              { name: 'Подписки', color: 'blue.5' },
            ]}
          />
        ) : (
          <Text c="dimmed" size="sm">
            Пока нет данных за последний час.
          </Text>
        )}
      </Card>

      {panel && (
        <Card withBorder radius="md" padding="lg">
          <Group justify="space-between" mb="md">
            <Title order={5}>Панель</Title>
            {panel.version && (
              <Badge variant="light" color="teal" style={{ textTransform: 'none' }}>
                v{panel.version}
              </Badge>
            )}
          </Group>
          {panel.error ? (
            <Text c="red" size="sm">
              {panel.error}
            </Text>
          ) : panel.stats ? (
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
              <Kpi label="Всего юзеров" value={fmtNum(panel.stats.users.total)} sub={`active ${fmtNum(panel.stats.users.ACTIVE)}`} />
              <Kpi label="Онлайн сейчас" value={fmtNum(panel.stats.online.now)} sub={`сутки ${fmtNum(panel.stats.online.day)}`} />
              <Kpi
                label="Ноды онлайн"
                value={`${fmtNum(panel.stats.nodes.online)} / ${fmtNum(panel.stats.nodes.total)}`}
              />
              <Kpi label="Истекло / откл." value={`${fmtNum(panel.stats.users.EXPIRED)} / ${fmtNum(panel.stats.users.DISABLED)}`} />
            </SimpleGrid>
          ) : (
            <Text c="dimmed" size="sm">
              Статистика недоступна.
            </Text>
          )}
        </Card>
      )}

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Card withBorder radius="md" padding="lg">
          <Title order={5} mb="md">
            Окружение
          </Title>
          <Table variant="vertical" withRowBorders={false}>
            <Table.Tbody>
              <Table.Tr>
                <Table.Th w={160}>Версия</Table.Th>
                <Table.Td>{data.version || 'dev'}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>PHP</Table.Th>
                <Table.Td>
                  {system.php_version} <Text span c="dimmed">({system.sapi})</Text>
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>ОС</Table.Th>
                <Table.Td>{system.os}</Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>Пик памяти</Table.Th>
                <Table.Td>
                  {fmtBytes(system.mem_peak)} <Text span c="dimmed">/ {system.mem_limit}</Text>
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Th>opcache / curl</Table.Th>
                <Table.Td>
                  <Badge size="sm" color={system.opcache ? 'teal' : 'gray'} variant="light">
                    opcache {system.opcache ? 'on' : 'off'}
                  </Badge>{' '}
                  <Badge size="sm" color={system.curl ? 'teal' : 'red'} variant="light">
                    curl {system.curl ? 'on' : 'off'}
                  </Badge>
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
        </Card>

        <Card withBorder radius="md" padding="lg">
          <Title order={5} mb="md">
            Всплески нагрузки
          </Title>
          {peaks.length ? (
            <Table.ScrollContainer minWidth={320} mah={260}>
              <Table stickyHeader highlightOnHover fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Время</Table.Th>
                    <Table.Th ta="right">Хиты</Table.Th>
                    <Table.Th ta="right">База</Table.Th>
                    <Table.Th ta="right">Пик мс</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {peaks.slice(0, 50).map((p) => (
                    <Table.Tr key={p.minute_ts}>
                      <Table.Td>{new Date(p.minute_ts * 1000).toLocaleString('ru-RU')}</Table.Td>
                      <Table.Td ta="right" fw={600}>
                        {fmtNum(p.hits)}
                      </Table.Td>
                      <Table.Td ta="right" c="dimmed">
                        {fmtNum(p.baseline)}
                      </Table.Td>
                      <Table.Td ta="right">{fmtNum(p.dur_ms_max)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          ) : (
            <Text c="dimmed" size="sm">
              Всплесков не зафиксировано.
            </Text>
          )}
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
