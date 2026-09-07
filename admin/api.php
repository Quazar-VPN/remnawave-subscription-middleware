<?php

// =============================================================================
// Форк Quazar: JSON-API новой (React+Mantine) админки. Живёт рядом с легаси
// admin/index.php и переиспользует ту же сессию (submw_admin), тот же
// $_SESSION['auth'] и CSRF — логин общий в обе стороны. Вся бизнес-логика
// остаётся в lib/*.php; здесь только тонкий диспетчер read/action → JSON.
//
// Контракт:
//   GET  api.php?r=bootstrap          → состояние сессии + метаданные приложения
//   POST api.php?r=login  {user,pass} → аутентификация (X-CSRF в заголовке)
//   POST api.php?r=logout             → выход
//   GET  api.php?r=<resource>         → данные вкладки (требует авторизации)
// =============================================================================

ini_set('display_errors', 0);
error_reporting(E_ALL);

require __DIR__ . '/../lib.php';

header('X-Robots-Tag: noindex, nofollow');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Content-Type: application/json; charset=utf-8');

function jout($data, int $code = 200): void {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit();
}

function submw_ver(): string {
    return function_exists('submw_image_version') ? submw_image_version() : trim((string) getenv('SUBMW_VERSION'));
}

$r      = (string) ($_GET['r'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// До установки отвечаем только на bootstrap — SPA покажет ссылку на мастер.
if (!is_installed()) {
    if ($r === 'bootstrap') {
        jout([
            'installed' => false,
            'authed'    => false,
            'csrf'      => '',
            'version'   => submw_ver(),
            'php'       => PHP_VERSION,
            'mode'      => 'panel',
            'panel_url' => '',
            'legacy_url'=> '/admin/',
        ]);
    }
    jout(['ok' => false, 'error' => 'not installed'], 400);
}

session_name('submw_admin');
session_start();

$C = is_file(config_path()) ? (require config_path()) : [];

function api_csrf(): string {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
    return $_SESSION['csrf'];
}
function api_authed(): bool { return !empty($_SESSION['auth']); }
function api_csrf_ok(): bool {
    $h = (string) ($_SERVER['HTTP_X_CSRF'] ?? '');
    return $h !== '' && isset($_SESSION['csrf']) && hash_equals((string) $_SESSION['csrf'], $h);
}

// --- Публичные (без авторизации) маршруты -----------------------------------

if ($r === 'bootstrap') {
    jout([
        'installed' => true,
        'authed'    => api_authed(),
        'csrf'      => api_csrf(),
        'version'   => submw_ver(),
        'php'       => PHP_VERSION,
        'mode'      => (setting('sub_source', 'panel') === 'panel') ? 'panel' : 'mirror',
        'panel_url' => remnawave_url(),
        'legacy_url'=> '/admin/',
    ]);
}

if ($r === 'login') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);

    $body = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($body)) $body = [];
    $u = (string) ($body['user'] ?? '');
    $p = (string) ($body['pass'] ?? '');

    $lip = login_remote_ip();
    if (login_is_locked($lip)) {
        usleep(500000);
        jout(['ok' => false, 'error' => 'Слишком много попыток входа. Подождите 15 минут.', 'locked' => true]);
    }
    if (hash_equals((string) ($C['admin_user'] ?? ''), $u) && password_verify($p, (string) ($C['admin_pass_hash'] ?? ''))) {
        login_clear($lip);
        session_regenerate_id(true);
        $_SESSION['auth'] = true;
        jout(['ok' => true, 'csrf' => api_csrf()]);
    }
    login_record_fail($lip);
    usleep(500000);
    jout(['ok' => false, 'error' => 'Неверный логин или пароль']);
}

if ($r === 'logout') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    $_SESSION = [];
    session_destroy();
    jout(['ok' => true]);
}

// --- Дальше только для авторизованных ----------------------------------------

if (!api_authed()) jout(['ok' => false, 'error' => 'unauthorized'], 401);

