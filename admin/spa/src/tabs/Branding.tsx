import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Center,
  Code,
  Group,
  Image,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDeviceFloppy, IconRefresh } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface BrandData {
  ok: true;
  service_name: string;
  service_logo_url: string;
  brand_name: string;
  brand_logo_file: string;
  brand_emoji: string;
  cache_name: string;
  cache_logo_url: string;
  cache_logo_file: string;
  cache_api_error: string;
  landing_preset: number;
  landing_fp: string;
  landing_fp_ack: boolean;
  chat_enabled: boolean;
}

function logoSrc(file: string): string {
  if (!file) return '';
  if (/^(https?:|data:|\/)/.test(file)) return file;
  return '/admin/' + file;
}

const PRESETS: { value: number; name: string; preview: React.ReactNode }[] = [
  { value: 1, name: 'Классическая карточка', preview: <PvCard bg="#eef2f7" /> },
  { value: 2, name: 'Сплит-экран', preview: <PvSplit /> },
  { value: 3, name: 'Тёмная (стекло)', preview: <PvCard bg="#0b1020" dark /> },
  { value: 4, name: 'Минимализм', preview: <PvCard bg="#f8fafc" teal /> },
];

function PvCard({ bg, dark, teal }: { bg: string; dark?: boolean; teal?: boolean }) {
  const accent = teal ? '#0f766e' : dark ? 'linear-gradient(160deg,#6366f1,#22d3ee)' : 'linear-gradient(160deg,#4f46e5,#7c73f0)';
  return (
    <Center h={80} style={{ background: bg, borderRadius: 8 }}>
      <Box style={{ width: 52, height: 62, background: dark ? 'rgba(255,255,255,.08)' : '#fff', border: '1px solid ' + (dark ? 'rgba(255,255,255,.18)' : '#e5e7eb'), borderRadius: 6, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 7 }}>
        <Box style={{ width: 16, height: 16, borderRadius: teal ? '50%' : 5, background: accent }} />
        <Box style={{ width: '100%', height: 5, borderRadius: 3, background: dark ? 'rgba(255,255,255,.18)' : '#e5e7eb' }} />
        <Box style={{ width: '100%', height: 5, borderRadius: 3, background: dark ? 'rgba(255,255,255,.18)' : '#e5e7eb' }} />
        <Box style={{ width: '100%', height: 7, borderRadius: 3, marginTop: 'auto', background: accent }} />
      </Box>
    </Center>
  );
}
function PvSplit() {
  return (
    <Center h={80} style={{ background: '#eef2f7', borderRadius: 8 }}>
      <Box style={{ display: 'flex', width: 72, height: 62, borderRadius: 6, overflow: 'hidden', boxShadow: '0 4px 10px rgba(31,41,55,.15)' }}>
        <Box style={{ width: '42%', background: 'linear-gradient(150deg,#4f46e5,#7c3aed)' }} />
        <Box style={{ flex: 1, background: '#fff', display: 'flex', flexDirection: 'column', gap: 4, padding: 7 }}>
          <Box style={{ width: '100%', height: 5, borderRadius: 3, background: '#e5e7eb' }} />
          <Box style={{ width: '100%', height: 5, borderRadius: 3, background: '#e5e7eb' }} />
          <Box style={{ width: '100%', height: 7, borderRadius: 3, marginTop: 'auto', background: '#4f46e5' }} />
        </Box>
      </Box>
    </Center>
  );
}

