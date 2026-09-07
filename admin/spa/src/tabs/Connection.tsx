import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Center,
  Checkbox,
  Group,
  Loader,
  NumberInput,
  PasswordInput,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDeviceFloppy, IconInfoCircle } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface ConnData {
  ok: true;
  in_docker: boolean;
  target_domain: string;
  mirror_domain: string;
  remnawave_url: string;
  remnawave_cookie: string;
  remnawave_xapikey: string;
  api_key_set: boolean;
  webhook_secret_set: boolean;
  proxy_timeout: number;
  trust_header_expire: boolean;
  tls_verify: boolean;
  sub_source: 'mirror' | 'panel';
  subpage_external_url: string;
  sub_link_apisub: boolean;
  sub_prefix_enabled: boolean;
  sub_prefix: string;
  sub_link_prefix: boolean;
  mask_notfound: boolean;
  ua_hwid_parse: boolean;
  ua_hwid_keys: string[];
  ua_hwid_keys_all: string[];
  panel_sub_domain: string;
}

const UA_KEY_LABEL: Record<string, string> = {
  'x-hwid': 'идентификатор устройства (влияет на лимит)',
  'x-device-os': 'ОС устройства',
  'x-ver-os': 'версия ОС',
  'x-device-model': 'модель устройства',
};

interface Form {
  target_domain: string;
  mirror_domain: string;
  remnawave_url: string;
  remnawave_cookie: string;
  remnawave_xapikey: string;
  remnawave_api_key: string;
  webhook_secret: string;
  proxy_timeout: number;
  trust_header_expire: boolean;
  tls_verify: boolean;
  sub_source: 'mirror' | 'panel';
  subpage_external_url: string;
  sub_link_apisub: boolean;
  sub_prefix_enabled: boolean;
  sub_prefix: string;
  sub_link_prefix: boolean;
  mask_notfound: boolean;
  ua_hwid_parse: boolean;
  ua_hwid_keys: string[];
}

function SettingRow({ title, desc, control }: { title: string; desc?: string; control: React.ReactNode }) {
  return (
    <Group justify="space-between" align="center" wrap="nowrap" gap="md" py={4}>
      <div style={{ minWidth: 0 }}>
        <Text size="sm" fw={500}>{title}</Text>
        {desc && <Text size="xs" c="dimmed">{desc}</Text>}
      </div>
      <div style={{ flex: '0 0 auto' }}>{control}</div>
    </Group>
  );
}

