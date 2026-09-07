import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Center,
  Group,
  Loader,
  NumberInput,
  Radio,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDeviceFloppy, IconRefresh } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface Squad { uuid: string; name: string; members: number }
interface GraceData {
  ok: true;
  enabled: boolean;
  squad_uuid: string;
  days: string;
  days_default: number;
  traffic_gb: string;
  hwid_limit: string;
  traffic_strategy: string;
  reset_traffic_exit: boolean;
  external_enabled: boolean;
  external_squad_uuid: string;
  announce: string;
  internal_squads: Squad[];
  internal_err: string;
  external_squads: Squad[];
  external_err: string;
}

const STRATEGY = [
  { value: 'NO_RESET', label: 'Без сброса' },
  { value: 'DAY', label: 'Ежедневно' },
  { value: 'WEEK', label: 'Еженедельно' },
  { value: 'MONTH', label: 'Ежемесячно' },
  { value: 'MONTH_ROLLING', label: 'Скользящий месяц' },
];

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

function SquadGrid({ squads, value, onChange, err, empty }: { squads: Squad[]; value: string; onChange: (v: string) => void; err: string; empty: string }) {
  if (err) return <Alert color="orange" icon={<IconAlertTriangle size={16} />}>Не удалось получить список: {err}</Alert>;
  if (!squads.length) return <Text size="sm" c="dimmed">{empty}</Text>;
  return (
    <Radio.Group value={value} onChange={onChange}>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
        {squads.map((s) => (
          <Card
            key={s.uuid}
            withBorder
            radius="md"
            padding="xs"
            onClick={() => onChange(s.uuid)}
            style={{ cursor: 'pointer', borderColor: value === s.uuid ? 'var(--mantine-color-teal-6)' : undefined }}
          >
            <Group gap="xs" wrap="nowrap" justify="space-between">
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <Radio value={s.uuid} />
                <Text size="sm" fw={600} lineClamp={1}>{s.name}</Text>
              </Group>
              <Text size="xs" c="dimmed">{s.members}</Text>
            </Group>
          </Card>
        ))}
      </SimpleGrid>
    </Radio.Group>
  );
}