export function Branding() {
  const { data, error, reload } = useAsync<BrandData>(() => apiGet('branding'), []);
  const [name, setName] = useState('');
  const [logo, setLogo] = useState('');
  const [preset, setPreset] = useState(1);
  const [busy, setBusy] = useState(false);
  const [regen, setRegen] = useState(false);

  useEffect(() => {
    if (!data) return;
    setName(data.service_name);
    setLogo(data.service_logo_url);
    setPreset(data.landing_preset);
  }, [data]);

  async function saveBranding() {
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string }>('save_branding', { service_name: name, service_logo_url: logo });
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || (r.ok ? 'Сохранено' : 'Ошибка') });
      if (r.ok) reload();
    } finally {
      setBusy(false);
    }
  }
  async function selectPreset(v: number) {
    setPreset(v);
    const r = await apiPost<{ ok: boolean; msg?: string }>('save_landing', { landing_preset: v });
    if (r.ok) notifications.show({ color: 'teal', message: r.msg || 'Сохранено' });
  }
  async function regenFp() {
    setRegen(true);
    try {
      const r = await apiPost<{ ok: boolean; fp?: string }>('landing_regen_fp', {});
      if (r.ok) {
        notifications.show({ color: 'teal', message: 'Отпечаток перегенерирован — установка стала уникальной' });
        reload();
      }
    } finally {
      setRegen(false);
    }
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data) return <Center h={200}><Loader color="teal" /></Center>;

  const src = logoSrc(data.brand_logo_file);

  return (
    <Stack gap="lg" maw={820}>
      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Брендинг сервиса</Title>
        <Text size="sm" c="dimmed" mb={4}>
          Имя и лого тянутся из API панели → идут в название, лого и фавикон админки. Сейчас: «{data.brand_name || '—'}»
          {data.brand_logo_file ? ', лого закешировано' : ', лого не задано'}.
        </Text>
        <Text size="xs" c="dimmed">
          Из API: имя — <Code>{data.cache_name || '(пусто)'}</Code>; URL лого — <Code>{data.cache_logo_url || '(не найден)'}</Code>
          {data.cache_api_error && (
            <> · <Text span c="red" fw={600}>Ошибка API:</Text> <Code>{data.cache_api_error}</Code></>
          )}
        </Text>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" mt="md">
          <TextInput
            label="Имя сервиса"
            description="вручную; пусто — берётся из панели"
            placeholder="пусто = из панели"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <TextInput
            label="URL лого"
            description="вручную; пусто — берётся из панели"
            placeholder="пусто = из панели"
            value={logo}
            onChange={(e) => setLogo(e.currentTarget.value)}
          />
        </SimpleGrid>
        {src && (
          <Group gap="sm" mt="md" align="center">
            <Image src={src} w={34} h={34} radius="sm" fit="contain" style={{ border: '1px solid var(--mantine-color-default-border)' }} />
            <Text size="sm" c="dimmed">текущее лого (кеш на диске)</Text>
          </Group>
        )}
        <Group mt="lg">
          <Button leftSection={<IconDeviceFloppy size={16} />} onClick={saveBranding} loading={busy}>
            Сохранить и обновить из API
          </Button>
        </Group>
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Дизайн страницы-заглушки</Title>
        <Text size="sm" c="dimmed" mb="md">
          Как выглядит публичная корневая страница зеркала — фальшивый вход, который видят посторонние и сканеры.
          {data.chat_enabled ? ' Сейчас на ней также показывается виджет чата поддержки.' : ' Виджет чата появится, если включить чат.'}
        </Text>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
          {PRESETS.map((p) => (
            <Card
              key={p.value}
              withBorder
              radius="md"
              padding="xs"
              onClick={() => selectPreset(p.value)}
              style={{
                cursor: 'pointer',
                borderColor: preset === p.value ? 'var(--mantine-color-teal-6)' : undefined,
                borderWidth: 2,
              }}
            >
              {p.preview}
              <Text size="xs" fw={600} ta="center" mt="xs">{p.name}</Text>
            </Card>
          ))}
        </SimpleGrid>
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Отпечаток страницы-заглушки</Title>
        <Text size="sm" c="dimmed">
          Чтобы вашу установку нельзя было найти автопоиском по общему шаблону, заглушка подмешивает уникальный отпечаток.
          Перегенерируйте его — и корневая страница станет уникальной для вашего сервера.
        </Text>
        {!data.landing_fp_ack && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} mt="sm">
            Нажмите «Перегенерировать» сразу после установки — пока этого нет, заглушка совпадает с шаблоном и вашу
            панель можно вычислить автопоиском.
          </Alert>
        )}
        <Text mt="sm" size="sm">
          Текущий отпечаток: <Code>{data.landing_fp.slice(0, 12)}</Code>
        </Text>
        <Group mt="sm">
          <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={regenFp} loading={regen}>
            Перегенерировать отпечаток
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}
