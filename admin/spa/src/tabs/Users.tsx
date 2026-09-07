import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  CopyButton,
  Group,
  Loader,
  Modal,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconArrowsSort,
  IconChevronUp,
  IconChevronDown,
  IconDeviceMobile,
  IconEye,
  IconEyeOff,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconBan,
} from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface UserRow {
  username: string;
  status: string;
  short_uuid: string;
  uuid: string;
  limit: number | null;
  expire_ts: number | null;
  sub_link: string;
  src: 'mw' | 'panel';
  in_grace: boolean;
  has_hwid_block: boolean;
  nolog: boolean;
  addsub: string;
}
interface UsersData {
  ok: true;
  error: string;
  mirror: string;
  count: number;
  blocked_hwids: string[];
  users: UserRow[];
}
interface Device {
  hwid?: string;
  deviceModel?: string;
  platform?: string;
  osVersion?: string;
  userAgent?: string;
  user_agent?: string;
  appVersion?: string;
  updatedAt?: string;
  createdAt?: string;
}

const MONO = { fontFamily: 'var(--mantine-font-family-monospace)' };

const STATUS: Record<string, { color: string; label: string }> = {
  ACTIVE: { color: 'teal', label: 'ACTIVE' },
  LIMITED: { color: 'yellow', label: 'LIMITED' },
  EXPIRED: { color: 'orange', label: 'EXPIRED' },
  DISABLED: { color: 'gray', label: 'DISABLED' },
};

function Dot() {
  return <Box style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }} />;
}
function StatusBadge({ status, grace }: { status: string; grace: boolean }) {
  if (grace) return <Badge color="cyan" variant="light" leftSection={<Dot />}>ГРЕЙС</Badge>;
  const s = STATUS[status] ?? { color: 'gray', label: status || '—' };
  return (
    <Badge color={s.color} variant="light" leftSection={<Dot />} style={{ textTransform: 'none' }}>
      {s.label}
    </Badge>
  );
}