// «О системе» — read-only снимок метрик, БД и статов панели. Ровно те же
// функции lib/metrics.php, что и в легаси-вкладке tab_sysinfo.php.
if ($r === 'sysinfo') {
    ensure_metrics_tables();

    $panel = null;
    if (remnawave_url() !== '' && remnawave_token() !== '') {
        $perr = '';
        $age  = !empty($_GET['force']) ? 0 : 45;
        $stats = remnawave_system_stats($age, $perr);
        $meta  = function_exists('panel_meta_cached') ? panel_meta_cached() : null;
        $panel = [
            'stats'   => $stats ?: null,
            'error'   => $perr ?: null,
            'version' => is_array($meta) ? trim((string) ($meta['version'] ?? '')) : '',
        ];
    }

    jout([
        'ok'     => true,
        'system' => metrics_system_info(),
        'db'     => metrics_db_info(),
        'load'   => metrics_load_summary(),
        'series' => metrics_minute_series(60),
        'peaks'  => metrics_recent_peaks(200),
        'panel'  => $panel,
        'version'=> submw_ver(),
    ]);
}

// «Лог запросов». Строки отдаём УЖЕ обогащёнными — теми же функциями
// lib/logging.php + lib/clientver.php, что и легаси-рендер, чтобы React не
// переизобретал разбор UA / версий / meta. Фильтры читаются из $_GET
// (rl_dec|rl_fmt|rl_hours|rl_q) через reqlog_filters() внутри reqlog_prepare().
if ($r === 'reqlog') {
    require_once __DIR__ . '/inc/_reqlog_rows.php';
    [$f, $rows, $ctx, $total_users] = reqlog_prepare();
    $nolog = array_values(nolog_shortuuids());
    jout([
        'ok'          => true,
        'filters'     => $f,
        'overview'    => reqlog_overview(),
        'today'       => reqlog_today_stats(),
        'total_users' => (int) $total_users,
        'nolog'       => $nolog,
        'rows'        => reqlog_serialize_rows($rows, $ctx),
    ]);
}

if ($r === 'reqlog_nolog') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    $body = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($body)) $body = [];
    $su = trim((string) ($body['short'] ?? ''));
    if ($su === '') jout(['ok' => false, 'error' => 'empty short']);
    $on = !empty($body['on']);
    nolog_set($su, $on);
    jout(['ok' => true, 'nolog' => $on]);
}

// «Пользователи» — список из панели, уже обогащённый (статус/грейс/источник/
// ссылка через зеркало/nolog/доп-подписка), теми же helper'ами, что и легаси-таб.
if ($r === 'users') {
    jout(users_payload());
}

// Устройства пользователя (HWID) — модалка. uuid = uuid|id (rw_ref_coerce внутри).
if ($r === 'user_devices') {
    $uuid = (string) ($_GET['uuid'] ?? '');
    $err = '';
    $devices = $uuid !== '' ? remnawave_user_hwids($uuid, $err) : [];
    $blocked = [];
    if ($p = db()) {
        foreach ($p->query("SELECT match_value FROM overrides WHERE match_type='hwid' AND reason='blocked'") as $o) {
            $blocked[] = mb_strtolower((string) $o['match_value']);
        }
    }
    jout(['ok' => $err === '', 'error' => $err, 'devices' => $devices, 'blocked_hwids' => $blocked]);
}

if ($r === 'user_hwid_delete') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    $b = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($b)) $b = [];
    [$ok, , , $e] = remnawave_delete_hwid((string) ($b['uuid'] ?? ''), (string) ($b['hwid'] ?? ''));
    jout(['ok' => $ok, 'error' => $e]);
}

if ($r === 'user_hwid_block') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    $b = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($b)) $b = [];
    $hwid  = trim((string) ($b['hwid'] ?? ''));
    $uname = trim((string) ($b['username'] ?? ''));
    if ($hwid === '') jout(['ok' => false, 'error' => 'empty hwid']);
    if (!empty($b['block'])) {
        upsert_override('hwid', $hwid, 'blocked', 'manual', $uname !== '' ? $uname : null, 'HWID-бан из «Устройств»');
    } else {
        delete_override('hwid', $hwid);
    }
    jout(['ok' => true]);
}

