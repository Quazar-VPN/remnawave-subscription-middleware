import { lazy, type ComponentType } from 'react';
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
// Ленивая загрузка: каждый таб — отдельный чанк, тянется только при открытии.
const Sysinfo = lazy(() => import('./Sysinfo').then((m) => ({ default: m.Sysinfo })));
const ReqLog = lazy(() => import('./ReqLog').then((m) => ({ default: m.ReqLog })));
const Users = lazy(() => import('./Users').then((m) => ({ default: m.Users })));
const Connection = lazy(() => import('./Connection').then((m) => ({ default: m.Connection })));
const Branding = lazy(() => import('./Branding').then((m) => ({ default: m.Branding })));
const Webhooks = lazy(() => import('./Webhooks').then((m) => ({ default: m.Webhooks })));
const Whlog = lazy(() => import('./Whlog').then((m) => ({ default: m.Whlog })));
const Fwdlog = lazy(() => import('./Fwdlog').then((m) => ({ default: m.Fwdlog })));
const Subst = lazy(() => import('./Subst').then((m) => ({ default: m.Subst })));
const GraceUsers = lazy(() => import('./GraceUsers').then((m) => ({ default: m.GraceUsers })));
const Rules = lazy(() => import('./Rules').then((m) => ({ default: m.Rules })));
const Hwid = lazy(() => import('./Hwid').then((m) => ({ default: m.Hwid })));
const Overrides = lazy(() => import('./Overrides').then((m) => ({ default: m.Overrides })));
const Addsub = lazy(() => import('./Addsub').then((m) => ({ default: m.Addsub })));
const ExtImport = lazy(() => import('./ExtImport').then((m) => ({ default: m.ExtImport })));
const Clod = lazy(() => import('./Clod').then((m) => ({ default: m.Clod })));
const Chat = lazy(() => import('./Chat').then((m) => ({ default: m.Chat })));
const Update = lazy(() => import('./Update').then((m) => ({ default: m.Update })));
const Migrate = lazy(() => import('./Migrate').then((m) => ({ default: m.Migrate })));
const SquadConfigs = lazy(() => import('./SquadConfigs').then((m) => ({ default: m.SquadConfigs })));
const WgPool = lazy(() => import('./WgPool').then((m) => ({ default: m.WgPool })));

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
      { id: 'chat', label: 'Чат поддержки', icon: IconMessageCircle, component: Chat },
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
      { id: 'subst', label: 'Грейс-сквад', icon: IconArrowsShuffle, component: Subst },
      { id: 'grace_users', label: 'Грейс-юзеры', icon: IconClock, component: GraceUsers },
    ],
  },
  {
    label: 'Доступ / подмена',
    items: [
      { id: 'rules', label: 'Правила ответа', icon: IconRoute, component: Rules },
      { id: 'hwid', label: 'HWID', icon: IconFingerprint, component: Hwid },
      { id: 'overrides', label: 'Оверрайды', icon: IconArrowsExchange, component: Overrides },
      { id: 'squad_configs', label: 'Доп. конфиги', icon: IconFilePlus, component: SquadConfigs },
      { id: 'wg_pool', label: 'WG / AWG', icon: IconTopologyStar3, component: WgPool },
      { id: 'ext_import', label: 'Импорт из подписок', icon: IconDownload, component: ExtImport },
      { id: 'addsub', label: 'Слияние подписок', icon: IconGitMerge, component: Addsub },
      { id: 'clod', label: 'Защищённый канал', icon: IconShieldLock, component: Clod },
    ],
  },
  {
    label: 'Обслуживание',
    items: [
      { id: 'sysinfo', label: 'О системе', icon: IconServer, component: Sysinfo },
      { id: 'update', label: 'Обновление', icon: IconRefresh, component: Update },
      { id: 'migrate', label: 'База данных', icon: IconDatabase, component: Migrate },
    ],
  },
];

const byId = new Map<string, TabDef>();
for (const s of NAV) for (const t of s.items) byId.set(t.id, t);

export function findTab(id: string): TabDef | undefined {
  return byId.get(id);
}

export const legacyUrl = (id: string) => `/admin/?tab=${encodeURIComponent(id)}`;