function fmtExpire(ts: number | null): string {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} в ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function osFile(p?: string): string {
  const s = (p || '').toLowerCase();
  if (/ios|iphone|ipad|mac|darwin|os ?x/.test(s)) return 'apple';
  if (/android/.test(s)) return 'android';
  if (/win/.test(s)) return 'windows';
  if (/linux|ubuntu|debian|fedora|arch|centos/.test(s)) return 'linux';
  return 'device';
}
function OsIcon({ platform }: { platform?: string }) {
  const f = osFile(platform);
  return (
    <Box
      component="span"
      style={{
        display: 'inline-block',
        width: 26,
        height: 26,
        flex: '0 0 auto',
        background: 'var(--mantine-color-text)',
        WebkitMaskImage: `url(/admin/assets/os/${f}.svg)`,
        maskImage: `url(/admin/assets/os/${f}.svg)`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  );
}

// --- Модалка устройств (монтируется только при открытии) ---------------------
function DevicesModal({
  user,
  onClose,
}: {
  user: { uuid: string; name: string; limit: number | null };
  onClose: () => void;
}) {
  const { data, loading, error, reload } = useAsync<{ devices: Device[]; blocked_hwids: string[]; error: string }>(
    () => apiGet('user_devices', { uuid: user.uuid }),
    [user.uuid]
  );
  const [busy, setBusy] = useState<string>('');

  async function del(hwid: string) {
    if (!confirm(`Удалить устройство?\n${hwid}`)) return;
    setBusy(hwid);
    try {
      const r = await apiPost<{ ok: boolean; error?: string }>('user_hwid_delete', { uuid: user.uuid, hwid });
      if (r.ok) reload();
      else notifications.show({ color: 'red', message: r.error || 'Не удалось удалить' });
    } finally {
      setBusy('');
    }
  }
  async function block(hwid: string, blocked: boolean) {
    setBusy(hwid);
    try {
      const r = await apiPost<{ ok: boolean; error?: string }>('user_hwid_block', { hwid, username: user.name, block: !blocked });
      if (r.ok) reload();
      else notifications.show({ color: 'red', message: r.error || 'Ошибка' });
    } finally {
      setBusy('');
    }
  }

  const devices = data?.devices ?? [];
  const blocked = new Set((data?.blocked_hwids ?? []).map((x) => x.toLowerCase()));

  return (
    <Modal opened onClose={onClose} title={`Устройства · ${user.name || ''}`} size="lg" radius="md">
      {loading && !data ? (
        <Center h={120}><Loader color="teal" /></Center>
      ) : error || data?.error ? (
        <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error || data?.error}</Alert>
      ) : (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Устройств: {devices.length}
            {user.limit != null && ` / лимит ${user.limit}`}
          </Text>
          {devices.length === 0 ? (
            <Text c="dimmed" size="sm">Устройств нет.</Text>
          ) : (
            devices.map((x, i) => {
              const hwid = x.hwid || '';
              const isBlocked = blocked.has(hwid.toLowerCase());
              const model = x.deviceModel || x.platform || 'Устройство';
              const os = [x.platform, x.osVersion].filter(Boolean).join(' ') || 'ОС неизвестна';
              const client = x.userAgent || x.user_agent || x.appVersion || '';
              const dt = x.updatedAt || x.createdAt;
              return (
                <Card key={hwid || i} withBorder radius="md" padding="sm">
                  <Group justify="space-between" wrap="nowrap" align="flex-start">
                    <Group wrap="nowrap" align="flex-start" gap="sm" style={{ minWidth: 0 }}>
                      <Tooltip label={os} withArrow>
                        <span><OsIcon platform={x.platform} /></span>
                      </Tooltip>
                      <Box style={{ minWidth: 0 }}>
                        <Group gap="xs">
                          <Text fw={600}>{model}</Text>
                          {isBlocked && <Badge color="red" size="xs" variant="light">заблокирован</Badge>}
                        </Group>
                        <Text size="xs" c="dimmed" style={{ wordBreak: 'break-word' }}>
                          {client ? `Клиент: ${client}` : 'клиент не указан'}
                        </Text>
                        <Text size="xs" c="dimmed" style={{ ...MONO, wordBreak: 'break-all' }}>
                          {hwid}
                          {dt && ` · ${new Date(dt).toLocaleString('ru-RU')}`}
                        </Text>
                      </Box>
                    </Group>
                    <Group gap="xs" wrap="nowrap">
                      <Tooltip label={isBlocked ? 'Разблокировать' : 'Заблокировать по HWID'}>
                        <ActionIcon
                          variant="light"
                          color={isBlocked ? 'teal' : 'orange'}
                          loading={busy === hwid}
                          onClick={() => block(hwid, isBlocked)}
                          aria-label="block"
                        >
                          <IconBan size={16} />
                        </ActionIcon>
                      </Tooltip>
                      <Tooltip label="Удалить устройство">
                        <ActionIcon variant="light" color="red" loading={busy === hwid} onClick={() => del(hwid)} aria-label="delete">
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  </Group>
                </Card>
              );
            })
          )}
        </Stack>
      )}
    </Modal>
  );
}

// --- Модалка доп-подписки (монтируется только при открытии) ------------------
function AddsubModal({
  target,
  onClose,
  onSaved,
}: {
  target: { short: string; name: string; url: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(target.url);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    const u = url.trim();
    if (!u) return setErr('Введите адрес подписки');
    if (!/^https?:\/\//i.test(u)) return setErr('URL должен начинаться с http:// или https://');
    setBusy(true);
    setErr('');
    try {
      const r = await apiPost<{ ok: boolean; error?: string }>('addsub_map', { short: target.short, url: u });
      if (r.ok) {
        notifications.show({ color: 'teal', message: 'Доп-подписка привязана' });
        onSaved();
        onClose();
      } else setErr(r.error || 'Ошибка');
    } finally {
      setBusy(false);
    }
  }
  async function del() {
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean }>('addsub_map_del', { short: target.short });
      if (r.ok) {
        notifications.show({ color: 'teal', message: 'Доп-подписка отвязана' });
        onSaved();
        onClose();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal opened onClose={onClose} title={`Доп-подписка · ${target.name || ''}`} size="lg" radius="md">
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Вставьте адрес второй подписки (URL) — её серверы подмешаются в основную ссылку этого пользователя. Основная
          ссылка не меняется. Работает, пока основная подписка активна.
        </Text>
        <TextInput
          placeholder="https://…/sub/…"
          value={url}
          onChange={(e) => setUrl(e.currentTarget.value)}
          styles={{ input: MONO }}
          spellCheck={false}
        />
        {err && <Text c="red" size="sm">{err}</Text>}
        <Group>
          <Button onClick={save} loading={busy}>Сохранить</Button>
          {target.url && (
            <Button variant="default" onClick={del} loading={busy}>Отвязать</Button>
          )}
          <Button variant="subtle" color="gray" onClick={onClose}>Отмена</Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// --- Основной таб ------------------------------------------------------------
type SortCol = 'username' | 'status' | 'expire_ts' | 'src';
const PAGE_SIZES = ['10', '25', '50'];

export function Users() {
  const { data, loading, error, reload } = useAsync<UsersData>(() => apiGet('users'), []);
  const [q, setQ] = useState('');
  const [size, setSize] = useState('50');
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ col: SortCol; dir: 1 | -1 }>({ col: 'username', dir: 1 });
  const [nolog, setNolog] = useState<Record<string, boolean>>({});
  const [devUser, setDevUser] = useState<{ uuid: string; name: string; limit: number | null } | null>(null);
  const [addsub, setAddsub] = useState<{ short: string; name: string; url: string } | null>(null);

  const users = data?.users ?? [];

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    const rows = needle
      ? users.filter((u) => `${u.username} ${u.status} ${u.short_uuid}`.toLowerCase().includes(needle))
      : users.slice();
    const { col, dir } = sort;
    rows.sort((a, b) => {
      const x = col === 'expire_ts' ? a.expire_ts ?? 0 : String(a[col] ?? '').toLowerCase();
      const y = col === 'expire_ts' ? b.expire_ts ?? 0 : String(b[col] ?? '').toLowerCase();
      if (x === y) return 0;
      return (x < y ? -1 : 1) * dir;
    });
    return rows;
  }, [users, q, sort]);

  const per = parseInt(size, 10);
  const pages = Math.max(1, Math.ceil(filtered.length / per));
  const pageRows = filtered.slice((page - 1) * per, page * per);

  function toggleSort(col: SortCol) {
    setSort((s) => (s.col === col ? { col, dir: s.dir === 1 ? -1 : 1 } : { col, dir: 1 }));
  }
  function Th({ col, children }: { col: SortCol; children: React.ReactNode }) {
    const active = sort.col === col;
    return (
      <Table.Th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(col)}>
        <Group gap={4} wrap="nowrap">
          {children}
          {active ? (
            sort.dir === 1 ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />
          ) : (
            <IconArrowsSort size={13} opacity={0.35} />
          )}
        </Group>
      </Table.Th>
    );
  }

  function isNolog(u: UserRow) {
    return u.short_uuid in nolog ? nolog[u.short_uuid] : u.nolog;
  }
  async function toggleNolog(u: UserRow) {
    const next = !isNolog(u);
    setNolog((p) => ({ ...p, [u.short_uuid]: next }));
    try {
      await apiPost('reqlog_nolog', { short: u.short_uuid, on: next });
      notifications.show({ color: 'teal', message: next ? 'Скрыт из лога' : 'Логирование включено' });
    } catch {
      setNolog((p) => ({ ...p, [u.short_uuid]: !next }));
    }
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Text fw={600}>Пользователи панели{data ? ` (${data.count})` : ''}</Text>
        <Group gap="sm" wrap="wrap">
          <TextInput
            w={280}
            maw="48vw"
            placeholder="фильтр по имени / статусу / shortUuid"
            leftSection={<IconSearch size={15} />}
            value={q}
            onChange={(e) => {
              setQ(e.currentTarget.value);
              setPage(1);
            }}
          />
          <Select
            w={120}
            value={size}
            onChange={(v) => {
              setSize(v || '50');
              setPage(1);
            }}
            data={PAGE_SIZES.map((s) => ({ value: s, label: `${s} / стр.` }))}
            allowDeselect={false}
          />
          <Tooltip label="Обновить">
            <ActionIcon variant="default" size={36} onClick={reload} loading={loading} aria-label="Обновить">
              <IconRefresh size={17} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>

      {data?.mirror && (
        <Text size="sm" c="dimmed">
          Ссылки подписки показаны через зеркало <Text span style={MONO}>{data.mirror}</Text> — их и раздавайте.
        </Text>
      )}

      {error || data?.error ? (
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="API панели недоступен">
          {error || data?.error}. Проверьте URL панели и токен во вкладке «Подключение».
        </Alert>
      ) : loading && !data ? (
        <Center h={200}><Loader color="teal" /></Center>
      ) : (
        <Card withBorder radius="md" p={0}>
          <Table.ScrollContainer minWidth={820}>
            <Table highlightOnHover verticalSpacing="sm" fz="sm" stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Th col="username">Пользователь</Th>
                  <Th col="status">Статус</Th>
                  <Th col="expire_ts">Истекает</Th>
                  <Th col="src">Конфиг</Th>
                  <Table.Th>Ссылка подписки</Table.Th>
                  <Table.Th>Действия</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pageRows.length === 0 ? (
                  <Table.Tr>
                    <Table.Td colSpan={6}>
                      <Text c="dimmed" ta="center" py="xl">
                        {users.length ? 'Ничего не найдено' : 'Пользователей пока нет'}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                ) : (
                  pageRows.map((u) => {
                    const nl = isNolog(u);
                    return (
                      <Table.Tr key={u.short_uuid || u.username}>
                        <Table.Td>
                          <CopyButton value={u.username}>
                            {({ copy }) => (
                              <Text
                                fw={600}
                                style={{ cursor: u.username ? 'copy' : 'default' }}
                                onClick={() => {
                                  if (u.username) {
                                    copy();
                                    notifications.show({ color: 'teal', message: 'Имя скопировано' });
                                  }
                                }}
                              >
                                {u.username || '—'}
                              </Text>
                            )}
                          </CopyButton>
                        </Table.Td>
                        <Table.Td>
                          <StatusBadge status={u.status} grace={u.in_grace} />
                        </Table.Td>
                        <Table.Td c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                          {fmtExpire(u.expire_ts)}
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            variant="light"
                            color={u.src === 'mw' ? 'orange' : u.in_grace ? 'cyan' : 'teal'}
                            style={{ textTransform: 'none' }}
                          >
                            {u.src === 'mw' ? 'Прослойка' : u.in_grace ? 'Панель + Грейс' : 'Панель'}
                          </Badge>
                        </Table.Td>
                        <Table.Td style={{ maxWidth: 280 }}>
                          {u.sub_link ? (
                            <CopyButton value={u.sub_link}>
                              {({ copy }) => (
                                <Tooltip label="Скопировать ссылку" withArrow>
                                  <Text
                                    span
                                    lineClamp={1}
                                    style={{ ...MONO, cursor: 'copy', display: 'block' }}
                                    onClick={() => {
                                      copy();
                                      notifications.show({ color: 'teal', message: 'Ссылка скопирована' });
                                    }}
                                  >
                                    {u.sub_link}
                                  </Text>
                                </Tooltip>
                              )}
                            </CopyButton>
                          ) : (
                            <Text c="dimmed">—</Text>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap">
                            {u.uuid && (
                              <Button
                                size="xs"
                                variant="default"
                                leftSection={<IconDeviceMobile size={14} />}
                                rightSection={
                                  u.has_hwid_block ? (
                                    <Tooltip label="Есть активный блок HWID">
                                      <Box style={{ width: 16, height: 16, borderRadius: '50%', background: 'var(--mantine-color-red-6)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>!</Box>
                                    </Tooltip>
                                  ) : undefined
                                }
                                onClick={() => setDevUser({ uuid: u.uuid, name: u.username, limit: u.limit })}
                              >
                                HWID
                              </Button>
                            )}
                            {u.short_uuid && (
                              <Tooltip label={nl ? 'Скрыт из лога — вернуть' : 'В логе — скрыть'}>
                                <ActionIcon variant="default" color={nl ? 'yellow' : 'gray'} onClick={() => toggleNolog(u)} aria-label="nolog">
                                  {nl ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                                </ActionIcon>
                              </Tooltip>
                            )}
                            {u.short_uuid && (
                              <Button
                                size="xs"
                                variant={u.addsub ? 'light' : 'default'}
                                color={u.addsub ? 'teal' : 'gray'}
                                leftSection={<IconPlus size={14} />}
                                onClick={() => setAddsub({ short: u.short_uuid, name: u.username, url: u.addsub })}
                              >
                                {u.addsub ? 'Доп ✓' : 'Доп'}
                              </Button>
                            )}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    );
                  })
                )}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Card>
      )}

      {pages > 1 && (
        <Group justify="flex-end">
          <Pagination total={pages} value={page} onChange={setPage} color="teal" size="sm" />
        </Group>
      )}

      {devUser && <DevicesModal user={devUser} onClose={() => setDevUser(null)} />}
      {addsub && <AddsubModal target={addsub} onClose={() => setAddsub(null)} onSaved={reload} />}
    </Stack>
  );
}
