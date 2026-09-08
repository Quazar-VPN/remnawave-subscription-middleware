import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Autocomplete,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Group,
  Modal,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconChevronDown, IconEdit, IconPencil, IconTrash } from '@tabler/icons-react';
import { apiPost } from '../../api';

export interface Squad { uuid: string; name: string; members: number }
export interface Config {
  id: number; name: string; type: string; squad_uuids: string[]; squad_names: string[];
  grp: string; enabled: boolean; position: string; xray_tpl: string; summary: string; raw: string;
  lb_tag?: string;
  overrides?: { serverDescription: string; sockopt: string; xhttpExtra: string; mux: string; finalMask: string };
}
export interface Host { remark: string; excluded: string[]; disabled: boolean; hidden: boolean }

export function ConfigTable({
  configs, selected, onSel, onEdit, onToggle, onDelete,
}: {
  configs: Config[];
  selected: number[];
  onSel: (ids: number[]) => void;
  onEdit: (c: Config) => void;
  onToggle: (c: Config) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <Table.ScrollContainer minWidth={820}>
      <Table highlightOnHover fz="sm" verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={40}>
              <Checkbox
                checked={configs.length > 0 && selected.length === configs.length}
                indeterminate={selected.length > 0 && selected.length < configs.length}
                onChange={(e) => onSel(e.currentTarget.checked ? configs.map((c) => c.id) : [])}
              />
            </Table.Th>
            <Table.Th>Метка</Table.Th><Table.Th>Тип</Table.Th><Table.Th>Сводка</Table.Th>
            <Table.Th>Сквады</Table.Th><Table.Th>Группа</Table.Th><Table.Th>Вкл</Table.Th><Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {configs.length === 0 ? (
            <Table.Tr><Table.Td colSpan={8}><Text c="dimmed" ta="center" py="lg">Пусто.</Text></Table.Td></Table.Tr>
          ) : (
            configs.map((c) => (
              <Table.Tr key={c.id}>
                <Table.Td><Checkbox checked={selected.includes(c.id)} onChange={(e) => onSel(e.currentTarget.checked ? [...selected, c.id] : selected.filter((x) => x !== c.id))} /></Table.Td>
                <Table.Td fw={600}>{c.name}</Table.Td>
                <Table.Td><Badge variant="light" color="teal" size="sm">{c.type}</Badge></Table.Td>
                <Table.Td c="dimmed"><Text size="xs" lineClamp={1} maw={200}>{c.summary}</Text></Table.Td>
                <Table.Td><Text size="xs" c="dimmed" lineClamp={1} maw={160}>{c.squad_names.join(', ')}</Text></Table.Td>
                <Table.Td>{c.grp || <Text span c="dimmed">—</Text>}</Table.Td>
                <Table.Td><Switch size="xs" checked={c.enabled} onChange={() => onToggle(c)} /></Table.Td>
                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    <ActionIcon variant="subtle" color="gray" onClick={() => onEdit(c)} aria-label="Изменить"><IconPencil size={15} /></ActionIcon>
                    <ActionIcon variant="subtle" color="red" onClick={() => onDelete(c.id)} aria-label="Удалить"><IconTrash size={15} /></ActionIcon>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

interface Overrides { serverDescription: string; sockopt: string; xhttpExtra: string; mux: string; finalMask: string }

export function ConfigModal({
  kind, squads, hosts, configs, xrayTpls, panelTags, initial, onClose, onSaved,
}: {
  kind: 'simple' | 'wg';
  squads: Squad[];
  hosts: Host[];
  configs: Config[];
  xrayTpls?: { name: string }[];
  panelTags?: string[];
  initial: Config | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!initial;
  const [name, setName] = useState(initial?.name ?? '');
  const [grp, setGrp] = useState(initial?.grp ?? '');
  const [sel, setSel] = useState<string[]>(initial?.squad_uuids ?? []);
  const [raw, setRaw] = useState(initial?.raw ?? '');
  const [position, setPosition] = useState(initial?.position ?? 'end');
  const [xrayTpl, setXrayTpl] = useState(initial?.xray_tpl ?? '');
  const [lbTag, setLbTag] = useState(initial?.lb_tag ?? '');

  // Список якорей позиции, отфильтрованный по выбранным сквадам (как легаси
  // sqcfgRebuildPos). Панельные хосты: показываем только доступные ВСЕМ выбранным
  // сквадам (host исключён, если сквад в его excludedInternalSquads); disabled/
  // hidden скрыты. Для «Ручной привязки»/без сквадов — все хосты. Плюс #3:
  // добавленные конфиги тех же сквадов — чтобы ставить один добавленный до/после
  // другого. Себя из списка якорей исключаем.
  const posOptions = useMemo(() => {
    const manual = sel.includes('__manual__');
    const squadSel = sel.filter((s) => s !== '__manual__');
    const useAll = manual || squadSel.length === 0;
    const hostAnchors: { value: string; label: string }[] = [];
    for (const h of hosts) {
      if (!h.remark || h.disabled || h.hidden) continue;
      if (!useAll && !squadSel.every((sq) => !h.excluded.includes(sq))) continue;
      hostAnchors.push({ value: `before:${h.remark}`, label: `перед ${h.remark}` });
      hostAnchors.push({ value: `after:${h.remark}`, label: `после ${h.remark}` });
    }
    const cfgAnchors: { value: string; label: string }[] = [];
    for (const c of configs) {
      if (initial && c.id === initial.id) continue;
      if (!c.name) continue;
      if (!useAll && !c.squad_uuids.some((sq) => squadSel.includes(sq))) continue;
      cfgAnchors.push({ value: `before:${c.name}`, label: `перед «${c.name}»` });
      cfgAnchors.push({ value: `after:${c.name}`, label: `после «${c.name}»` });
    }
    const data: unknown[] = [{ value: 'end', label: 'В конец (по умолчанию)' }, { value: 'start', label: 'В начало' }];
    if (hostAnchors.length) data.push({ group: 'Хосты сквада', items: hostAnchors });
    if (cfgAnchors.length) data.push({ group: 'Добавленные конфиги', items: cfgAnchors });
    return data;
  }, [sel, hosts, configs, initial]);

  // Если сохранённая позиция больше не в списке (сменили сквады) — на «В конец».
  const posValues = useMemo(() => {
    const v = new Set(['end', 'start']);
    for (const g of posOptions) {
      const grp = g as { value?: string; items?: { value: string }[] };
      if (grp.value) v.add(grp.value);
      if (grp.items) for (const it of grp.items) v.add(it.value);
    }
    return v;
  }, [posOptions]);
  const posValue = posValues.has(position) ? position : 'end';
  const [ov, setOv] = useState<Overrides>(initial?.overrides ?? { serverDescription: '', sockopt: '', xhttpExtra: '', mux: '', finalMask: '' });
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string; error?: string }>('sqcfg_save', {
        id: initial?.id ?? 0, kind, squads: sel, name, grp, raw, position: posValue, xray_tpl: xrayTpl, overrides: ov, lb_tag: lbTag.trim(),
      });
      if (r.ok) { notifications.show({ color: 'teal', message: r.msg || 'Сохранено' }); onSaved(); onClose(); }
      else notifications.show({ color: 'red', message: r.error || 'Ошибка' });
    } finally { setBusy(false); }
  }

  return (
    <Modal opened onClose={onClose} size="xl" radius="md" title={editing ? `Изменить конфиг: ${initial?.name}` : (kind === 'wg' ? 'Новый WG/AWG конфиг' : 'Новый доп. конфиг')}>
      <Stack gap="sm">
        <Group grow>
          <TextInput label="Метка (имя)" required value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <TextInput label="Группа" placeholder="необязательно" value={grp} onChange={(e) => setGrp(e.currentTarget.value)} />
        </Group>
        <div>
          <Text size="sm" fw={500} mb={4}>Сквады</Text>
          <Checkbox.Group value={sel} onChange={setSel}>
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
              <Checkbox value="__manual__" label="🔧 Ручная привязка" />
              {squads.map((s) => <Checkbox key={s.uuid} value={s.uuid} label={`${s.name} (${s.members})`} />)}
            </SimpleGrid>
          </Checkbox.Group>
        </div>
        <Textarea label="Конфиг (URI / WG / xray-json / base64)" autosize minRows={4} maxRows={12} value={raw} onChange={(e) => setRaw(e.currentTarget.value)} styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 } }} />
        <Group grow align="flex-end">
          <Select
            label="Позиция в подписке"
            description={sel.length ? 'якоря отфильтрованы по выбранным сквадам' : 'выберите сквады, чтобы увидеть якоря'}
            searchable
            comboboxProps={{ withinPortal: true }}
            value={posValue}
            onChange={(v) => setPosition(v || 'end')}
            allowDeselect={false}
            data={posOptions as never}
          />
          {kind === 'simple' && xrayTpls && (
            <Select label="xray-шаблон (uuid)" clearable value={xrayTpl || null} onChange={(v) => setXrayTpl(v || '')}
              data={xrayTpls.map((t) => ({ value: t.name, label: t.name }))} placeholder="глобальный" />
          )}
        </Group>
        {kind === 'simple' && (
          <Autocomplete
            label="Тег-балансер (Happ/xray)"
            description="хосты с одинаковым тегом сводятся в один клиентский балансер; выберите тег из панели или введите новый"
            value={lbTag}
            onChange={setLbTag}
            data={panelTags ?? []}
            placeholder="напр. LTE_BALANCER"
            comboboxProps={{ withinPortal: true }}
          />
        )}

        {kind === 'simple' && (
          <>
            <Button variant="subtle" size="xs" leftSection={<IconChevronDown size={14} style={{ transform: advanced ? 'rotate(180deg)' : undefined }} />} onClick={() => setAdvanced((v) => !v)} w="fit-content">
              xray-параметры (доп.)
            </Button>
            <Collapse in={advanced}>
              <Stack gap="xs">
                <TextInput label="serverDescription" value={ov.serverDescription} onChange={(e) => setOv({ ...ov, serverDescription: e.currentTarget.value })} />
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                  {(['sockopt', 'xhttpExtra', 'mux', 'finalMask'] as const).map((k) => (
                    <Textarea key={k} label={k} autosize minRows={2} placeholder="JSON" value={ov[k]} onChange={(e) => setOv({ ...ov, [k]: e.currentTarget.value })} styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 } }} />
                  ))}
                </SimpleGrid>
              </Stack>
            </Collapse>
          </>
        )}

        <Group justify="flex-end" mt="sm">
          <Button variant="subtle" color="gray" onClick={onClose}>Отмена</Button>
          <Button leftSection={<IconEdit size={16} />} onClick={save} loading={busy}>{editing ? 'Сохранить' : 'Добавить'}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// Хелперы действий (общие для обоих табов).
export async function toggleConfig(c: Config, reload: () => void) {
  await apiPost('sqcfg_toggle', { id: c.id, enabled: !c.enabled });
  reload();
}
export async function deleteConfigs(ids: number[], reload: () => void) {
  if (!confirm(`Удалить конфиг(ов): ${ids.length}?`)) return;
  const r = await apiPost<{ ok: boolean; msg?: string }>('sqcfg_delete', { ids });
  if (r.ok) { notifications.show({ color: 'teal', message: r.msg || 'Удалено' }); reload(); }
}
