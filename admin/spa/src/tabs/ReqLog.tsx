import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  CopyButton,
  Group,
  Loader,
  Pagination,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconAlertTriangle, IconChevronRight, IconSearch, IconRefresh } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

// --- Типы (зеркало reqlog_serialize_rows в admin/api.php) --------------------
interface AsMeta {
  s: string;
  n: number;
  b: number;
  ms: number;
  m: string;
  su: string;
  h: string;
  c: number | null;
}
interface Row {
  id: number;
  ts: string;
  ts_epoch: number;
  dup: number;
  decision: string;
  why: string;
  fmt: string;
  fmt_label: string;
  as: AsMeta;
  short_uuid: string;
  name: string;
  status: string;
  dev_limit: number | null;
  hwid: string;
  ov_label: string;
  client: { app: string; dev: string; ver: string; os: string };
  cv: { s: string; cur: string; latest: string };
  day: number;
  dev_count: number;
  first_ts: number;
  history: string[];
  ip: string;
  path: string;
  ctype: string;
  bytes: number;
  expire_ts: number;
  wg: number;
  grace: boolean;
}
interface ReqLogData {
  ok: true;
  filters: { dec: string; fmt: string; hours: number; q: string };
  overview: { total: number; blocked: number; blocked_users: number; hourly: number[]; peak: number; peak_h: number };
  today: { today_users: number; today_devices: number; total_devices: number; label: string };
  total_users: number;
  nolog: string[];
  rows: Row[];
}

const PAGE_SIZE = 25;

// --- Мапперы бейджей (семантика цветов = легаси .tag) ------------------------
const DEC: Record<string, { color: string; label: string }> = {
  normal: { color: 'teal', label: 'normal' },
  blocked: { color: 'red', label: 'blocked' },
  grace: { color: 'cyan', label: 'грейс' },
  expired: { color: 'yellow', label: 'expired' },
  error: { color: 'red', label: 'error' },
};

function DecisionBadge({ dec }: { dec: string }) {
  const d = DEC[dec] ?? { color: 'gray', label: dec };
  return (
    <Badge color={d.color} variant="light" size="sm" style={{ textTransform: 'none' }}>
      {d.label}
    </Badge>
  );
}

function AsBadge({ as }: { as: AsMeta }) {
  const map: Record<string, { color: string; label: string }> = {
    on: { color: 'teal', label: as.n > 0 ? `+${as.n} слита` : 'слита' },
    stub: { color: 'yellow', label: 'трафик' },
    err: { color: 'red', label: 'ошибка' },
    off: { color: 'gray', label: 'выкл' },
    no: { color: 'gray', label: 'нет' },
    grace: { color: 'gray', label: 'грейс' },
  };
  const m = map[as.s] ?? { color: 'gray', label: '—' };
  return (
    <Badge color={m.color} variant={as.s === 'on' ? 'light' : 'outline'} size="sm" style={{ textTransform: 'none' }}>
      {m.label}
    </Badge>
  );
}

const CV_LABEL: Record<string, string> = {
  ok: 'актуальная версия',
  ahead: 'новее известной — предрелиз',
  patch: 'вышло обновление',
  minor: 'версия сильно отстала',
  dead: 'проект не обновляется',
  nover: 'версия не определяется',
  wait: 'источник ещё не опрошен',
  manual: 'версия не задана вручную',
  unknown: 'актуальную версию узнать не удалось',
};

function CvDot({ cv }: { cv: Row['cv'] }) {
  if (cv.s !== 'patch' && cv.s !== 'minor') return null;
  const color = cv.s === 'patch' ? 'var(--mantine-color-yellow-6)' : 'var(--mantine-color-red-6)';
  const tip = `${cv.cur ? cv.cur + ' → ' : ''}${cv.latest} · ${CV_LABEL[cv.s] ?? ''}`;
  return (
    <Tooltip label={tip} withArrow>
      <Box component="span" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: color, marginLeft: 6, verticalAlign: 'middle' }} />
    </Tooltip>
  );
}

