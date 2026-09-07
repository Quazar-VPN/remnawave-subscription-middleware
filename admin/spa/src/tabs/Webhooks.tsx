import { useEffect, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Center,
  Code,
  CopyButton,
  Group,
  Loader,
  NumberInput,
  PasswordInput,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconCheck, IconCopy, IconDeviceFloppy, IconFlask, IconPlus, IconTrash } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface Target {
  name: string;
  url: string;
  secret: string;
  enabled: boolean;
}
interface WhData {
  ok: true;
  panel_webhook: boolean | null;
  wh_url: string;
  webhook_secret: string;
  forward_enabled: boolean;
  forward_timeout: number;
  forward_targets: Target[];
}
interface TestResult {
  name?: string;
  url?: string;
  ok: boolean;
  code?: number | string;
  error?: string;
}

export function Webhooks() {
  const { data, error } = useAsync<WhData>(() => apiGet('webhooks'), []);
  const [enabled, setEnabled] = useState(false);
  const [timeout, setTimeoutVal] = useState(8);
  const [targets, setTargets] = useState<Target[]>([]);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<TestResult[] | null>(null);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.forward_enabled);
    setTimeoutVal(data.forward_timeout);
    setTargets(data.forward_targets);
  }, [data]);

  function setT(i: number, patch: Partial<Target>) {
    setTargets((p) => p.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  async function save() {
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string }>('save_forward', {
        forward_enabled: enabled,
        forward_timeout: timeout,
        forward_targets: targets.filter((t) => t.url.trim()),
      });
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || (r.ok ? 'Сохранено' : 'Ошибка') });
    } finally {
      setBusy(false);
    }
  }
  async function test() {
    setTesting(true);
    setResults(null);
    try {
      const r = await apiPost<{ ok: boolean; results: TestResult[] }>('test_forward', { targets });
      setResults(r.results || []);
    } finally {
      setTesting(false);
    }
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data) return <Center h={200}><Loader color="teal" /></Center>;

  const env = `WEBHOOK_ENABLED=true\nWEBHOOK_URL=${data.wh_url}\nWEBHOOK_SECRET_HEADER=${data.webhook_secret || '<секрет из «Подключения»>'}`;

  return (
    <Stack gap="lg" maw={900}>
      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Как включить вебхук в Remnawave</Title>
        {data.panel_webhook === false && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} mb="sm">
            В панели вебхуки сейчас <b>выключены</b> (<Code>WEBHOOK_ENABLED=false</Code>) — прослойка не получит ни
            одного события. Блокировки и грейс будут срабатывать только по факту запроса подписки. Включите в{' '}
            <Code>.env</Code> панели и перезапустите её.
          </Alert>
        )}
        {data.panel_webhook === true && (
          <Group gap="xs" mb="sm">
            <Badge color="teal" variant="light">вкл</Badge>
            <Text size="sm" c="dimmed">В панели вебхуки включены (по данным /api/system/configuration).</Text>
          </Group>
        )}
        <Text size="sm" c="dimmed" mb="xs">Добавьте эти строки в <Code>.env</Code> панели и перезапустите её:</Text>
        <Card withBorder radius="sm" bg="var(--mantine-color-default)" p="sm" style={{ position: 'relative' }}>
          <Code block style={{ background: 'transparent', whiteSpace: 'pre-wrap' }}>{env}</Code>
          <CopyButton value={env}>
            {({ copied, copy }) => (
              <Tooltip label={copied ? 'Скопировано' : 'Копировать'}>
                <ActionIcon variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy} style={{ position: 'absolute', top: 8, right: 8 }}>
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        </Card>
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5}>Раздвоение вебхука («тройник»)</Title>
        <Text size="sm" c="dimmed" mt={4} mb="md">
          Нужен, если адресатам нужны разные секреты или пересылка после обработки прослойкой. URL прослойки:{' '}
          <Code>{data.wh_url}</Code>.
        </Text>
        <Group justify="space-between" py={4}>
          <div>
            <Text size="sm" fw={500}>Включить пересылку</Text>
            <Text size="xs" c="dimmed">Пересылать входящие вебхуки адресатам из списка ниже.</Text>
          </div>
          <Switch checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />
        </Group>
        <Group justify="space-between" py={4}>
          <div>
            <Text size="sm" fw={500}>Таймаут на адрес, сек</Text>
            <Text size="xs" c="dimmed">Сколько ждать ответа каждого адресата.</Text>
          </div>
          <NumberInput w={110} min={2} value={timeout} onChange={(v) => setTimeoutVal(Number(v) || 8)} />
        </Group>

        <Text size="sm" fw={500} mt="lg" mb="xs">Адресаты</Text>
        <Stack gap="xs">
          {targets.length === 0 && <Text size="sm" c="dimmed">Адресатов нет — добавьте первого.</Text>}
          {targets.map((t, i) => (
            <Group key={i} gap="xs" wrap="nowrap" align="center">
              <TextInput placeholder="имя (бот)" value={t.name} onChange={(e) => setT(i, { name: e.currentTarget.value })} w={140} />
              <TextInput placeholder="https://bot.example.com/webhook" value={t.url} onChange={(e) => setT(i, { url: e.currentTarget.value })} style={{ flex: 1 }} />
              <PasswordInput placeholder="секрет" value={t.secret} onChange={(e) => setT(i, { secret: e.currentTarget.value })} w={160} />
              <Tooltip label={t.enabled ? 'Включён' : 'Выключен'}>
                <Switch checked={t.enabled} onChange={(e) => setT(i, { enabled: e.currentTarget.checked })} />
              </Tooltip>
              <ActionIcon variant="subtle" color="red" onClick={() => setTargets((p) => p.filter((_, idx) => idx !== i))} aria-label="Удалить">
                <IconTrash size={16} />
              </ActionIcon>
            </Group>
          ))}
        </Stack>

        <Group mt="md" gap="sm">
          <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setTargets((p) => [...p, { name: '', url: '', secret: '', enabled: true }])}>
            Добавить адресата
          </Button>
          <Button variant="default" leftSection={<IconFlask size={16} />} onClick={test} loading={testing}>
            Тест пересылки
          </Button>
          <Button leftSection={<IconDeviceFloppy size={16} />} onClick={save} loading={busy}>
            Сохранить раздвоение
          </Button>
        </Group>

        {results && (
          <Stack gap={4} mt="md">
            {results.length === 0 ? (
              <Text size="sm" c="dimmed">Нет включённых адресатов с корректным URL.</Text>
            ) : (
              results.map((x, i) => (
                <Group key={i} gap="xs">
                  <Badge color={x.ok ? 'teal' : 'red'} variant="light">
                    {x.ok ? `ok ${x.code}` : `${x.code || '—'}${x.error ? ' ' + x.error : ''}`}
                  </Badge>
                  <Text size="sm">{x.name || x.url}</Text>
                </Group>
              ))
            )}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}
