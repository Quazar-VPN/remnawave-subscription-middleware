import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Checkbox,
  Code,
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
import { IconAlertTriangle, IconArrowLeft, IconPlus, IconTrash } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface Source { id: number; name: string; url: string; ua: string; last_status?: string; last_error?: string; last_fetch_ts?: number; host_count?: number }
interface Squad { uuid: string; name: string; members: number }
interface Host { key: string; remark: string; type: string; ok: boolean; imported: boolean; drift: boolean }
interface ListData { sources: Source[]; ua_options: Record<string, string>; squads: Squad[] }

function ago(ts?: number): string {
  ts = ts || 0;
  if (ts <= 0) return 'не запрашивался';
  const d = Math.max(0, Date.now() / 1000 - ts);
  if (d < 60) return 'только что';
  if (d < 3600) return `${Math.floor(d / 60)} мин назад`;
  if (d < 86400) return `${Math.floor(d / 3600)} ч назад`;
  return `${Math.floor(d / 86400)} дн назад`;
}

// --- Список источников -------------------------------------------------------
function SourceList({ data, reload, onOpen }: { data: ListData; reload: () => void; onOpen: (s: Source, v: 'hosts' | 'drift') => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [ua, setUa] = useState(Object.keys(data.ua_options)[0] || 'happ');
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!name.trim() || !url.trim()) return;
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string; error?: string }>('extsub_add', { name, url, ua });
      if (r.ok) { notifications.show({ color: 'teal', message: r.msg || 'Добавлено' }); setName(''); setUrl(''); reload(); }
      else notifications.show({ color: 'red', message: r.error || 'Ошибка' });
    } finally { setBusy(false); }
  }
  async function del(id: number) {
    if (!confirm('Удалить источник? Импортированные хосты будут отвязаны.')) return;
    const r = await apiPost<{ ok: boolean }>('extsub_del', { id });
    if (r.ok) { notifications.show({ color: 'teal', message: 'Удалён' }); reload(); }
  }

  return (
    <Stack gap="lg">
      <Alert color="blue" variant="light">
        Сохраните чужую подписку как источник — прослойка запросит её под UA реального клиента, покажет хосты, а выбранные
        можно импортировать в доп. конфиги. Позже — сверка дрифта и ре-синк.
      </Alert>
      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="md">Добавить источник</Title>
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
          <TextInput label="Название" placeholder="Резервный провайдер" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <TextInput label="URL подписки" placeholder="https://…" value={url} onChange={(e) => setUrl(e.currentTarget.value)} styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }} />
          <Select label="User-Agent (клиент)" data={Object.entries(data.ua_options).map(([k, v]) => ({ value: k, label: v }))} value={ua} onChange={(v) => setUa(v || 'happ')} allowDeselect={false} />
        </SimpleGrid>
        <Button mt="md" leftSection={<IconPlus size={16} />} onClick={add} loading={busy}>Добавить источник</Button>
      </Card>
      <Card withBorder radius="md" p={0}>
        <Title order={5} p="md" pb="xs">Источники ({data.sources.length})</Title>
        {data.sources.length === 0 ? (
          <Text c="dimmed" px="md" pb="md">Пока нет источников.</Text>
        ) : (
          <Table.ScrollContainer minWidth={760}>
            <Table highlightOnHover fz="sm" verticalSpacing="sm">
              <Table.Thead><Table.Tr><Table.Th>Название</Table.Th><Table.Th>URL</Table.Th><Table.Th>UA</Table.Th><Table.Th>Последний запрос</Table.Th><Table.Th>Хостов</Table.Th><Table.Th /></Table.Tr></Table.Thead>
              <Table.Tbody>
                {data.sources.map((s) => (
                  <Table.Tr key={s.id}>
                    <Table.Td fw={600}>{s.name}</Table.Td>
                    <Table.Td><Text size="xs" c="dimmed" lineClamp={1} maw={220} title={s.url}>{s.url}</Text></Table.Td>
                    <Table.Td><Badge variant="light" color="gray" size="sm">{data.ua_options[s.ua?.toLowerCase()] || s.ua}</Badge></Table.Td>
                    <Table.Td>
                      <Group gap={6}>
                        <Text size="sm" c="dimmed">{ago(s.last_fetch_ts)}</Text>
                        {s.last_status === 'ok' && <Badge color="teal" variant="light" size="sm">ok</Badge>}
                        {s.last_status === 'error' && <Badge color="orange" variant="light" size="sm" title={s.last_error}>ошибка</Badge>}
                      </Group>
                    </Table.Td>
                    <Table.Td>{s.host_count ?? 0}</Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end" wrap="nowrap">
                        <Button size="xs" variant="default" onClick={() => onOpen(s, 'hosts')}>Хосты</Button>
                        <Button size="xs" variant="default" onClick={() => onOpen(s, 'drift')}>Дрифт</Button>
                        <ActionIcon variant="subtle" color="red" onClick={() => del(s.id)} aria-label="Удалить"><IconTrash size={16} /></ActionIcon>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Card>
    </Stack>
  );
}

// --- Хосты источника ---------------------------------------------------------
function HostsView({ src, squads, onBack }: { src: Source; squads: Squad[]; onBack: () => void }) {
  const { data, error } = useAsync<{ hosts: Host[]; error: string }>(() => apiGet('ext_hosts', { id: String(src.id) }), [src.id]);
  const [sel, setSel] = useState<string[]>([]);
  const [pickedSquads, setPickedSquads] = useState<string[]>(['__manual__']);
  const [position, setPosition] = useState('end');
  const [busy, setBusy] = useState(false);

  async function doImport() {
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string; error?: string }>('extsub_import', { id: src.id, keys: sel, squads: pickedSquads, position });
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || r.error || 'Готово' });
    } finally { setBusy(false); }
  }

  const hosts = data?.hosts ?? [];
  const importable = hosts.filter((h) => h.ok).map((h) => h.key);

  return (
    <Stack gap="md">
      <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack} w="fit-content">Все источники</Button>
      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="md">Хосты источника: {src.name}</Title>
        {error || data?.error ? (
          <Alert color="orange" icon={<IconAlertTriangle size={16} />}>Не удалось получить хосты: {error || data?.error}</Alert>
        ) : !data ? (
          <Center h={120}><Loader color="teal" /></Center>
        ) : hosts.length === 0 ? (
          <Text c="dimmed">В подписке источника не найдено ни одного хоста.</Text>
        ) : (
          <>
            <Text size="sm" fw={600} mb="xs">Куда импортировать</Text>
            <Checkbox.Group value={pickedSquads} onChange={setPickedSquads}>
              <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
                <Checkbox value="__manual__" label="🔧 Ручная привязка (в обход сквадов)" />
                {squads.map((s) => <Checkbox key={s.uuid} value={s.uuid} label={`${s.name} (${s.members})`} />)}
              </SimpleGrid>
            </Checkbox.Group>
            <Select mt="md" maw={260} label="Позиция в подписке" value={position} onChange={(v) => setPosition(v || 'end')}
              data={[{ value: 'end', label: 'В конец' }, { value: 'start', label: 'В начало' }]} allowDeselect={false} />
            <Table.ScrollContainer minWidth={640} mt="md">
              <Table highlightOnHover fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={40}><Checkbox checked={sel.length > 0 && sel.length === importable.length} indeterminate={sel.length > 0 && sel.length < importable.length} onChange={(e) => setSel(e.currentTarget.checked ? importable : [])} /></Table.Th>
                    <Table.Th>Метка</Table.Th><Table.Th>Тип</Table.Th><Table.Th>Хост</Table.Th><Table.Th>Статус</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {hosts.map((h) => (
                    <Table.Tr key={h.key}>
                      <Table.Td><Checkbox disabled={!h.ok} checked={sel.includes(h.key)} onChange={(e) => setSel((p) => e.currentTarget.checked ? [...p, h.key] : p.filter((k) => k !== h.key))} /></Table.Td>
                      <Table.Td>{h.remark || <Text span c="dimmed">—</Text>}</Table.Td>
                      <Table.Td><Badge variant="light" color="teal" size="sm">{h.type}</Badge></Table.Td>
                      <Table.Td><Code>{h.key}</Code></Table.Td>
                      <Table.Td>
                        <Group gap={4}>
                          <Badge variant="light" color={h.ok ? 'teal' : 'orange'} size="sm">{h.ok ? 'импортируемый' : 'не распознан'}</Badge>
                          {h.imported && <Badge variant="light" color="gray" size="sm">уже импортирован</Badge>}
                          {h.drift && <Badge variant="light" color="orange" size="sm">дрифт</Badge>}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Group mt="md">
              <Button onClick={doImport} loading={busy} disabled={sel.length === 0}>Импортировать выбранные ({sel.length})</Button>
              <Text size="xs" c="dimmed">Импортируются только распознанные и ещё не привязанные хосты.</Text>
            </Group>
          </>
        )}
      </Card>
    </Stack>
  );
}

// --- Дрифт -------------------------------------------------------------------
function DriftView({ src, onBack }: { src: Source; onBack: () => void }) {
  const { data, error, reload } = useAsync<{ diff: Record<string, Host[]>; error: string }>(() => apiGet('ext_diff', { id: String(src.id) }), [src.id]);
  const [busy, setBusy] = useState(false);

  async function resync() {
    if (!confirm('Обновить привязанные хосты из источника?')) return;
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string }>('extsub_resync', { id: src.id });
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || 'Готово' });
      reload();
    } finally { setBusy(false); }
  }

  const sec: [string, string][] = [['new', 'Новые'], ['changed', 'Изменились'], ['removed', 'Пропали'], ['unchanged', 'Без изменений']];

  return (
    <Stack gap="md">
      <Button variant="subtle" leftSection={<IconArrowLeft size={16} />} onClick={onBack} w="fit-content">Все источники</Button>
      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="md">Дрифт источника: {src.name}</Title>
        {error || data?.error ? (
          <Alert color="orange" icon={<IconAlertTriangle size={16} />}>{error || data?.error}</Alert>
        ) : !data ? (
          <Center h={120}><Loader color="teal" /></Center>
        ) : (
          <>
            <Button mb="md" onClick={resync} loading={busy}>Синхронизировать изменившиеся</Button>
            {sec.map(([k, label]) => {
              const rows = data.diff[k] || [];
              return (
                <div key={k}>
                  <Text fw={600} size="sm" mt="md" mb="xs">{label} ({rows.length})</Text>
                  {rows.length === 0 ? <Text size="sm" c="dimmed">Пусто.</Text> : (
                    <Table fz="sm">
                      <Table.Thead><Table.Tr><Table.Th>Метка</Table.Th><Table.Th>Тип</Table.Th><Table.Th>Хост</Table.Th></Table.Tr></Table.Thead>
                      <Table.Tbody>
                        {rows.map((h, i) => (
                          <Table.Tr key={i}>
                            <Table.Td>{h.remark || <Text span c="dimmed">—</Text>}</Table.Td>
                            <Table.Td>{k === 'removed' ? <Text span c="dimmed">—</Text> : <Badge variant="light" color="teal" size="sm">{h.type}</Badge>}</Table.Td>
                            <Table.Td><Code>{h.key}</Code></Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  )}
                </div>
              );
            })}
          </>
        )}
      </Card>
    </Stack>
  );
}

export function ExtImport() {
  const { data, error, reload } = useAsync<ListData>(() => apiGet('ext_import'), []);
  const [view, setView] = useState<{ mode: 'list' | 'hosts' | 'drift'; src?: Source }>({ mode: 'list' });

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data) return <Center h={200}><Loader color="teal" /></Center>;

  if (view.mode === 'hosts' && view.src) return <HostsView src={view.src} squads={data.squads} onBack={() => setView({ mode: 'list' })} />;
  if (view.mode === 'drift' && view.src) return <DriftView src={view.src} onBack={() => setView({ mode: 'list' })} />;
  return <SourceList data={data} reload={reload} onOpen={(src, v) => setView({ mode: v, src })} />;
}
