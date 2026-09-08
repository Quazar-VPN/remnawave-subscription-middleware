import { useEffect, useState } from 'react';
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
  NumberInput,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDeviceFloppy, IconPlus, IconTrash, IconRefresh } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';
import { ConfigModal, ConfigTable, deleteConfigs, toggleConfig, type Config, type Host, type Squad } from './sqcfg/shared';

interface Lease { id: number; pool_id: string; config_id: number; short_uuid?: string; hwid?: string; manual?: number; seen_ts?: number }
interface Data {
  squads: Squad[];
  configs: Config[];
  hosts: Host[];
  api_err: string;
  leases: Lease[];
  modes: Record<string, string>;
  stock: Record<string, number>;
  free: Record<string, number>;
  reclaim_days: number;
  dupes: unknown[];
}

const MODES = [
  { value: 'shared', label: 'Общий (shared)' },
  { value: 'users', label: 'На юзера (users)' },
  { value: 'devices', label: 'На устройство (devices)' },
];

export function WgPool() {
  const { data, error, reload } = useAsync<Data>(() => apiGet('wg_pool'), []);
  const [selected, setSelected] = useState<number[]>([]);
  const [modal, setModal] = useState<{ open: boolean; cfg: Config | null }>({ open: false, cfg: null });
  const [modes, setModes] = useState<Record<string, string>>({});
  const [reclaim, setReclaim] = useState(14);
  const [busy, setBusy] = useState('');

  useEffect(() => { if (data) { setModes(data.modes); setReclaim(data.reclaim_days); } }, [data]);

  async function savePool() {
    setBusy('modes');
    try {
      const r = await apiPost<{ ok: boolean; msg?: string }>('save_pool_modes', { modes, reclaim_days: reclaim });
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || 'Готово' });
      reload();
    } finally { setBusy(''); }
  }
  async function resetLeases() {
    if (!confirm('Сбросить все авто-выдачи? Пул переразложится при следующем чтении подписок.')) return;
    const r = await apiPost<{ ok: boolean; msg?: string }>('pool_reset_leases', {});
    if (r.ok) { notifications.show({ color: 'teal', message: r.msg || 'Готово' }); reload(); }
  }
  async function freeSlot(id: number) {
    const r = await apiPost<{ ok: boolean; msg?: string }>('pool_free_slot', { id });
    notifications.show({ color: r.ok ? 'teal' : 'gray', message: r.msg || 'Готово' });
    reload();
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data) return <Center h={200}><Loader color="teal" /></Center>;

  return (
    <Stack gap="lg">
      {data.api_err && <Alert color="orange" icon={<IconAlertTriangle size={16} />}>Список сквадов недоступен: {data.api_err}</Alert>}

      <Card withBorder radius="md" p={0}>
        <Group justify="space-between" p="md" pb="xs" wrap="wrap">
          <Title order={5}>WG / AWG конфиги ({data.configs.length})</Title>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ open: true, cfg: null })}>Добавить WG/AWG</Button>
        </Group>
        {selected.length > 0 && (
          <Group px="md" pb="sm">
            <Text size="sm" c="dimmed">Выбрано: {selected.length}</Text>
            <Button size="xs" variant="light" color="red" leftSection={<IconTrash size={14} />} onClick={() => deleteConfigs(selected, () => { setSelected([]); reload(); })}>Удалить</Button>
          </Group>
        )}
        <ConfigTable
          configs={data.configs}
          selected={selected}
          onSel={setSelected}
          onEdit={(c) => setModal({ open: true, cfg: c })}
          onToggle={(c) => toggleConfig(c, reload)}
          onDelete={(id) => deleteConfigs([id], reload)}
        />
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Пул по сквадам</Title>
        <Text size="sm" c="dimmed" mb="md">Режим раздачи и наполнение пула для каждого сквада. shared — один конфиг всем; users — по одному на пользователя; devices — по одному на устройство.</Text>
        {data.squads.length === 0 ? (
          <Text c="dimmed" size="sm">Сквады недоступны (нет API).</Text>
        ) : (
          <Stack gap="xs">
            {data.squads.map((s) => (
              <Group key={s.uuid} justify="space-between" wrap="nowrap" gap="md">
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={500} lineClamp={1}>{s.name}</Text>
                  <Text size="xs" c="dimmed">в пуле: {data.stock[s.uuid] ?? 0} · свободно: {data.free[s.uuid] ?? 0}</Text>
                </div>
                <Select w={220} data={MODES} value={modes[s.uuid] || 'shared'} onChange={(v) => setModes((p) => ({ ...p, [s.uuid]: v || 'shared' }))} allowDeselect={false} />
              </Group>
            ))}
          </Stack>
        )}
        <Group mt="md" align="flex-end">
          <NumberInput label="Реклейм, дней" w={140} min={1} value={reclaim} onChange={(v) => setReclaim(Number(v) || 14)} />
          <Button leftSection={<IconDeviceFloppy size={16} />} loading={busy === 'modes'} onClick={savePool}>Сохранить пул</Button>
        </Group>
      </Card>

      <Card withBorder radius="md" p={0}>
        <Group justify="space-between" p="md" pb="xs">
          <Title order={5}>Аренды ({data.leases.length})</Title>
          <Button size="xs" variant="default" leftSection={<IconRefresh size={14} />} onClick={resetLeases}>Сбросить авто-выдачи</Button>
        </Group>
        <Table.ScrollContainer minWidth={720}>
          <Table highlightOnHover fz="sm" verticalSpacing="xs">
            <Table.Thead><Table.Tr><Table.Th>Пул</Table.Th><Table.Th>Конфиг</Table.Th><Table.Th>Подписка</Table.Th><Table.Th>HWID</Table.Th><Table.Th>Тип</Table.Th><Table.Th /></Table.Tr></Table.Thead>
            <Table.Tbody>
              {data.leases.length === 0 ? (
                <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="lg">Пусто.</Text></Table.Td></Table.Tr>
              ) : (
                data.leases.map((l) => (
                  <Table.Tr key={l.id}>
                    <Table.Td><Text size="xs" c="dimmed" lineClamp={1} maw={120}>{l.pool_id}</Text></Table.Td>
                    <Table.Td>{l.config_id}</Table.Td>
                    <Table.Td>{l.short_uuid ? <Code>{l.short_uuid}</Code> : '—'}</Table.Td>
                    <Table.Td><Text size="xs" c="dimmed" lineClamp={1} maw={140}>{l.hwid || '—'}</Text></Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={l.manual ? 'violet' : 'gray'}>{l.manual ? 'ручной' : 'авто'}</Badge></Table.Td>
                    <Table.Td>
                      <Tooltip label="Освободить слот">
                        <ActionIcon variant="subtle" color="red" onClick={() => freeSlot(l.config_id)} aria-label="Освободить"><IconTrash size={15} /></ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      {modal.open && (
        <ConfigModal kind="wg" squads={data.squads} hosts={data.hosts} configs={data.configs} initial={modal.cfg} onClose={() => setModal({ open: false, cfg: null })} onSaved={reload} />
      )}
    </Stack>
  );
}