const HIST_COLOR: Record<string, string> = {
  blocked: 'var(--mantine-color-red-6)',
  error: 'var(--mantine-color-red-5)',
  expired: 'var(--mantine-color-yellow-6)',
  grace: 'var(--mantine-color-cyan-5)',
};
function HistoryBar({ list }: { list: string[] }) {
  if (!list.length) return <Text c="dimmed">—</Text>;
  return (
    <Group gap={3}>
      {list.map((d, i) => (
        <Box key={i} title={d} style={{ width: 6, height: 14, borderRadius: 2, background: HIST_COLOR[d] ?? 'var(--mantine-color-teal-6)' }} />
      ))}
    </Group>
  );
}

function fmtBytes(b: number): string {
  if (b <= 0) return '—';
  if (b < 1024) return `${b} Б`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} КБ`;
  return `${(b / 1048576).toFixed(2)} МБ`;
}
function timeOnly(ts: string): string {
  return ts.length > 11 ? ts.slice(11) : ts;
}
function expireLeft(ts: number): { text: string; color: string } {
  if (ts <= 0) return { text: '—', color: 'dimmed' };
  const d = ts - Math.floor(Date.now() / 1000);
  const days = Math.floor(Math.abs(d) / 86400);
  const hrs = Math.floor(Math.abs(d) / 3600);
  if (d < 0) return { text: days > 0 ? `истёк ${days} дн. назад` : `истёк ${Math.max(1, hrs)} ч назад`, color: 'red' };
  if (days <= 3) return { text: days > 0 ? `через ${days} дн.` : `через ${Math.max(1, hrs)} ч`, color: 'yellow' };
  return { text: `через ${days} дн.`, color: 'teal' };
}

// --- Обзор: KPI + почасовая гистограмма --------------------------------------
function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Box>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: '.04em' }}>
        {label}
      </Text>
      <Text fz={22} fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed">
          {sub}
        </Text>
      )}
    </Box>
  );
}

function Hourly({ hourly, peak }: { hourly: number[]; peak: number }) {
  const p = Math.max(1, peak);
  const base = Math.floor(Date.now() / 3600000) - 23;
  return (
    <Group gap={2} align="flex-end" h={44} wrap="nowrap">
      {hourly.map((v, i) => {
        const h = Math.max(6, Math.round(Math.pow(v / p, 0.62) * 100));
        const t = new Date((base + i) * 3600 * 1000);
        return (
          <Tooltip key={i} label={`${String(t.getHours()).padStart(2, '0')}:00 — ${v}`} withArrow openDelay={200}>
            <Box
              style={{
                width: 8,
                height: `${h}%`,
                borderRadius: 2,
                background: v >= p * 0.75 ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-teal-9)',
                opacity: v >= p * 0.75 ? 1 : 0.55,
              }}
            />
          </Tooltip>
        );
      })}
    </Group>
  );
}

// --- Разворачиваемая деталь строки -------------------------------------------
function DRow({ l, children }: { l: string; children: React.ReactNode }) {
  return (
    <Group gap="xs" wrap="nowrap" align="baseline">
      <Text size="xs" c="dimmed" w={110} style={{ flex: '0 0 auto' }}>
        {l}
      </Text>
      <Box style={{ minWidth: 0, fontSize: 13 }}>{children}</Box>
    </Group>
  );
}

const MONO = { fontFamily: 'var(--mantine-font-family-monospace)', wordBreak: 'break-all' as const };

function Detail({
  row,
  nolog,
  onFilterUser,
  onToggleNolog,
}: {
  row: Row;
  nolog: boolean;
  onFilterUser: (su: string) => void;
  onToggleNolog: (su: string, on: boolean) => void;
}) {
  const exp = expireLeft(row.expire_ts);
  const done: string[] = [];
  if (row.wg) done.push(`+${row.wg} из пула WG`);
  if (row.grace) done.push('грейс-сквад');
  if (row.as.s === 'on') done.push('доп. подписка');
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg" p="xs">
      <Stack gap={6}>
        <Text fw={700} size="xs" tt="uppercase" c="teal">
          Запрос
        </Text>
        <DRow l="Время"><span style={MONO}>{row.ts}</span></DRow>
        <DRow l="IP"><span style={MONO}>{row.ip || '—'}</span></DRow>
        <DRow l="Путь"><span style={MONO}>{row.path || '—'}</span></DRow>
        <DRow l="Content-Type"><span style={MONO}>{row.ctype || '—'}</span></DRow>
      </Stack>
      <Stack gap={6}>
        <Text fw={700} size="xs" tt="uppercase" c="teal">
          Клиент
        </Text>
        <DRow l="Приложение">{row.client.app || '—'}</DRow>
        <DRow l="Устройство">{row.client.dev || <Text span c="dimmed">клиент не прислал</Text>}</DRow>
        <DRow l="HWID">
          <span style={MONO}>{row.hwid || '—'}</span>
          {row.ov_label && <Text span c="dimmed"> · {row.ov_label}</Text>}
        </DRow>
        {row.cv.s !== 'none' && row.cv.s !== '' && (
          <DRow l="Версия">
            {row.cv.latest ? `${row.cv.cur || '?'} → ${row.cv.latest}` : CV_LABEL[row.cv.s] ?? row.cv.s}
          </DRow>
        )}
      </Stack>
      <Stack gap={6}>
        <Text fw={700} size="xs" tt="uppercase" c="teal">
          Подписка
        </Text>
        <DRow l="Пользователь">
          {row.name && `${row.name} · `}
          <span style={MONO}>{row.short_uuid || '—'}</span>
        </DRow>
        <DRow l="Статус">
          {row.status ? <Badge size="sm" variant="light" style={{ textTransform: 'none' }}>{row.status}</Badge> : <Text span c="dimmed">неизвестен</Text>}
        </DRow>
        <DRow l="Expire">
          {row.expire_ts > 0 ? (
            <>
              <span style={MONO}>{new Date(row.expire_ts * 1000).toLocaleString('ru-RU')}</span>{' '}
              · <Text span c={exp.color}>{exp.text}</Text>
            </>
          ) : (
            '—'
          )}
        </DRow>
        <DRow l="Решение">
          <DecisionBadge dec={row.decision} /> <Text span c="dimmed" size="xs">— {row.why}</Text>
        </DRow>
      </Stack>
      <Stack gap={6}>
        <Text fw={700} size="xs" tt="uppercase" c="teal">
          Что отдано
        </Text>
        <DRow l="Формат"><Badge color="gray" variant="light" size="sm" style={{ textTransform: 'none' }}>{row.fmt_label || '—'}</Badge></DRow>
        <DRow l="Размер"><span style={MONO}>{fmtBytes(row.bytes)}</span></DRow>
        <DRow l="Добавлено">{done.length ? done.join(' · ') : <Text span c="dimmed">ничего</Text>}</DRow>
      </Stack>
      <Stack gap={6}>
        <Text fw={700} size="xs" tt="uppercase" c="teal">
          Доп. подписка
        </Text>
        <DRow l="Состояние"><AsBadge as={row.as} /></DRow>
        {['on', 'stub', 'err'].includes(row.as.s) && (
          <>
            <DRow l="Режим">{row.as.m === 'manual' ? 'ручная привязка' : row.as.m === 'auto' ? 'авто (по суффиксу)' : '—'}</DRow>
            <DRow l="Источник"><span style={MONO}>{row.as.h || '—'}</span></DRow>
            <DRow l="Слито">
              {row.as.n > 0 ? `${row.as.n} конфиг(ов)` : row.as.b > 0 ? fmtBytes(row.as.b) : '—'}
              {row.as.ms > 0 && ` · ${row.as.ms} мс`}
            </DRow>
          </>
        )}
      </Stack>
      <Stack gap={6}>
        <Text fw={700} size="xs" tt="uppercase" c="teal">
          История
        </Text>
        <DRow l="Последние"><HistoryBar list={row.history} /></DRow>
        <DRow l="За сутки">{row.day}</DRow>
        <DRow l="Устройств">
          {row.dev_count}
          {row.dev_limit !== null && <Text span c="dimmed"> · лимит {row.dev_limit}</Text>}
        </DRow>
        <DRow l="Первый заход">
          <span style={MONO}>{row.first_ts ? new Date(row.first_ts * 1000).toLocaleDateString('ru-RU') : '—'}</span>
        </DRow>
      </Stack>
      {row.short_uuid && (
        <Group gap="xs" style={{ gridColumn: '1 / -1' }}>
          <Button size="xs" variant="light" onClick={() => onFilterUser(row.short_uuid)}>
            Фильтр по пользователю
          </Button>
          {row.hwid && (
            <CopyButton value={row.hwid}>
              {({ copied, copy }) => (
                <Button size="xs" variant="default" onClick={copy}>
                  {copied ? 'Скопировано' : 'Копировать HWID'}
                </Button>
              )}
            </CopyButton>
          )}
          <Switch
            size="sm"
            checked={nolog}
            onChange={(e) => onToggleNolog(row.short_uuid, e.currentTarget.checked)}
            label="Не логировать"
          />
        </Group>
      )}
    </SimpleGrid>
  );
}

// --- Основной компонент ------------------------------------------------------
export function ReqLog() {
  const [dec, setDec] = useState('');
  const [fmt, setFmt] = useState('');
  const [hours, setHours] = useState('24');
  const [q, setQ] = useState('');
  const [qDebounced] = useDebouncedValue(q, 350);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [nolog, setNolog] = useState<Set<string>>(new Set());

  const { data, loading, error, reload } = useAsync<ReqLogData>(
    () =>
      apiGet<ReqLogData>('reqlog', {
        ...(dec ? { rl_dec: dec } : {}),
        ...(fmt ? { rl_fmt: fmt } : {}),
        rl_hours: hours,
        ...(qDebounced ? { rl_q: qDebounced } : {}),
      }),
    [dec, fmt, hours, qDebounced]
  );

  useEffect(() => {
    if (data) setNolog(new Set(data.nolog));
  }, [data]);
  useEffect(() => {
    setPage(1);
    setExpanded(null);
  }, [dec, fmt, hours, qDebounced]);

  async function toggleNolog(su: string, on: boolean) {
    setNolog((prev) => {
      const n = new Set(prev);
      if (on) n.add(su);
      else n.delete(su);
      return n;
    });
    try {
      await apiPost('reqlog_nolog', { short: su, on });
    } catch {
      reload();
    }
  }

  const rows = data?.rows ?? [];
  const maxDay = useMemo(() => Math.max(1, ...rows.map((r) => r.day)), [rows]);
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pages = Math.ceil(rows.length / PAGE_SIZE);

  return (
    <Stack gap="lg">
      {/* Обзор */}
      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="lg">
          <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }} spacing="xl" style={{ flex: 1, minWidth: 260 }}>
            <Kpi label="Юзеров сегодня" value={String(data?.today.today_users ?? '—')} sub={data ? `всего ${data.total_users}` : undefined} />
            <Kpi label="Устройств" value={String(data?.today.today_devices ?? '—')} sub={data ? `всего ${data.today.total_devices}` : undefined} />
            <Kpi label="Запросов 24ч" value={data ? data.overview.total.toLocaleString('ru-RU') : '—'} />
            <Kpi label="Заблокировано" value={data ? String(data.overview.blocked) : '—'} sub={data ? `${data.overview.blocked_users} юзеров` : undefined} />
            <Kpi label="Пик/час" value={data ? String(data.overview.peak) : '—'} />
          </SimpleGrid>
          {data && <Hourly hourly={data.overview.hourly} peak={data.overview.peak} />}
        </Group>
      </Card>

      {/* Фильтры */}
      <Group gap="sm" wrap="wrap">
        <Select
          w={130}
          value={hours}
          onChange={(v) => setHours(v || '24')}
          data={[
            { value: '1', label: 'За час' },
            { value: '24', label: 'За сутки' },
            { value: '168', label: 'За 7 дней' },
            { value: '0', label: 'Всё время' },
          ]}
          allowDeselect={false}
        />
        <Select
          w={160}
          placeholder="Все решения"
          value={dec}
          onChange={(v) => setDec(v || '')}
          clearable
          data={[
            { value: 'normal', label: 'normal' },
            { value: 'blocked', label: 'blocked' },
            { value: 'grace', label: 'грейс' },
            { value: 'expired', label: 'expired' },
            { value: 'error', label: 'error' },
          ]}
        />
        <Select
          w={160}
          placeholder="Все форматы"
          value={fmt}
          onChange={(v) => setFmt(v || '')}
          clearable
          data={['base64', 'json', 'clash', 'singbox', 'wg', 'page', 'other'].map((x) => ({ value: x, label: x }))}
        />
        <TextInput
          flex={1}
          miw={180}
          placeholder="Поиск: имя, shortUuid, IP, HWID"
          leftSection={<IconSearch size={15} />}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Tooltip label="Обновить">
          <ActionIcon variant="default" size={36} onClick={reload} loading={loading} aria-label="Обновить">
            <IconRefresh size={17} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {/* Таблица */}
      {error ? (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Не удалось загрузить">
          {error}
        </Alert>
      ) : loading && !data ? (
        <Center h={200}>
          <Loader color="teal" />
        </Center>
      ) : (
        <Card withBorder radius="md" p={0}>
          <Table.ScrollContainer minWidth={720}>
            <Table highlightOnHover verticalSpacing="xs" fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={30} />
                  <Table.Th w={90}>Время</Table.Th>
                  <Table.Th w={90}>Решение</Table.Th>
                  <Table.Th w={110}>Тип</Table.Th>
                  <Table.Th w={90}>Доп.</Table.Th>
                  <Table.Th>Пользователь</Table.Th>
                  <Table.Th>Клиент</Table.Th>
                  <Table.Th w={130}>Запросов/сутки</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageRows.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={8}>
                      <Text c="dimmed" ta="center" py="md">
                        Пусто
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  pageRows.map((r) => {
                    const open = expanded === r.id;
                    return (
                      <Fragment key={r.id}>
                        <Table.Tr style={{ cursor: 'pointer' }} onClick={() => setExpanded(open ? null : r.id)}>
                          <Table.Td>
                            <IconChevronRight
                              size={15}
                              style={{ transition: 'transform .15s', transform: open ? 'rotate(90deg)' : 'none', opacity: 0.6 }}
                            />
                          </Table.Td>
                          <Table.Td c="dimmed" style={{ ...MONO }}>
                            {timeOnly(r.ts)}
                            {r.dup > 1 && (
                              <Text span c="teal" fw={700} ml={4}>
                                ×{r.dup}
                              </Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <DecisionBadge dec={r.decision} />
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {r.fmt_label || '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <AsBadge as={r.as} />
                          </Table.Td>
                          <Table.Td>
                            {r.name ? (
                              <Stack gap={0}>
                                <Text size="sm">{r.name}</Text>
                                <Text size="xs" c="dimmed" style={MONO}>
                                  {r.short_uuid}
                                </Text>
                              </Stack>
                            ) : r.short_uuid ? (
                              <Text size="xs" style={MONO}>
                                {r.short_uuid}
                              </Text>
                            ) : (
                              <Text c="dimmed">—</Text>
                            )}
                          </Table.Td>
                          <Table.Td>
                            <Group gap={4} wrap="nowrap">
                              <Text size="sm">{r.client.app || '—'}</Text>
                              <CvDot cv={r.cv} />
                              {r.client.dev && (
                                <Text size="xs" c="dimmed" lineClamp={1}>
                                  {r.client.dev}
                                </Text>
                              )}
                            </Group>
                          </Table.Td>
                          <Table.Td>
                            <Group gap="xs" wrap="nowrap">
                              <Text fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>
                                {r.day}
                              </Text>
                              <Box style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--mantine-color-default-border)' }}>
                                <Box style={{ width: `${Math.round((r.day / maxDay) * 100)}%`, height: '100%', borderRadius: 3, background: 'var(--mantine-color-teal-6)' }} />
                              </Box>
                            </Group>
                          </Table.Td>
                        </Table.Tr>
                        {open && (
                          <Table.Tr>
                            <Table.Td colSpan={8} p={0} style={{ background: 'var(--mantine-color-default-hover)' }}>
                              <Detail
                                row={r}
                                nolog={nolog.has(r.short_uuid)}
                                onFilterUser={(su) => setQ(su)}
                                onToggleNolog={toggleNolog}
                              />
                            </Table.Td>
                          </Table.Tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}

      {pages > 1 && (
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            {rows.length} записей{rows.length >= 300 ? ' (показаны последние 300)' : ''}
          </Text>
          <Pagination total={pages} value={page} onChange={setPage} color="teal" size="sm" />
        </Group>
      )}
    </Stack>
  );
}