if ($r === 'addsub_map') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    $b = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($b)) $b = [];
    $su  = trim((string) ($b['short'] ?? ''));
    $url = trim((string) ($b['url'] ?? ''));
    if ($su === '' || $url === '') jout(['ok' => false, 'error' => 'empty']);
    if (!preg_match('~^https?://~i', $url)) jout(['ok' => false, 'error' => 'URL должен начинаться с http:// или https://']);
    jout(['ok' => (bool) addsub_map_set($su, $url)]);
}

if ($r === 'addsub_map_del') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    $b = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($b)) $b = [];
    $su = trim((string) ($b['short'] ?? ''));
    if ($su === '') jout(['ok' => false, 'error' => 'empty']);
    jout(['ok' => (bool) addsub_map_del($su)]);
}

jout(['ok' => false, 'error' => 'unknown resource: ' . $r], 404);

// Сборка списка пользователей с теми же вычислениями, что делает контроллер
// легаси-таба перед tab_users.php (статус/грейс/источник/ссылка/nolog/доп).
function users_payload(): array {
    $err = '';
    $users  = remnawave_all_users($err);
    $nolog  = nolog_shortuuids();
    $addsub = [];
    foreach (addsub_map_all() as $row) $addsub[(string) $row['main_short']] = (string) $row['add_url'];

    $ov_index = [];
    $blocked_users = [];
    $blocked_hwids = [];
    if ($p = db()) {
        foreach ($p->query('SELECT * FROM overrides ORDER BY updated_at DESC LIMIT 500') as $o) {
            $mt = (string) ($o['match_type'] ?? '');
            if ($mt === 'shortuuid') $ov_index[(string) $o['match_value']] = $o;
            if ($mt === 'hwid' && ($o['reason'] ?? '') === 'blocked') {
                $blocked_hwids[] = mb_strtolower((string) $o['match_value']);
                $bn = mb_strtolower(trim((string) ($o['username'] ?? '')));
                if ($bn !== '') $blocked_users[$bn] = true;
            }
        }
    }

    $mirror   = mirror_domain();
    $pfx      = sub_link_prefix() ? sub_prefix_seg() : (sub_link_apisub() ? 'api/sub/' : '');
    $grace_sq = grace_squad_uuid();

    $out = [];
    foreach ($users as $u) {
        $un = (string) ($u['username'] ?? '');
        $st = (string) ($u['status'] ?? '');
        $su = (string) ($u['shortUuid'] ?? '');
        $uref = rw_user_ref($u);
        $uuid = rw_ref_ok($uref) ? (string) $uref['val'] : '';
        $lim  = (isset($u['hwidDeviceLimit']) && $u['hwidDeviceLimit'] !== null && $u['hwidDeviceLimit'] !== '') ? (int) $u['hwidDeviceLimit'] : null;
        $exp  = !empty($u['expireAt']) ? strtotime((string) $u['expireAt']) : false;
        $ovr  = (string) ($ov_index[$su]['reason'] ?? '');
        $in_grace = ($grace_sq !== '' && $st === 'ACTIVE' && in_array($grace_sq, grace_squads_from_user($u), true));
        $out[] = [
            'username'       => $un,
            'status'         => $st,
            'short_uuid'     => $su,
            'uuid'           => $uuid,
            'limit'          => $lim,
            'expire_ts'      => $exp !== false ? (int) $exp : null,
            'sub_link'       => ($mirror !== '' && $su !== '') ? ('https://' . $mirror . '/' . $pfx . $su) : '',
            'src'            => $ovr === 'blocked' ? 'mw' : 'panel',
            'in_grace'       => $in_grace,
            'has_hwid_block' => ($un !== '' && isset($blocked_users[mb_strtolower($un)])),
            'nolog'          => ($su !== '' && isset($nolog[$su])),
            'addsub'         => (string) ($addsub[$su] ?? ''),
        ];
    }
    return ['ok' => true, 'error' => $err, 'mirror' => $mirror, 'count' => count($out), 'blocked_hwids' => $blocked_hwids, 'users' => $out];
}

