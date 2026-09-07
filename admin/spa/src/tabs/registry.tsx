import type { ComponentType } from 'react';
import {
  IconUsers,
  IconMessageCircle,
  IconListDetails,
  IconPlug,
  IconBrush,
  IconSettings,
  IconArrowForwardUp,
  IconWebhook,
  IconArrowsShuffle,
  IconClock,
  IconRoute,
  IconFingerprint,
  IconArrowsExchange,
  IconFilePlus,
  IconTopologyStar3,
  IconDownload,
  IconGitMerge,
  IconShieldLock,
  IconServer,
  IconRefresh,
  IconDatabase,
  type IconProps,
} from '@tabler/icons-react';
import { Sysinfo } from './Sysinfo';
import { ReqLog } from './ReqLog';
import { Users } from './Users';
import { Connection } from './Connection';
import { Branding } from './Branding';
import { Webhooks } from './Webhooks';
import { Whlog } from './Whlog';
import { Fwdlog } from './Fwdlog';

export interface TabDef {
  id: string;
  label: string;
  icon: ComponentType<IconProps>;
  /** Мигрированные табы рендерятся в SPA; остальные ведут в легаси /admin/?tab=. */
  component?: ComponentType;
}

export interface NavSection {
  label: string;
  items: TabDef[];
}

// Порядок и группировка 1:1 с легаси-навигацией ($sections в admin/index.php).
// По мере миграции у таба появляется component — и он открывается уже в SPA.
export const NAV: NavSection[] = [
  {
    label: 'Главное',
    items: [
      { id: 'users', label: 'Пользователи', icon: IconUsers, component: Users },
      { id: 'chat', label: 'Чат поддержки', icon: IconMessageCircle },
      { id: 'reqlog', label: 'Лог запросов', icon: IconListDetails, component: ReqLog },
    ],
  },
  {
    label: 'Настройки',
    items: [
      { id: 'connection', label: 'Подключение', icon: IconPlug, component: Connection },
      { id: 'branding', label: 'Брендинг', icon: IconBrush, component: Branding },
    ],
  },
  {
    label: 'Вебхуки',
    items: [
      { id: 'webhooks', label: 'Настройки', icon: IconSettings, component: Webhooks },
      { id: 'fwdlog', label: 'Лог пересылки', icon: IconArrowForwardUp, component: Fwdlog },
      { id: 'whlog', label: 'Лог вебхуков', icon: IconWebhook, component: Whlog },
    ],
  },
  {
    label: 'Грейс',
    items: [
      { id: 'subst', label: 'Грейс-сквад', icon: IconArrowsShuffle },
      { id: 'grace_users', label: 'Грейс-юзеры', icon: IconClock },
    ],
  },
  {
    label: 'Доступ / подмена',
    items: [
      { id: 'rules', label: 'Правила ответа', icon: IconRoute },
      { id: 'hwid', label: 'HWID', icon: IconFingerprint },
      { id: 'overrides', label: 'Оверрайды', icon: IconArrowsExchange },
      { id: 'squad_configs', label: 'Доп. конфиги', icon: IconFilePlus },
      { id: 'wg_pool', label: 'WG / AWG', icon: IconTopologyStar3 },
      { id: 'ext_import', label: 'Импорт из подписок', icon: IconDownload },
      { id: 'addsub', label: 'Слияние подписок', icon: IconGitMerge },
      { id: 'clod', label: 'Защищённый канал', icon: IconShieldLock },
    ],
  },
  {
    label: 'Обслуживание',
    items: [
      { id: 'sysinfo', label: 'О системе', icon: IconServer, component: Sysinfo },
      { id: 'update', label: 'Обновление', icon: IconRefresh },
      { id: 'migrate', label: 'База данных', icon: IconDatabase },
    ],
  },
];

const byId = new Map<string, TabDef>();
for (const s of NAV) for (const t of s.items) byId.set(t.id, t);

export function findTab(id: string): TabDef | undefined {
  return byId.get(id);
}

export const legacyUrl = (id: string) => `/admin/?tab=${encodeURIComponent(id)}`;
