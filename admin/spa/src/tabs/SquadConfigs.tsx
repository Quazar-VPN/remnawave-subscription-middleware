import { useState } from 'react';
import { Alert, Button, Card, Center, Group, Loader, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDeviceFloppy, IconPlus, IconTags, IconTrash } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';
import { ConfigModal, ConfigTable, deleteConfigs, toggleConfig, type Config, type Squad } from './sqcfg/shared';

interface Data {
  squads: Squad[];
  configs: Config[];
  api_err: string;
  xray_tpls: { name: string }[];
  xray_tpl_name: string;
}

export function SquadConfigs() {
  const { data, error, reload } = useAsync<Data>(() => apiGet('squad_configs'), []);
  const [selected, setSelected] = useState<number[]>([]);
  const [modal, setModal] = useState<{ open: boolean; cfg: Config | null }>({ open: false, cfg: null });
  const [grpVal, setGrpVal] = useState('');
  const [tplName, setTplName] = useState<string | null>(null);

  async function bulkGroup() {
    const r = await apiPost<{ ok: boolean; msg?: string }>('sqcfg_group', { ids: selected, grp: grpVal });
    if (r.ok) { notifications.show({ color: 'teal', message: r.msg || 'Готово' }); setSelected([]); reload(); }
  }
  async function saveTpl() {
    const r = await apiPost<{ ok: boolean; msg?: string }>('save_sqcfg_settings', { squad_xray_tpl_name: tplName ?? data?.xray_tpl_name ?? '' });
    if (r.ok) notifications.show({ color: 'teal', message: r.msg || 'Сохранено' });
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data) return <Center h={200}><Loader color="teal" /></Center>;

  return (
    <Stack gap="lg">
      {data.api_err && <Alert color="orange" icon={<IconAlertTriangle size={16} />}>Список сквадов недоступен: {data.api_err}</Alert>}

      <Card withBorder radius="md" p={0}>
        <Group justify="space-between" p="md" pb="xs" wrap="wrap">
          <Title order={5}>Доп. конфиги ({data.configs.length})</Title>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setModal({ open: true, cfg: null })}>Добавить конфиг</Button>
        </Group>
        {selected.length > 0 && (
          <Group px="md" pb="sm" gap="sm" wrap="wrap">
            <Text size="sm" c="dimmed">Выбрано: {selected.length}</Text>
            <TextInput size="xs" placeholder="группа" value={grpVal} onChange={(e) => setGrpVal(e.currentTarget.value)} w={160} />
            <Button size="xs" variant="light" leftSection={<IconTags size={14} />} onClick={bulkGroup}>Задать группу</Button>
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
        <Title order={6} mb="xs">Глобальный xray-шаблон</Title>
        <Text size="sm" c="dimmed" mb="sm">Шаблон XRAY_JSON из панели, по которому собираются per-host xray-конфиги (если у конфига не задан свой).</Text>
        <Group align="flex-end">
          <Select
            w={320}
            clearable
            placeholder="не выбран"
            value={tplName ?? data.xray_tpl_name ?? null}
            onChange={setTplName}
            data={data.xray_tpls.map((t) => ({ value: t.name, label: t.name }))}
          />
          <Button variant="default" leftSection={<IconDeviceFloppy size={16} />} onClick={saveTpl}>Сохранить</Button>
        </Group>
      </Card>

      {modal.open && (
        <ConfigModal
          kind="simple"
          squads={data.squads}
          xrayTpls={data.xray_tpls}
          initial={modal.cfg}
          onClose={() => setModal({ open: false, cfg: null })}
          onSaved={reload}
        />
      )}
    </Stack>
  );
}