export function Subst() {
  const { data, error, reload } = useAsync<GraceData>(() => apiGet('grace'), []);
  const [f, setF] = useState<GraceData | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { if (data) setF(data); }, [data]);
  function set<K extends keyof GraceData>(k: K, v: GraceData[K]) { setF((p) => (p ? { ...p, [k]: v } : p)); }

  async function save() {
    if (!f) return;
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string }>('save_grace', {
        enabled: f.enabled,
        squad_uuid: f.squad_uuid,
        days: f.days,
        traffic_gb: f.traffic_gb,
        hwid_limit: f.hwid_limit,
        traffic_strategy: f.traffic_strategy,
        reset_traffic_exit: f.reset_traffic_exit,
        external_enabled: f.external_enabled,
        external_squad_uuid: f.external_squad_uuid,
        announce: f.announce,
      });
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || (r.ok ? 'Сохранено' : 'Ошибка') });
    } finally {
      setBusy(false);
    }
  }
  async function refreshRefs() {
    setRefreshing(true);
    try {
      const r = await apiPost<{ ok: boolean; result: Record<string, number | string> }>('grace_refresh_refs', {});
      const res = r.result || {};
      const msg = (res.total as number) === 0 ? 'В грейсе сейчас никого' : `Обновлено ${res.updated} из ${res.total}, без изменений ${res.same}`;
      notifications.show({ color: r.ok ? 'teal' : 'red', message: (res.error as string) || msg });
      reload();
    } finally {
      setRefreshing(false);
    }
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data || !f) return <Center h={200}><Loader color="teal" /></Center>;

  const announcePreview = f.announce.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');

  return (
    <Stack gap="lg" maw={900}>
      <Alert color="blue" variant="light">
        На хук <b>user.expired</b> прослойка переносит юзера в выбранный сквад панели, ставит лимиты и держит активным
        на грейс-период. После грейса — возврат исходного сквада; при оплате — коррекция даты «от сегодня».
      </Alert>

      <Card withBorder radius="md" padding="lg">
        <Row
          title="Включить грейс-сквад"
          desc="На user.expired переносить истёкшего в ограниченный сквад вместо истечения."
          control={<Switch checked={f.enabled} onChange={(e) => set('enabled', e.currentTarget.checked)} />}
        />
        <Text size="sm" fw={500} mt="md" mb="xs">Сквад для истёкших</Text>
        <SquadGrid squads={f.internal_squads} value={f.squad_uuid} onChange={(v) => set('squad_uuid', v)} err={f.internal_err} empty="Список сквадов пуст или API не настроен — заполните «Подключение»." />

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md" mt="lg">
          <NumberInput label="Грейс, дней" description="пусто — по умолчанию" placeholder={String(f.days_default)} min={0}
            value={f.days === '' ? '' : Number(f.days)} onChange={(v) => set('days', v === '' ? '' : String(v))} />
          <TextInput label="Лимит трафика, ГБ" description="0 — без лимита" placeholder="0"
            value={f.traffic_gb} onChange={(e) => set('traffic_gb', e.currentTarget.value)} />
          <TextInput label="Лимит устройств (HWID)" description="пусто — не менять" placeholder="не менять"
            value={f.hwid_limit} onChange={(e) => set('hwid_limit', e.currentTarget.value)} />
          <Select label="Стратегия сброса трафика" data={STRATEGY} value={f.traffic_strategy}
            onChange={(v) => set('traffic_strategy', v || 'NO_RESET')} allowDeselect={false} />
        </SimpleGrid>

        <Row
          title="Сбрасывать трафик на выходе из грейса"
          desc="Счётчик обнуляется при продлении или конце грейса; статус LIMITED снимается."
          control={<Switch checked={f.reset_traffic_exit} onChange={(e) => set('reset_traffic_exit', e.currentTarget.checked)} />}
        />
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Внешний сквад и анонс</Title>
        <Row
          title="Внешний сквад на время грейса"
          desc="Дополнительно к внутреннему: на грейс выдаётся внешний сквад (его announce и заголовки), после — родной."
          control={<Switch checked={f.external_enabled} onChange={(e) => set('external_enabled', e.currentTarget.checked)} />}
        />
        <Text size="sm" fw={500} mt="md" mb="xs">Внешний сквад для грейса</Text>
        <SquadGrid squads={f.external_squads} value={f.external_squad_uuid} onChange={(v) => set('external_squad_uuid', v)} err={f.external_err} empty="Внешних сквадов нет или API не настроен." />

        <Text size="sm" fw={500} mt="lg">Фолбэк: анонс из прослойки</Text>
        <Text size="xs" c="dimmed" mb="xs">Работает, если внешний сквад не задан. Каждая строка — отдельный перенос, лимит 200 символов.</Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          <Textarea
            autosize
            minRows={4}
            maxLength={400}
            placeholder={'Подписка истекла\nПродлите — доступ вернётся\nПоддержка: @your_bot'}
            value={f.announce}
            onChange={(e) => set('announce', e.currentTarget.value)}
          />
          <Card withBorder radius="md" padding={0} style={{ overflow: 'hidden', alignSelf: 'start' }}>
            <Group gap="xs" p="xs" bg="var(--mantine-color-teal-light)">
              <Text size="xs" fw={600} c="teal">📣 Объявление</Text>
            </Group>
            <Text size="sm" p="sm" style={{ whiteSpace: 'pre-wrap', minHeight: 60 }}>
              {announcePreview || <Text span c="dimmed" fs="italic">— анонс выключен —</Text>}
            </Text>
          </Card>
        </SimpleGrid>
      </Card>

      <Group>
        <Button leftSection={<IconDeviceFloppy size={16} />} onClick={save} loading={busy}>Сохранить</Button>
      </Group>

      <Card withBorder radius="md" padding="lg">
        <Row
          title="Идентификаторы пользователей в грейсе"
          desc="Панель 3.0 перешла с uuid на числовой id. Кнопка пересчитает записи, сделанные до обновления панели."
          control={
            <Button variant="default" leftSection={<IconRefresh size={16} />} onClick={refreshRefs} loading={refreshing}>
              Обновить идентификаторы
            </Button>
          }
        />
      </Card>
    </Stack>
  );
}
