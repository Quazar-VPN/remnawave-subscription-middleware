import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Card,
  Center,
  Code,
  Group,
  Loader,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDeviceFloppy, IconPlus, IconTrash } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface Header { key: string; value: string }
interface Rule { name?: string; enabled?: boolean; client?: string; os?: string; ua_custom?: string; headers?: Header[] }
interface Client { key: string; label: string; group: string }
interface CatItem { name: string; note: string; ex?: string }
interface Data {
  rules: Rule[];
  client_catalog: Client[];
  headers_catalog: Record<string, CatItem[]>;
}

const OS = [
  { value: '', label: 'Любая' },
  { value: 'windows', label: 'Windows' },
  { value: 'macos', label: 'macOS' },
  { value: 'linux', label: 'Linux' },
  { value: 'android', label: 'Android' },
  { value: 'ios', label: 'iOS' },
];

export function Rules() {
  const { data, error } = useAsync<Data>(() => apiGet('rules'), []);
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState(false);
  const [testUa, setTestUa] = useState('');
  const [testOs, setTestOs] = useState('');
  const [testOut, setTestOut] = useState<{ matched: string[]; headers: Record<string, string> } | null>(null);

  useEffect(() => { if (data) setRules(data.rules.map((r) => ({ headers: [], ...r }))); }, [data]);

  const catByName = useMemo(() => {
    const m: Record<string, CatItem> = {};
    if (data) for (const g of Object.values(data.headers_catalog)) for (const it of g) m[it.name] = it;
    return m;
  }, [data]);

  const clientData = useMemo(() => {
    if (!data) return [];
    const pop = data.client_catalog.filter((c) => c.group === 'popular').map((c) => ({ value: c.key, label: c.label }));
    const oth = data.client_catalog.filter((c) => c.group !== 'popular').map((c) => ({ value: c.key, label: c.label }));
    return [
      { value: '', label: '— выберите —' },
      { value: 'all', label: 'Все клиенты (общие)' },
      ...(pop.length ? [{ group: 'Популярные', items: pop }] : []),
      ...(oth.length ? [{ group: 'Остальные', items: oth }] : []),
      { value: 'custom', label: 'Своё (указать подпись)' },
    ] as never;
  }, [data]);

  const headerData = useMemo(() => {
    if (!data) return [];
    return [
      { value: '', label: '— выберите заголовок —' },
      ...Object.entries(data.headers_catalog).map(([g, items]) => ({ group: g, items: items.map((it) => ({ value: it.name, label: it.name })) })),
      { value: '__custom__', label: 'Другое (вписать вручную)…' },
    ] as never;
  }, [data]);

  function upd(i: number, patch: Partial<Rule>) { setRules((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r))); }
  function updHeader(ri: number, hi: number, patch: Partial<Header>) {
    setRules((p) => p.map((r, idx) => (idx === ri ? { ...r, headers: (r.headers || []).map((h, j) => (j === hi ? { ...h, ...patch } : h)) } : r)));
  }
  function addHeader(ri: number) { setRules((p) => p.map((r, idx) => (idx === ri ? { ...r, headers: [...(r.headers || []), { key: '', value: '' }] } : r))); }
  function delHeader(ri: number, hi: number) { setRules((p) => p.map((r, idx) => (idx === ri ? { ...r, headers: (r.headers || []).filter((_, j) => j !== hi) } : r))); }

  async function save() {
    setBusy(true);
    try {
      const clean = rules.map((r) => ({ ...r, headers: (r.headers || []).filter((h) => h.key && h.key !== '__custom__') }));
      const res = await apiPost<{ ok: boolean; msg?: string }>('save_rules', { rules: clean });
      notifications.show({ color: res.ok ? 'teal' : 'red', message: res.msg || (res.ok ? 'Сохранено' : 'Ошибка') });
    } finally {
      setBusy(false);
    }
  }
  async function runTest() {
    const r = await apiPost<{ ok: boolean; matched: string[]; headers: Record<string, string> }>('test_rule', { ua: testUa, os: testOs });
    if (r.ok) setTestOut({ matched: r.matched, headers: r.headers });
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data) return <Center h={200}><Loader color="teal" /></Center>;

  return (
    <Stack gap="lg" maw={960}>
      <Alert color="blue" variant="light">
        Правило «Все клиенты» уходит всем; правило под конкретное приложение <b>добавляет</b> свои заголовки поверх.
        Заголовки выбираются из списка с описанием.
      </Alert>

      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" mb="md">
          <Title order={5}>Правила</Title>
          <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setRules((p) => [...p, { enabled: true, client: '', headers: [] }])}>
            Добавить правило
          </Button>
        </Group>
        {rules.length === 0 && <Text c="dimmed">Пока нет ни одного правила.</Text>}
        <Stack gap="md">
          {rules.map((r, i) => {
            const isAll = r.client === 'all';
            const isCustom = r.client === 'custom';
            return (
              <Card key={i} withBorder radius="md" padding="md" style={{ opacity: r.enabled === false ? 0.6 : 1 }}>
                <Group gap="sm" wrap="nowrap" mb="sm">
                  <Switch checked={r.enabled !== false} onChange={(e) => upd(i, { enabled: e.currentTarget.checked })} label="вкл" />
                  <TextInput placeholder="название (необязательно)" value={r.name || ''} onChange={(e) => upd(i, { name: e.currentTarget.value })} style={{ flex: 1 }} />
                  <ActionIcon variant="subtle" color="red" onClick={() => setRules((p) => p.filter((_, idx) => idx !== i))} aria-label="Удалить"><IconTrash size={16} /></ActionIcon>
                </Group>
                <Group grow align="flex-start">
                  <Select label="Кому отдать" data={clientData} value={r.client || ''} onChange={(v) => upd(i, { client: v || '' })} searchable comboboxProps={{ withinPortal: true }} />
                  {!isAll && <Select label="Платформа" data={OS} value={r.os || ''} onChange={(v) => upd(i, { os: v || '' })} allowDeselect={false} />}
                </Group>
                {isCustom && (
                  <TextInput mt="xs" label="Подпись (User-Agent содержит)" placeholder="например: koala" value={r.ua_custom || ''} onChange={(e) => upd(i, { ua_custom: e.currentTarget.value })} />
                )}
                <Text size="xs" c="dimmed" tt="uppercase" mt="md" mb={4}>Какие заголовки отдавать</Text>
                <Stack gap="xs">
                  {(r.headers || []).map((h, hi) => {
                    const isCustomHdr = h.key === '__custom__' || (h.key !== '' && !catByName[h.key]);
                    const cat = catByName[h.key];
                    return (
                      <div key={hi}>
                        <Group gap="xs" wrap="nowrap" align="flex-start">
                          <Select
                            data={headerData}
                            value={isCustomHdr && h.key !== '__custom__' ? '__custom__' : h.key}
                            onChange={(v) => updHeader(i, hi, { key: v || '' })}
                            searchable
                            comboboxProps={{ withinPortal: true }}
                            style={{ flex: 1.2 }}
                          />
                          <TextInput placeholder={cat?.ex || 'значение'} value={h.value} onChange={(e) => updHeader(i, hi, { value: e.currentTarget.value })} style={{ flex: 1.3 }} />
                          <ActionIcon variant="subtle" color="red" onClick={() => delHeader(i, hi)} aria-label="Удалить"><IconTrash size={16} /></ActionIcon>
                        </Group>
                        {isCustomHdr && (
                          <TextInput mt={4} placeholder="имя заголовка" value={h.key === '__custom__' ? '' : h.key} onChange={(e) => updHeader(i, hi, { key: e.currentTarget.value })} />
                        )}
                        {cat && <Text size="xs" c="dimmed" mt={2}><b>{cat.name}</b> — {cat.note}{cat.ex ? ` · пример: ${cat.ex}` : ''}</Text>}
                      </div>
                    );
                  })}
                </Stack>
                <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} mt="xs" onClick={() => addHeader(i)}>Заголовок</Button>
              </Card>
            );
          })}
        </Stack>
        <Group mt="lg"><Button leftSection={<IconDeviceFloppy size={16} />} onClick={save} loading={busy}>Сохранить</Button></Group>
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Проверка по User-Agent</Title>
        <Text size="sm" c="dimmed" mb="sm">Вставьте подпись приложения — покажу, какие правила сработают и какие заголовки уйдут.</Text>
        <Group align="flex-end" gap="sm" wrap="wrap">
          <TextInput placeholder="например: Happ/2.10.0 (Android 14)" value={testUa} onChange={(e) => setTestUa(e.currentTarget.value)} style={{ flex: 1, minWidth: 240 }} />
          <Select w={170} data={OS.map((o) => (o.value === '' ? { value: '', label: 'Платформа: любая' } : o))} value={testOs} onChange={(v) => setTestOs(v || '')} allowDeselect={false} />
          <Button variant="default" onClick={runTest}>Проверить</Button>
        </Group>
        {testOut && (
          <Card withBorder radius="md" mt="md" padding="sm">
            <Text size="sm">Сработает: <b>{testOut.matched.length ? testOut.matched.join(', ') : 'нет правила — уйдут только общие заголовки'}</b></Text>
            <Text size="sm" mt="xs">Клиент получит:</Text>
            {Object.keys(testOut.headers).length ? (
              Object.entries(testOut.headers).map(([k, v]) => <Code key={k} block>{k}: {v}</Code>)
            ) : (
              <Text size="sm" c="dimmed">заголовков нет</Text>
            )}
          </Card>
        )}
      </Card>
    </Stack>
  );
}