export function Connection() {
  const { data, error } = useAsync<ConnData>(() => apiGet('connection'), []);
  const [f, setF] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setF({
      target_domain: data.target_domain,
      mirror_domain: data.mirror_domain,
      remnawave_url: data.remnawave_url,
      remnawave_cookie: data.remnawave_cookie,
      remnawave_xapikey: data.remnawave_xapikey,
      remnawave_api_key: '',
      webhook_secret: '',
      proxy_timeout: data.proxy_timeout,
      trust_header_expire: data.trust_header_expire,
      tls_verify: data.tls_verify,
      sub_source: data.sub_source,
      subpage_external_url: data.subpage_external_url,
      sub_link_apisub: data.sub_link_apisub,
      sub_prefix_enabled: data.sub_prefix_enabled,
      sub_prefix: data.sub_prefix,
      sub_link_prefix: data.sub_link_prefix,
      mask_notfound: data.mask_notfound,
      ua_hwid_parse: data.ua_hwid_parse,
      ua_hwid_keys: data.ua_hwid_keys,
    });
  }, [data]);

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setF((p) => (p ? { ...p, [k]: v } : p));
  }

  async function save() {
    if (!f) return;
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string; error?: string }>('save_connection', f);
      if (r.ok) notifications.show({ color: 'teal', message: r.msg || 'Сохранено' });
      else notifications.show({ color: 'red', message: r.error || 'Ошибка' });
    } catch (e) {
      notifications.show({ color: 'red', message: e instanceof Error ? e.message : 'Ошибка' });
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  }
  if (!data || !f) {
    return <Center h={200}><Loader color="teal" /></Center>;
  }

  const docker = data.in_docker;
  const showSubpageUrl = (docker ? 'panel' : f.sub_source) === 'panel';
  const showPanelHint = data.panel_sub_domain !== '' && data.panel_sub_domain.toLowerCase() !== f.target_domain.toLowerCase();

  return (
    <Stack gap="lg" maw={900}>
      {docker && (
        <Alert color="blue" icon={<IconInfoCircle size={16} />}>
          Docker-режим: источник «Панель» и адреса панели/subpage заданы окружением контейнера и здесь только для
          чтения. Достаточно задать API-токен панели.
        </Alert>
      )}

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="md">Панель и домены</Title>
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput
              label="Origin — домен подписки"
              placeholder="sub.example.com"
              value={f.target_domain}
              onChange={(e) => set('target_domain', e.currentTarget.value)}
            />
            <TextInput
              label="Домен зеркала"
              placeholder="mirror.example.com"
              value={f.mirror_domain}
              onChange={(e) => set('mirror_domain', e.currentTarget.value)}
            />
          </SimpleGrid>
          {showPanelHint && (
            <Text size="xs" c="dimmed">
              В панели домен подписки — <Text span ff="monospace">{data.panel_sub_domain}</Text>.{' '}
              <Text span c="teal" style={{ cursor: 'pointer' }} onClick={() => set('target_domain', data.panel_sub_domain)}>
                Подставить в origin
              </Text>
            </Text>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <TextInput
              label="URL панели Remnawave"
              placeholder="https://panel.example.com"
              value={f.remnawave_url}
              onChange={(e) => set('remnawave_url', e.currentTarget.value)}
              readOnly={docker}
            />
            <TextInput
              label="Cookie панели (eGames-защита)"
              placeholder="aB3xK9pQ=Zt7mW2nR"
              value={f.remnawave_cookie}
              onChange={(e) => set('remnawave_cookie', e.currentTarget.value)}
            />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            <PasswordInput
              label="API-токен панели"
              placeholder={data.api_key_set ? '•••••• задан (оставьте пустым, чтобы не менять)' : 'не задан'}
              value={f.remnawave_api_key}
              onChange={(e) => set('remnawave_api_key', e.currentTarget.value)}
            />
            <PasswordInput
              label="Секрет вебхука"
              placeholder={data.webhook_secret_set ? '•••••• задан' : 'не задан'}
              value={f.webhook_secret}
              onChange={(e) => set('webhook_secret', e.currentTarget.value)}
            />
          </SimpleGrid>
          <TextInput
            label="X-Api-Key (caddy-with-auth)"
            placeholder="если панель за Caddy with custom path; иначе пусто"
            value={f.remnawave_xapikey}
            onChange={(e) => set('remnawave_xapikey', e.currentTarget.value)}
          />
        </Stack>
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Поведение прокси</Title>
        <Stack gap={4}>
          <SettingRow
            title="Таймаут проксирования, сек"
            desc="Сколько ждать ответа origin при запросе подписки."
            control={
              <NumberInput w={110} min={5} value={f.proxy_timeout} onChange={(v) => set('proxy_timeout', Number(v) || 30)} />
            }
          />
          <SettingRow
            title="Доверять заголовку expire"
            desc="Рекомендуется — продление подписки чинит себя само."
            control={<Switch checked={f.trust_header_expire} onChange={(e) => set('trust_header_expire', e.currentTarget.checked)} />}
          />
          <SettingRow
            title="Проверять TLS-сертификат панели и origin"
            desc="Защита от MITM. Выключайте только при самоподписанном сертификате."
            control={<Switch checked={f.tls_verify} onChange={(e) => set('tls_verify', e.currentTarget.checked)} />}
          />
          <SettingRow
            title="Обезличивать 404"
            desc="На неизвестный путь отдаётся собственный пустой 404 без заголовков панели."
            control={<Switch checked={f.mask_notfound} onChange={(e) => set('mask_notfound', e.currentTarget.checked)} />}
          />
        </Stack>
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">Источник подписки и ссылки</Title>
        <Stack gap="sm">
          <SettingRow
            title="Источник подписки"
            desc="«Зеркало» — проксирование origin. «Панель» — прослойка сама становится sub-сервисом Remnawave."
            control={
              <SegmentedControl
                value={docker ? 'panel' : f.sub_source}
                onChange={(v) => set('sub_source', v as 'mirror' | 'panel')}
                disabled={docker}
                data={[
                  { value: 'mirror', label: 'Зеркало' },
                  { value: 'panel', label: 'Панель' },
                ]}
              />
            }
          />
          {showSubpageUrl && (
            <TextInput
              label="Адрес subscription-page"
              description="Рядом с панелью — адрес контейнера/loopback; на отдельном сервере — публичный https-адрес панели."
              placeholder="https://panel.example.com или http://127.0.0.1:3010"
              value={f.subpage_external_url}
              onChange={(e) => set('subpage_external_url', e.currentTarget.value)}
              readOnly={docker}
            />
          )}
          <SettingRow
            title="Ссылки в формате /api/sub/"
            desc="Показывать ссылки во вкладке «Пользователи» как /api/sub/<shortUuid>."
            control={<Switch checked={f.sub_link_apisub} onChange={(e) => set('sub_link_apisub', e.currentTarget.checked)} />}
          />
          <SettingRow
            title="Префикс подписки (CUSTOM_SUB_PREFIX)"
            desc="Снимать префикс перед определением shortUuid и возвращать его в запросе к origin."
            control={<Switch checked={f.sub_prefix_enabled} onChange={(e) => set('sub_prefix_enabled', e.currentTarget.checked)} />}
          />
          {f.sub_prefix_enabled && (
            <>
              <TextInput
                label="Значение префикса"
                description="Без слэшей по краям, например sub."
                placeholder="sub"
                value={f.sub_prefix}
                onChange={(e) => set('sub_prefix', e.currentTarget.value)}
              />
              <SettingRow
                title="Ссылки с префиксом"
                desc="Показывать ссылки как /<prefix>/<shortUuid> — один в один с панелью."
                control={<Switch checked={f.sub_link_prefix} onChange={(e) => set('sub_link_prefix', e.currentTarget.checked)} />}
              />
            </>
          )}
        </Stack>
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Title order={5} mb="xs">HWID из User-Agent</Title>
        <Stack gap="sm">
          <SettingRow
            title="Извлекать device-заголовки из User-Agent"
            desc="Для клиентов, которые не шлют HTTP-заголовки, но дают менять UA. Реальный заголовок всегда главнее. Ослабляет лимит устройств — это удобство, не защита."
            control={<Switch checked={f.ua_hwid_parse} onChange={(e) => set('ua_hwid_parse', e.currentTarget.checked)} />}
          />
          {f.ua_hwid_parse && (
            <Checkbox.Group value={f.ua_hwid_keys} onChange={(v) => set('ua_hwid_keys', v)}>
              <Text size="xs" c="dimmed" mb="xs">Какие ключи извлекать, когда настоящего заголовка нет:</Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                {data.ua_hwid_keys_all.map((k) => (
                  <Checkbox
                    key={k}
                    value={k}
                    label={
                      <span>
                        <Text span ff="monospace" fz="sm">{k}</Text>{' '}
                        <Text span c="dimmed" fz="xs">— {UA_KEY_LABEL[k] ?? ''}</Text>
                      </span>
                    }
                  />
                ))}
              </SimpleGrid>
            </Checkbox.Group>
          )}
        </Stack>
      </Card>

      <Group>
        <Button leftSection={<IconDeviceFloppy size={16} />} onClick={save} loading={busy}>
          Сохранить подключение
        </Button>
      </Group>
    </Stack>
  );
}
