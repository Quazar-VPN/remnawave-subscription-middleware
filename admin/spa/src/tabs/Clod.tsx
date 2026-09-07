import { useEffect, useState } from 'react';
import {
  Accordion,
  Alert,
  Anchor,
  Button,
  Card,
  Center,
  Code,
  Group,
  Loader,
  NumberInput,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  ThemeIcon,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconBrandGithub, IconCheck, IconDeviceFloppy, IconKey, IconRefresh, IconX } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface DebugEntry {
  ts: number; ok: number; short_uuid?: string; res_st?: number; body_bytes?: number; wire_bytes?: number; why?: string;
  req_path?: string; req_head?: string; req_json?: string; req_fwd?: string; res_meta?: string; res_body?: string; res_outer?: string; res_wire?: string;
}
interface ClodData {
  ext_ok: boolean;
  fingerprint: string;
  index: { count: number; fresh: boolean; ts: number };
  stats: { subs: number; day: number; hits: number; downgrades: number; hard: number };
  rows: { short_uuid: string; first_seen: number; last_seen: number; hits: number; downgrades: number; ua?: string; hard: number }[];
  short_len: number;
  api_ok: boolean;
  php: string;
  apps: { repo: string; name: string; os: string }[];
  settings: { chan_enabled: boolean; chan_pad: boolean; chan_hard_default: boolean; chan_page_404: boolean; chan_hard_remarks: string };
  debug_on: boolean;
  debug_keep: number;
  debug: DebugEntry[];
}

