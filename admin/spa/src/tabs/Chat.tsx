import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Center,
  ColorInput,
  Group,
  Loader,
  NumberInput,
  PasswordInput,
  ScrollArea,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertTriangle, IconDeviceFloppy, IconSend, IconTrash } from '@tabler/icons-react';
import { apiGet, apiPost } from '../api';
import { useAsync } from '../hooks';

interface Cfg {
  enabled: boolean; agent_name: string; agent_photo: string; greeting: string;
  widget_preset: number; widget_position: string; widget_color: string; widget_text: string; poll_interval: number;
  tg_enabled: boolean; tg_token_set: boolean; tg_chat_id: string; tg_api_base: string; tg_webhook_url: string;
  webhook_enabled: boolean; webhook_url: string; webhook_secret_set: boolean;
  inbound_url: string; inbound_secret: string;
}
interface Session { id: number; name?: string; ip?: string; status?: string; unread_agent?: number; last_body?: string }
interface Message { id: number; sender: string; source?: string; body: string; ts: number }

function fmtTs(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// --- Живая консоль -----------------------------------------------------------
function Console({ poll }: { poll: number }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const lastId = useRef(0);

  const loadSessions = useCallback(async () => {
    try {
      const r = await apiGet<{ sessions: Session[] }>('chat_sessions');
      setSessions(r.sessions || []);
    } catch { /* ignore */ }
  }, []);

  const loadMessages = useCallback(async (sid: number, reset: boolean) => {
    try {
      const after = reset ? 0 : lastId.current;
      const r = await apiGet<{ messages: Message[] }>('chat_msgs', { sid: String(sid), after: String(after) });
      const msgs = r.messages || [];
      if (msgs.length) lastId.current = msgs[msgs.length - 1].id;
      setMessages((p) => (reset ? msgs : [...p, ...msgs]));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadSessions(); const t = setInterval(loadSessions, Math.max(3, poll) * 1000); return () => clearInterval(t); }, [loadSessions, poll]);
  useEffect(() => {
    if (sel === null) return;
    lastId.current = 0;
    setMessages([]);
    loadMessages(sel, true);
    const t = setInterval(() => loadMessages(sel, false), Math.max(2, poll) * 1000);
    return () => clearInterval(t);
  }, [sel, poll, loadMessages]);

  async function send() {
    if (!reply.trim() || sel === null) return;
    setSending(true);
    try {
      const r = await apiPost<{ ok: boolean }>('chat_reply', { sid: sel, body: reply.trim() });
      if (r.ok) { setReply(''); loadMessages(sel, false); }
    } finally { setSending(false); }
  }
  async function del(sid: number) {
    if (!confirm('Удалить сессию?')) return;
    await apiPost('chat_delete', { sid });
    if (sel === sid) { setSel(null); setMessages([]); }
    loadSessions();
  }

  return (
    <Card withBorder radius="md" p={0} style={{ overflow: 'hidden' }}>
      <Group align="stretch" gap={0} wrap="nowrap" style={{ minHeight: 420 }}>
        <Box style={{ width: 260, flex: '0 0 auto', borderRight: '1px solid var(--mantine-color-default-border)' }}>
          <Text fw={600} p="sm" size="sm">Диалоги ({sessions.length})</Text>
          <ScrollArea h={380}>
            {sessions.length === 0 ? (
              <Text c="dimmed" size="sm" p="sm">Пока нет диалогов.</Text>
            ) : (
              sessions.map((s) => (
                <Box
                  key={s.id}
                  onClick={() => setSel(s.id)}
                  style={{ cursor: 'pointer', padding: '10px 12px', borderBottom: '1px solid var(--mantine-color-default-border)', background: sel === s.id ? 'var(--mantine-color-teal-light)' : undefined }}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" fw={600} lineClamp={1}>{s.name || s.ip || 'гость'} <Text span c="dimmed" size="xs">#{s.id}</Text></Text>
                    {!!s.unread_agent && <Badge size="xs" color="red" circle>{s.unread_agent}</Badge>}
                  </Group>
                  {s.last_body && <Text size="xs" c="dimmed" lineClamp={1}>{s.last_body}</Text>}
                </Box>
              ))
            )}
          </ScrollArea>
        </Box>
        <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
          {sel === null ? (
            <Center style={{ flex: 1 }}><Text c="dimmed" size="sm">Выберите диалог</Text></Center>
          ) : (
            <>
              <Group justify="flex-end" p="xs">
                <ActionIcon variant="subtle" color="red" onClick={() => del(sel)} aria-label="Удалить"><IconTrash size={16} /></ActionIcon>
              </Group>
              <ScrollArea style={{ flex: 1 }} px="md">
                <Stack gap="xs" py="sm">
                  {messages.map((m) => {
                    const agent = m.sender === 'agent';
                    const sys = m.sender === 'system';
                    return (
                      <Box key={m.id} style={{ alignSelf: sys ? 'center' : agent ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
                        <Card padding="xs" radius="md" withBorder bg={sys ? 'transparent' : agent ? 'var(--mantine-color-teal-light)' : 'var(--mantine-color-default)'}>
                          <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.body}</Text>
                          <Text size="xs" c="dimmed" ta="right" mt={2}>{fmtTs(m.ts)}</Text>
                        </Card>
                      </Box>
                    );
                  })}
                </Stack>
              </ScrollArea>
              <Group p="sm" gap="xs" wrap="nowrap" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
                <Textarea autosize minRows={1} maxRows={4} style={{ flex: 1 }} placeholder="Ответ…" value={reply}
                  onChange={(e) => setReply(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                <ActionIcon size={38} onClick={send} loading={sending} aria-label="Отправить"><IconSend size={18} /></ActionIcon>
              </Group>
            </>
          )}
        </Stack>
      </Group>
    </Card>
  );
}

// --- Основной таб ------------------------------------------------------------
export function Chat() {
  const { data, error } = useAsync<Cfg & { ok: true }>(() => apiGet('chat'), []);
  const [f, setF] = useState<Cfg | null>(null);
  const [tgToken, setTgToken] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data) setF(data); }, [data]);
  function set<K extends keyof Cfg>(k: K, v: Cfg[K]) { setF((p) => (p ? { ...p, [k]: v } : p)); }

  async function save() {
    if (!f) return;
    setBusy(true);
    try {
      const r = await apiPost<{ ok: boolean; msg?: string }>('save_chat_cfg', {
        enabled: f.enabled, agent_name: f.agent_name, agent_photo: f.agent_photo, greeting: f.greeting,
        widget_preset: f.widget_preset, widget_position: f.widget_position, widget_color: f.widget_color,
        widget_text: f.widget_text, poll_interval: f.poll_interval,
        tg_enabled: f.tg_enabled, tg_chat_id: f.tg_chat_id, tg_api_base: f.tg_api_base, tg_bot_token: tgToken,
        webhook_enabled: f.webhook_enabled, webhook_url: f.webhook_url,
      });
      notifications.show({ color: r.ok ? 'teal' : 'red', message: r.msg || (r.ok ? 'Сохранено' : 'Ошибка') });
    } finally { setBusy(false); }
  }

  if (error) return <Alert color="red" icon={<IconAlertTriangle size={16} />}>{error}</Alert>;
  if (!data || !f) return <Center h={200}><Loader color="teal" /></Center>;

  return (
    <Stack gap="lg" maw={960}>
      <Console poll={f.poll_interval} />

      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" mb="md">
          <Title order={5}>Настройки виджета чата</Title>
          <Switch checked={f.enabled} onChange={(e) => set('enabled', e.currentTarget.checked)} label="Включён" />
        </Group>
        <SegmentedControl mb="md" value={String(f.widget_preset)} onChange={(v) => set('widget_preset', Number(v))}
          data={[{ value: '1', label: 'Пресет 1' }, { value: '2', label: 'Пресет 2' }, { value: '3', label: 'Пресет 3' }]} />
        <Group grow align="flex-start">
          <TextInput label="Имя оператора" value={f.agent_name} onChange={(e) => set('agent_name', e.currentTarget.value)} />
          <TextInput label="Фото оператора (URL)" value={f.agent_photo} onChange={(e) => set('agent_photo', e.currentTarget.value)} />
        </Group>
        <Textarea mt="sm" label="Приветствие" autosize minRows={2} value={f.greeting} onChange={(e) => set('greeting', e.currentTarget.value)} />
        <Group grow mt="sm" align="flex-start">
          <SegmentedControl value={f.widget_position} onChange={(v) => set('widget_position', v)} data={[{ value: 'right', label: 'Справа' }, { value: 'left', label: 'Слева' }]} />
          <ColorInput label="Цвет" value={f.widget_color} onChange={(v) => set('widget_color', v)} />
          <NumberInput label="Опрос, сек" min={2} max={30} value={f.poll_interval} onChange={(v) => set('poll_interval', Number(v) || 4)} />
        </Group>
        <TextInput mt="sm" label="Текст на кнопке виджета" value={f.widget_text} onChange={(e) => set('widget_text', e.currentTarget.value)} />
      </Card>

      <Card withBorder radius="md" padding="lg">
        <Group justify="space-between" mb="md">
          <Title order={5}>Telegram-бот оператора</Title>
          <Switch checked={f.tg_enabled} onChange={(e) => set('tg_enabled', e.currentTarget.checked)} label="Включён" />
        </Group>
        <PasswordInput label="Токен бота" placeholder={f.tg_token_set ? '•••••• задан (пусто — не менять)' : 'не задан'} value={tgToken} onChange={(e) => setTgToken(e.currentTarget.value)} />
        <Group grow align="flex-start" mt="sm">
          <TextInput label="Chat ID оператора" value={f.tg_chat_id} onChange={(e) => set('tg_chat_id', e.currentTarget.value)} />
          <TextInput label="API base (опц.)" value={f.tg_api_base} onChange={(e) => set('tg_api_base', e.currentTarget.value)} />
        </Group>
        <Text size="xs" c="dimmed" mt="xs">Вебхук бота: <Text span ff="monospace">{f.tg_webhook_url}</Text></Text>
      </Card>

      <Group>
        <Button leftSection={<IconDeviceFloppy size={16} />} onClick={save} loading={busy}>Сохранить настройки чата</Button>
      </Group>
    </Stack>
  );
}