// Сериализация строк лога в JSON. Повторяет входные данные reqlog_render_rows,
// но отдаёт структуру, а не HTML — разметку строит React.
function reqlog_serialize_rows(array $rows, array $ctx): array {
    $names = $ctx['names'] ?? [];
    $users = $ctx['users'] ?? [];
    $idx   = $ctx['idx'] ?? [];
    $hist  = $ctx['hist'] ?? [];
    $ov    = $ctx['ov'] ?? [];
    $out = [];
    foreach ($rows as $r) {
        $su   = (string) ($r['short_uuid'] ?? '');
        $dec  = (string) ($r['decision'] ?? 'normal');
        $meta = reqlog_meta($r);
        $as   = is_array($meta['as'] ?? null) ? $meta['as'] : [];
        $cl   = reqlog_client((string) ($r['user_agent'] ?? ''));
        $cos  = (string) ($cl['os'] ?? '');
        if ($cos === '') $cos = reqlog_os_norm((string) ($meta['dv']['o'] ?? ''));
        $cv   = clientver_status($cl['key'] ?? '', $cl['ver'] ?? '', $cos);
        $dvl  = reqlog_device_label($meta['dv'] ?? null);
        if ($dvl !== '') $cl['dev'] = $dvl;
        $name = ($su !== '' && isset($names[$su])) ? (string) $names[$su] : '';
        $u    = $users[$su] ?? [];
        $hwid = (string) ($r['hwid'] ?? '');
        $ovl  = ($hwid !== '' && isset($ov[mb_strtolower($hwid)])) ? (string) $ov[mb_strtolower($hwid)] : '';
        $ui   = $idx[$su] ?? [];

        $out[] = [
            'id'         => (int) ($r['id'] ?? 0),
            'ts'         => (string) ($r['ts'] ?? ''),
            'ts_epoch'   => (int) ($r['ts_epoch'] ?? 0),
            'dup'        => (int) ($r['dup'] ?? 1),
            'decision'   => $dec,
            'why'        => rl_dec_why($dec, $meta),
            'fmt'        => (string) ($r['fmt'] ?? ''),
            'fmt_label'  => reqlog_fmt_label((string) ($r['fmt'] ?? '')),
            'as'         => [
                's'  => (string) ($as['s'] ?? ''),
                'n'  => (int) ($as['n'] ?? 0),
                'b'  => (int) ($as['b'] ?? 0),
                'ms' => (int) ($as['ms'] ?? 0),
                'm'  => (string) ($as['m'] ?? ''),
                'su' => (string) ($as['su'] ?? ''),
                'h'  => (string) ($as['h'] ?? ''),
                'c'  => isset($as['c']) ? (int) $as['c'] : null,
            ],
            'short_uuid' => $su,
            'name'       => $name,
            'status'     => (string) ($u['status'] ?? ''),
            'dev_limit'  => ($u['lim'] ?? '') === '' ? null : (int) $u['lim'],
            'hwid'       => $hwid,
            'ov_label'   => $ovl,
            'client'     => [
                'app' => (string) ($cl['app'] ?? ''),
                'dev' => (string) ($cl['dev'] ?? ''),
                'ver' => (string) ($cl['ver'] ?? ''),
                'os'  => $cos,
            ],
            'cv'         => [
                's'      => (string) ($cv['s'] ?? 'none'),
                'cur'    => (string) ($cv['cur'] ?? ''),
                'latest' => (string) ($cv['latest'] ?? ''),
            ],
            'day'        => (int) ($ui['day'] ?? 0),
            'dev_count'  => (int) ($ui['dev'] ?? 0),
            'first_ts'   => (int) ($ui['first'] ?? 0),
            'history'    => array_values($hist[$su] ?? []),
            'ip'         => (string) ($r['ip'] ?? ''),
            'path'       => (string) ($r['path'] ?? ''),
            'ctype'      => (string) ($r['ctype'] ?? ''),
            'bytes'      => (int) ($r['bytes'] ?? 0),
            'expire_ts'  => (int) ($r['expire_ts'] ?? 0),
            'wg'         => (int) ($meta['wg'] ?? 0),
            'grace'      => !empty($meta['grace']),
        ];
    }
    return $out;
}
