import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
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
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDeviceFloppy, IconTrash } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface MapRow { main_short: string; note: string; add_url: string }
interface Data {
  enabled: boolean;
  suffix: string;
  cache_ttl: number;
  label: string;
  stub_on_traffic: boolean;
  stub_label: string;
  merge_xray: boolean;
  parallel_fetch: boolean;
  map: MapRow[];
}

function Row({ title, desc, control }: { title: string; desc?: string; control: React.ReactNode }) {
  return (
    <Group justify="space-between" align="center" wrap="nowrap" gap="md" py={6}>
      <div style={{ minWidth: 0 }}>
        <Text size="sm" fw={500}>{title}</Text>
        {desc && <Text size="xs" c="dimmed">{desc}</Text>}
      </div>
      <div style={{ flex: '0 0 auto' }}>{control}</div>
    </Group>
  );
}

export function Addsub() {
  const { data, error, reload } = useAsync<Data>(() => apiGet('addsub'), []);
  const [f, setF] = useState<Data | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data) setF(data); }, [data]);
  function set<K extends keyof Data>(k: K, v: Data[K]) { setF((p) => (p ? { ...p, [k]: v } : p)); }

  async function save() {
    if (!f) return;
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string }>('save_addsub', {
        enabled: f.enabled, suffix: f.suffix, cache_ttl: f.cache_ttl, label: f.label,
        stub_on_traffic: f.stub_on_traffic, stub_label: f.stub_label, merge_xray: f.merge_xray, parallel_fetch: f.parallel_fetch,
      });
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || (r.ok ? 'Сохранено' : 'Ошибка') });
    } finally {
      setBusy(false);
    }
  }
  async function unbind(su: string) {
    if (!confirm(`Отвязать вторую подписку от ${su}?`)) return;
    const r = await apiPost<{ ok: boolean }>('addsub_map_del', { short: su });
    if (r.ok) { notifications.show({ color: 'teal', message: 'Отвязано' }); reload(); }
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data || !f) return <Center h={200}><Loader color="teal" /></Center>;

  return (
    <Stack gap="lg" maw={900}>
      <Alert color="blue" variant="light">
        Прослойка подмешивает узлы <b>второй подписки</b> в тело основной — клиенту одна ссылка, серверы обеих подписок
        вместе. Подмешивание работает, только пока основная подписка активна.
      </Alert>

      <Card withBorder radius="md" padding="lg">
        <Row title="Включить слияние подписок" desc="Выключено — выдача не меняется." control={<Switch checked={f.enabled} onChange={(e) => set('enabled', e.currentTarget.checked)} />} />
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md" mt="md">
          <TextInput label="Суффикс имени для авто" description="имя B = имя A + суффикс" placeholder="_addsub" value={f.suffix} onChange={(e) => set('suffix', e.currentTarget.value)} />
          <NumberInput label="Кэш дискавери, сек" description="не меньше 30" min={30} value={f.cache_ttl} onChange={(v) => set('cache_ttl', Number(v) || 600)} />
          <TextInput label="Префикс меток узлов B" description="пусто — без префикса" placeholder="напр.: 🅑" value={f.label} onChange={(e) => set('label', e.currentTarget.value)} />
        </SimpleGrid>
        <Row title="Заглушка при исчерпании трафика B" desc="Когда трафик второй подписки кончился — подмешать строку-метку." control={<Switch checked={f.stub_on_traffic} onChange={(e) => set('stub_on_traffic', e.currentTarget.checked)} />} />
        <TextInput label="Текст заглушки трафика" placeholder="Трафик доп-сервера истёк" maw={480} value={f.stub_label} onChange={(e) => set('stub_label', e.currentTarget.value)} />
        <Row title="Слияние для xray-json" desc="Влить outbounds второй подписки в xray-json. По умолчанию выкл." control={<Switch checked={f.merge_xray} onChange={(e) => set('merge_xray', e.currentTarget.checked)} />} />
        <Row title="Параллельная загрузка подписок" desc="Обе подписки скачиваются одновременно — ответ быстрее." control={<Switch checked={f.parallel_fetch} onChange={(e) => set('parallel_fetch', e.currentTarget.checked)} />} />
        <Group mt="lg"><Button leftSection={<IconDeviceFloppy size={16} />} onClick={save} loading={busy}>Сохранить</Button></Group>
      </Card>

      <Card withBorder radius="md" p={0}>
        <Title order={5} p="md" pb="xs">Ручные привязки ({f.map.length})</Title>
        <Text size="sm" c="dimmed" px="md" pb="sm">Добавляются кнопкой «+» во вкладке «Пользователи». Здесь — обзор и отвязка.</Text>
        {f.map.length === 0 ? (
          <Text c="dimmed" px="md" pb="md">Пока пусто.</Text>
        ) : (
          <Table.ScrollContainer minWidth={640}>
            <Table highlightOnHover fz="sm" verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr><Table.Th>shortUuid основной</Table.Th><Table.Th>Заметка</Table.Th><Table.Th>Адрес второй подписки</Table.Th><Table.Th /></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {f.map.map((m) => (
                  <Table.Tr key={m.main_short}>
                    <Table.Td><Code>{m.main_short}</Code></Table.Td>
                    <Table.Td c="dimmed">{m.note || '—'}</Table.Td>
                    <Table.Td style={{ wordBreak: 'break-all', fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 }}>{m.add_url}</Table.Td>
                    <Table.Td>
                      <ActionIcon variant="subtle" color="red" onClick={() => unbind(m.main_short)} aria-label="Отвязать"><IconTrash size={16} /></ActionIcon>
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