function fmt(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function Check({ ok, warn }: { ok: boolean; warn?: boolean }) {
  return (
    <ThemeIcon size="sm" radius="xl" color={ok ? 'teal' : warn ? 'yellow' : 'red'} variant="light">
      {ok ? <IconCheck size={13} /> : <IconX size={13} />}
    </ThemeIcon>
  );
}
function Row({ title, desc, control }: { title: string; desc?: string; control: React.ReactNode }) {
  return (
    <Group justify="space-between" align="center" wrap="nowrap" gap="md" py={6}>
      <div style={{ minWidth: 0 }}><Text size="sm" fw={500}>{title}</Text>{desc && <Text size="xs" c="dimmed">{desc}</Text>}</div>
      <div style={{ flex: '0 0 auto' }}>{control}</div>
    </Group>
  );
}

export function Clod() {
  const { data, error, reload } = useAsync<ClodData>(() => apiGet('clod'), []);
  const [s, setS] = useState<ClodData['settings'] | null>(null);
  const [dbgOn, setDbgOn] = useState(false);
  const [dbgKeep, setDbgKeep] = useState(50);
  const [busy, setBusy] = useState('');

  useEffect(() => { if (data) { setS(data.settings); setDbgOn(data.debug_on); setDbgKeep(data.debug_keep); } }, [data]);

  async function act(resource: string, body: unknown, label: string) {
    setBusy(label);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string }>(resource, body);
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || (r.ok ? 'Готово' : 'Ошибка') });
      reload();
    } finally {
      setBusy('');
    }
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data || !s) return <Center h={200}><Loader color="teal" /></Center>;

  return (
    <Stack gap="lg" maw={960}>
      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Работает только с Clod Clash</Title>
        <Text size="sm" c="dimmed">Протокол двух конкретных приложений и этой прослойки. Обычные подписки идут прежним путём.</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm" mt="md">
          {data.apps.map((a) => (
            <Anchor key={a.repo} href={`https://github.com/${a.repo}`} target="_blank" underline="never">
              <Card withBorder radius="md" padding="sm">
                <Group gap="sm" wrap="nowrap">
                  <IconBrandGithub size={22} />
                  <div><Text size="sm" fw={600}>{a.name}</Text><Text size="xs" c="dimmed">{a.os}</Text></div>
                </Group>
              </Card>
            </Anchor>
          ))}
        </SimpleGrid>
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="md">Готовность</Title>
        <Stack gap="xs">
          <Group gap="sm"><Check ok={data.ext_ok} /><Text size="sm">Расширение <b>sodium</b> в PHP {data.php}{data.ext_ok ? '' : ' — нет, канал выключен принудительно'}</Text></Group>
          <Group gap="sm"><Check ok={data.fingerprint !== ''} /><Text size="sm">Ключ прослойки{data.fingerprint ? <> — отпечаток <Code>{data.fingerprint}</Code></> : ' — ещё не создан'}</Text></Group>
          <Group gap="sm"><Check ok={data.api_ok} /><Text size="sm">Доступ к панели{data.api_ok ? '' : ' — без URL и токена метки собрать не из чего'}</Text></Group>
          <Group gap="sm"><Check ok={data.index.fresh} warn /><Text size="sm">Индекс меток — {data.index.count} подписок{data.index.ts ? `, обход ${fmt(data.index.ts)}` : ''}</Text></Group>
        </Stack>
        {data.short_len > 0 && data.short_len < 16 && (
          <Alert color="orange" icon={<IconAlertTriangle size={16} />} mt="md">
            <b>Короткий адрес подписки</b> ({data.short_len} симв). Весь канал держится на shortUuid как на секрете — это меньше 96 бит. Лечится только длиной shortUuid в панели.
          </Alert>
        )}
        <Button mt="md" variant="default" leftSection={<IconRefresh size={16} />} loading={busy === 'reindex'} onClick={() => act('clod_reindex', {}, 'reindex')}>
          Пересобрать индекс меток
        </Button>
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Тумблеры</Title>
        <Row title="Принимать защищённые запросы" desc="Главный выключатель." control={<Switch checked={s.chan_enabled} disabled={!data.ext_ok} onChange={(e) => setS({ ...s, chan_enabled: e.currentTarget.checked })} />} />
        <Row title="Выравнивать размер ответа" desc="Ответ дополняется до кратного 4096 символов." control={<Switch checked={s.chan_pad} onChange={(e) => setS({ ...s, chan_pad: e.currentTarget.checked })} />} />
        <Row title="Жёсткий режим для новых защищённых подписок" desc="Подписка, ходившая по каналу, перестаёт работать по открытому HTTP." control={<Switch checked={s.chan_hard_default} onChange={(e) => setS({ ...s, chan_hard_default: e.currentTarget.checked })} />} />
        <Row title="Закрыть HTML-страницу подписки для защищённых" desc="Страница в браузере показывает адрес подписки целиком." control={<Switch checked={s.chan_page_404} onChange={(e) => setS({ ...s, chan_page_404: e.currentTarget.checked })} />} />
        <Text size="sm" fw={500} mt="md" mb={4}>Что увидит клиент, откатившийся на открытый HTTP</Text>
        <Textarea autosize minRows={3} value={s.chan_hard_remarks} onChange={(e) => setS({ ...s, chan_hard_remarks: e.currentTarget.value })} />
        <Group mt="md"><Button leftSection={<IconDeviceFloppy size={16} />} loading={busy === 'save'} onClick={() => act('save_clod', s, 'save')}>Сохранить</Button></Group>
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Ключ прослойки</Title>
        <Text size="sm">Текущий отпечаток: <Code>{data.fingerprint || '—'}</Code></Text>
        <Button mt="md" variant="default" leftSection={<IconKey size={16} />} loading={busy === 'rotate'} onClick={() => { if (confirm('Сменить ключ прослойки?')) act('clod_rotate', {}, 'rotate'); }}>
          Сменить ключ
        </Button>
      </Card>

      <Card withBorder radius="md" p={0}>
        <Group p="md" pb="xs" justify="space-between">
          <Title order={5}>Кто ходит защищённо ({data.stats.subs})</Title>
        </Group>
        <Text size="sm" c="dimmed" px="md" pb="xs">
          За сутки: <b>{data.stats.day}</b> · запросов: <b>{data.stats.hits}</b> · откатов: <b>{data.stats.downgrades}</b> · в жёстком режиме: <b>{data.stats.hard}</b>
        </Text>
        {data.stats.downgrades > 0 && (
          <Alert color="orange" m="md" mt={0} icon={<IconAlertTriangle size={16} />}>Есть откаты на открытый HTTP — старая версия клиента либо посредник, режущий канал.</Alert>
        )}
        <Table.ScrollContainer minWidth={760}>
          <Table highlightOnHover fz="sm" verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr><Table.Th>Подписка</Table.Th><Table.Th>Первый</Table.Th><Table.Th>Последний</Table.Th><Table.Th>Запр.</Table.Th><Table.Th>Откатов</Table.Th><Table.Th>Клиент</Table.Th><Table.Th>Жёстко</Table.Th></Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.rows.length === 0 ? (
                <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" ta="center" py="lg">Пусто.</Text></Table.Td></Table.Tr>
              ) : (
                data.rows.map((r) => (
                  <Table.Tr key={r.short_uuid}>
                    <Table.Td><Code>{r.short_uuid}</Code></Table.Td>
                    <Table.Td c="dimmed">{fmt(r.first_seen)}</Table.Td>
                    <Table.Td c="dimmed">{fmt(r.last_seen)}</Table.Td>
                    <Table.Td>{r.hits}</Table.Td>
                    <Table.Td>{r.downgrades > 0 ? <b>{r.downgrades}</b> : '0'}</Table.Td>
                    <Table.Td c="dimmed"><Text size="xs" lineClamp={1}>{r.ua || ''}</Text></Table.Td>
                    <Table.Td>
                      <Switch size="xs" checked={r.hard === 1} onChange={(e) => act('clod_hard', { short: r.short_uuid, on: e.currentTarget.checked }, 'hard')} />
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Диагностика {data.debug.length ? `· ${data.debug.length}` : ''}</Title>
        <Group align="flex-end" gap="md" wrap="wrap">
          <Switch label="Писать журнал" checked={dbgOn} onChange={(e) => setDbgOn(e.currentTarget.checked)} />
          <NumberInput label="Хранить записей" w={130} min={5} max={500} value={dbgKeep} onChange={(v) => setDbgKeep(Number(v) || 50)} />
          <Button variant="default" loading={busy === 'dbg'} onClick={() => act('save_clod_debug', { chan_debug: dbgOn, chan_debug_keep: dbgKeep }, 'dbg')}>Сохранить</Button>
          {data.debug_on && <Button variant="subtle" color="red" loading={busy === 'dbgclear'} onClick={() => act('clod_debug_clear', {}, 'dbgclear')}>Очистить</Button>}
        </Group>
        <Text size="xs" c="dimmed" mt="xs">В записи попадает расшифрованное тело подписки и карточка устройства. Включайте на время разбора.</Text>
        {data.debug.length > 0 && (
          <Accordion variant="separated" mt="md">
            {data.debug.map((d, i) => (
              <Accordion.Item key={i} value={String(i)}>
                <Accordion.Control icon={d.ok ? '✅' : '⛔'}>
                  <Text size="sm" span>{fmt(d.ts).slice(11)} · {d.ok ? <>{d.short_uuid} · ответ {d.res_st} · тело {d.body_bytes}б</> : <Text span c="dimmed">{d.why}</Text>}</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  {(['req_path', 'req_head', 'req_json', 'req_fwd', 'res_meta', 'res_body', 'res_outer', 'res_wire'] as const).map((k) =>
                    d[k] ? <Code key={k} block mb="xs">{k}: {d[k]}</Code> : null
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        )}
      </Card>
    </Stack>
  );
}
