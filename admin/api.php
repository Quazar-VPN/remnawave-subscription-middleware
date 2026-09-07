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

// --- Настройки: «Подключение» -----------------------------------------------
if ($r === 'connection') {
    $psd = '';
    try { if (function_exists('panel_sub_public_domain')) $psd = (string) panel_sub_public_domain(); } catch (Throwable $e) {}
    jout([
        'ok'                 => true,
        'in_docker'          => submw_in_docker(),
        'target_domain'      => target_domain(),
        'mirror_domain'      => mirror_domain(),
        'remnawave_url'      => remnawave_url(),
        'remnawave_cookie'   => remnawave_cookie(),
        'remnawave_xapikey'  => remnawave_xapikey(),
        'api_key_set'        => remnawave_token() !== '',
        'webhook_secret_set' => webhook_secret() !== '',
        'proxy_timeout'      => proxy_timeout(),
        'trust_header_expire'=> trust_header_expire(),
        'tls_verify'         => api_tls_verify(),
        'sub_source'         => sub_source(),
        'subpage_external_url' => subpage_external_url(),
        'sub_link_apisub'    => sub_link_apisub(),
        'sub_prefix_enabled' => setting('sub_prefix_enabled', '0') === '1',
        'sub_prefix'         => (string) setting('sub_prefix', ''),
        'sub_link_prefix'    => setting('sub_link_prefix', '0') === '1',
        'mask_notfound'      => mask_notfound(),
        'ua_hwid_parse'      => ua_hwid_parse(),
        'ua_hwid_keys'       => array_values(ua_hwid_keys()),
        'ua_hwid_keys_all'   => array_values(ua_hwid_keys_all()),
        'panel_sub_domain'   => $psd,
    ]);
}

if ($r === 'save_connection') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    $b = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($b)) $b = [];
    $s = fn($k) => trim((string) ($b[$k] ?? ''));
    $bool = fn($k) => !empty($b[$k]) ? '1' : '0';

    set_setting('target_domain', $s('target_domain'));
    set_setting('mirror_domain', $s('mirror_domain'));
    set_setting('remnawave_url', rtrim($s('remnawave_url'), '/'));
    set_setting('remnawave_cookie', $s('remnawave_cookie'));
    set_setting('remnawave_xapikey', $s('remnawave_xapikey'));
    if ($s('remnawave_api_key') !== '') set_setting('remnawave_api_key', $s('remnawave_api_key'));
    if ($s('webhook_secret') !== '')    set_setting('webhook_secret', $s('webhook_secret'));
    set_setting('trust_header_expire', $bool('trust_header_expire'));
    set_setting('tls_verify', $bool('tls_verify'));
    set_setting('proxy_timeout', (string) max(5, (int) ($b['proxy_timeout'] ?? 30)));
    set_setting('sub_source', ($b['sub_source'] ?? 'mirror') === 'panel' ? 'panel' : 'mirror');
    set_setting('subpage_external_url', rtrim($s('subpage_external_url'), '/'));
    set_setting('mask_notfound', $bool('mask_notfound'));
    set_setting('sub_link_apisub', $bool('sub_link_apisub'));
    set_setting('sub_prefix_enabled', $bool('sub_prefix_enabled'));
    set_setting('sub_prefix', trim($s('sub_prefix'), "/ \t\r\n"));
    set_setting('sub_link_prefix', $bool('sub_link_prefix'));
    set_setting('ua_hwid_parse', $bool('ua_hwid_parse'));
    $ua_keys = [];
    foreach ((array) ($b['ua_hwid_keys'] ?? []) as $uk) {
        $uk = strtolower(trim((string) $uk));
        if (in_array($uk, ua_hwid_keys_all(), true) && !in_array($uk, $ua_keys, true)) $ua_keys[] = $uk;
    }
    set_setting('ua_hwid_keys', json_encode($ua_keys ?: ['x-hwid'], JSON_UNESCAPED_SLASHES));
    jout(['ok' => true, 'msg' => 'Настройки подключения сохранены']);
}

// --- Настройки: «Брендинг» + страница-заглушка ------------------------------
if ($r === 'branding') {
    $brand = function_exists('service_brand') ? service_brand() : ['name' => '', 'logo_file' => '', 'emoji' => ''];
    $bc = json_decode((string) setting('brand_cache', '{}'), true);
    if (!is_array($bc)) $bc = [];
    jout([
        'ok'               => true,
        'service_name'     => (string) setting('service_name', ''),
        'service_logo_url' => (string) setting('service_logo_url', ''),
        'brand_name'       => (string) ($brand['name'] ?? ''),
        'brand_logo_file'  => (string) ($brand['logo_file'] ?? ''),
        'brand_emoji'      => (string) ($brand['emoji'] ?? ''),
        'cache_name'       => (string) ($bc['name'] ?? ''),
        'cache_logo_url'   => (string) ($bc['logo_url'] ?? ''),
        'cache_logo_file'  => (string) ($bc['logo_file'] ?? ''),
        'cache_api_error'  => (string) ($bc['api_error'] ?? ''),
        'landing_preset'   => landing_preset(),
        'landing_fp'       => landing_fp(),
        'landing_fp_ack'   => setting('landing_fp_ack', '') === '1',
        'chat_enabled'     => chat_enabled(),
    ]);
}

if ($r === 'save_branding') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    $b = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($b)) $b = [];
    set_setting('service_name', trim((string) ($b['service_name'] ?? '')));
    set_setting('service_logo_url', trim((string) ($b['service_logo_url'] ?? '')));
    $be = '';
    brand_refresh($be);
    jout(['ok' => true, 'msg' => $be !== '' ? ('Брендинг сохранён. API панели: ' . $be) : 'Брендинг сохранён и обновлён']);
}

if ($r === 'save_landing') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    $b = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($b)) $b = [];
    $lp = (int) ($b['landing_preset'] ?? 1);
    set_setting('landing_preset', (string) (($lp >= 1 && $lp <= 4) ? $lp : 1));
    jout(['ok' => true, 'msg' => 'Дизайн страницы-заглушки сохранён']);
}

if ($r === 'landing_regen_fp') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    landing_fp_regenerate();
    set_setting('landing_fp_ack', '1');
    jout(['ok' => true, 'fp' => landing_fp()]);
}

if ($r === 'landing_ack_fp') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    set_setting('landing_fp_ack', '1');
    jout(['ok' => true]);
}

// --- Вебхуки: настройки + раздвоение ----------------------------------------
if ($r === 'webhooks') {
    $we = panel_webhook_enabled(); // true | false | null
    jout([
        'ok'                 => true,
        'panel_webhook'      => $we === null ? null : (bool) $we,
        'wh_url'             => (mirror_domain() !== '' ? ('https://' . mirror_domain() . '/webhook.php') : '/webhook.php'),
        'webhook_secret'     => webhook_secret(),
        'forward_enabled'    => forward_enabled(),
        'forward_timeout'    => forward_timeout(),
        'forward_targets'    => forward_targets(),
    ]);
}

if ($r === 'save_forward') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    $b = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($b)) $b = [];
    set_setting('forward_enabled', !empty($b['forward_enabled']) ? '1' : '0');
    set_setting('forward_timeout', (string) max(2, (int) ($b['forward_timeout'] ?? 8)));
    $clean = [];
    foreach ((array) ($b['forward_targets'] ?? []) as $t) {
        if (!is_array($t)) continue;
        $url = trim((string) ($t['url'] ?? ''));
        if ($url === '') continue;
        $clean[] = [
            'name'    => trim((string) ($t['name'] ?? '')),
            'url'     => $url,
            'secret'  => (string) ($t['secret'] ?? ''),
            'enabled' => !empty($t['enabled']),
        ];
    }
    set_setting('forward_targets', json_encode($clean, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    ensure_forward_log();
    jout(['ok' => true, 'msg' => 'Настройки раздвоения сохранены']);
}

if ($r === 'test_forward') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    $b = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($b)) $b = [];
    $targets = null;
    if (isset($b['targets']) && is_array($b['targets'])) {
        $targets = [];
        foreach ($b['targets'] as $t) {
            if (!is_array($t)) continue;
            if (array_key_exists('enabled', $t) && $t['enabled'] === false) continue;
            $url = trim((string) ($t['url'] ?? ''));
            if ($url === '' || !preg_match('~^https?://~i', $url)) continue;
            $targets[] = ['name' => trim((string) ($t['name'] ?? '')), 'url' => $url, 'secret' => (string) ($t['secret'] ?? ''), 'enabled' => true];
        }
    }
    $payload = json_encode(['event' => 'test.ping', 'data' => ['ts' => time(), 'source' => 'middleware']], JSON_UNESCAPED_UNICODE);
    $results = forward_webhook($payload, 'test.ping', true, $targets);
    jout(['ok' => true, 'results' => $results]);
}

// Лог вебхуков (scope=user — события юзеров, scope=other — прочие).
if ($r === 'whlog') {
    jout(whlog_payload(
        ($_GET['scope'] ?? 'user') === 'other' ? 'other' : 'user',
        [
            'event' => trim((string) ($_GET['event'] ?? '')),
            'sig'   => (string) ($_GET['sig'] ?? ''),
            'hours' => (int) ($_GET['hours'] ?? 0),
            'action'=> trim((string) ($_GET['action'] ?? '')),
            'flt'   => trim((string) ($_GET['flt'] ?? '')),
        ]
    ));
}

// Лог пересылки («тройник»).
if ($r === 'fwdlog') {
    $rows = [];
    if ($p = db()) {
        ensure_forward_log();
        try { foreach ($p->query('SELECT * FROM forward_log ORDER BY id DESC LIMIT 300') as $row) $rows[] = $row; }
        catch (Throwable $e) {}
    }
    jout(['ok' => true, 'rows' => $rows]);
}

if ($r === 'clear_fwdlog') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    if ($p = db()) { try { $p->exec('DELETE FROM forward_log'); } catch (Throwable $e) {} }
    jout(['ok' => true, 'msg' => 'Лог пересылки очищен']);
}

// --- Грейс-сквад: настройки -------------------------------------------------
if ($r === 'grace') {
    $ie = ''; $xe = '';
    $internal = []; $external = [];
    if (remnawave_url() !== '' && remnawave_token() !== '') {
        $internal = remnawave_internal_squads($ie);
        $external = remnawave_external_squads($xe);
    }
    jout([
        'ok'                   => true,
        'enabled'              => grace_squad_enabled(),
        'squad_uuid'           => grace_squad_uuid(),
        'days'                 => (string) setting('grace_days', ''),
        'days_default'         => expired_grace_days(),
        'traffic_gb'           => rtrim(rtrim(number_format(grace_traffic_bytes() / 1073741824, 2, '.', ''), '0'), '.'),
        'hwid_limit'           => grace_hwid_limit_raw(),
        'traffic_strategy'     => grace_traffic_strategy(),
        'reset_traffic_exit'   => grace_reset_traffic_on_exit(),
        'external_enabled'     => grace_external_enabled(),
        'external_squad_uuid'  => grace_external_squad_uuid(),
        'announce'             => str_replace('\n', "\n", grace_announce()),
        'internal_squads'      => $internal,
        'internal_err'         => $ie,
        'external_squads'      => $external,
        'external_err'         => $xe,
    ]);
}

if ($r === 'save_grace') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    $b = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($b)) $b = [];
    set_setting('grace_squad_enabled', !empty($b['enabled']) ? '1' : '0');
    set_setting('grace_squad_uuid', trim((string) ($b['squad_uuid'] ?? '')));
    $gb = (float) str_replace(',', '.', (string) ($b['traffic_gb'] ?? '0'));
    set_setting('grace_traffic_bytes', (string) (int) round(max(0, $gb) * 1073741824));
    $strat = (string) ($b['traffic_strategy'] ?? 'NO_RESET');
    set_setting('grace_traffic_strategy', in_array($strat, ['NO_RESET', 'DAY', 'WEEK', 'MONTH', 'MONTH_ROLLING'], true) ? $strat : 'NO_RESET');
    set_setting('grace_reset_traffic_exit', !empty($b['reset_traffic_exit']) ? '1' : '0');
    $gh = trim((string) ($b['hwid_limit'] ?? ''));
    set_setting('grace_hwid_limit', $gh === '' ? '' : (string) max(0, (int) $gh));
    $gd = (string) ($b['days'] ?? '');
    set_setting('grace_days', $gd === '' ? '' : (string) max(0, (int) $gd));
    set_setting('grace_external_enabled', !empty($b['external_enabled']) ? '1' : '0');
    set_setting('grace_external_squad_uuid', trim((string) ($b['external_squad_uuid'] ?? '')));
    set_setting('grace_announce', grace_announce_normalize((string) ($b['announce'] ?? '')));
    jout(['ok' => true, 'msg' => 'Настройки грейс-сквада сохранены']);
}

if ($r === 'grace_refresh_refs') {
    if ($method !== 'POST') jout(['ok' => false, 'error' => 'method'], 405);
    if (!api_csrf_ok())     jout(['ok' => false, 'error' => 'CSRF'], 400);
    $res = grace_refresh_refs();
    jout(['ok' => ($res['error'] ?? '') === '', 'result' => $res]);
}

if ($r === 'grace_users') {
    $rows = [];
    if ($p = db()) {
        ensure_grace_table();
        try {
            foreach ($p->query('SELECT *, ' . sql_epoch('created_at') . ' AS created_epoch FROM grace_users ORDER BY grace_until DESC LIMIT 500') as $row) {
                $rows[] = [
                    'username'   => (string) ($row['username'] ?? ''),
                    'short_uuid' => (string) ($row['short_uuid'] ?? ''),
                    'created_ts' => (int) ($row['created_epoch'] ?? 0),
                    'grace_until'=> (int) ($row['grace_until'] ?? 0),
                ];
            }
        } catch (Throwable $e) {}
    }
    jout(['ok' => true, 'rows' => $rows]);
}

jout(['ok' => false, 'error' => 'unknown resource: ' . $r], 404);

// Лог вебхуков: фильтры и выборка 1:1 с контроллером легаси (без CSV — экспорт
// на клиенте, и без panel-API добора имён; быстрый DB-добор имён сохранён).
function whlog_payload(string $scope, array $flt): array {
    $out = ['ok' => true, 'rows' => [], 'events' => [], 'actions' => [], 'total' => 0, 'matched' => 0];
    $p = db();
    if (!$p) return $out;
    $user_cond = "(event LIKE 'user.%' OR short_uuid IS NOT NULL OR username IS NOT NULL)";
    $wh_scope  = $scope === 'user' ? $user_cond : "NOT $user_cond";
    $conds = [$wh_scope];
    $args  = [];
    if ($flt['event'] !== '') { $conds[] = 'event = ?'; $args[] = $flt['event']; }
    if ($flt['sig'] === '1' || $flt['sig'] === '0') { $conds[] = 'sig_ok = ?'; $args[] = (int) $flt['sig']; }
    if (in_array($flt['hours'], [1, 24, 168], true)) { $conds[] = sql_epoch('ts') . ' >= ?'; $args[] = time() - $flt['hours'] * 3600; }
    if ($scope === 'user' && $flt['action'] !== '') { $conds[] = 'action = ?'; $args[] = $flt['action']; }
    if ($scope === 'user' && $flt['flt'] !== '') {
        $like = '%' . strtr($flt['flt'], ['!' => '!!', '%' => '!%', '_' => '!_']) . '%';
        $conds[] = "(short_uuid LIKE ? ESCAPE '!' OR username LIKE ? ESCAPE '!')";
        $args[] = $like; $args[] = $like;
    }
    $where = implode(' AND ', $conds);
    try {
        // Быстрый добор имён старым hwid-строкам из соседних записей того же shortUuid.
        $bf = "event LIKE 'user_hwid%' AND (username IS NULL OR username = '') AND short_uuid IS NOT NULL AND short_uuid <> ''";
        if ((int) $p->query("SELECT COUNT(*) FROM webhook_log WHERE $bf")->fetchColumn() > 0) {
            $nm = $p->prepare("SELECT username FROM webhook_log WHERE short_uuid = ? AND username IS NOT NULL AND username <> '' ORDER BY id DESC LIMIT 1");
            $up = $p->prepare("UPDATE webhook_log SET username = ? WHERE short_uuid = ? AND (username IS NULL OR username = '')");
            foreach ($p->query("SELECT DISTINCT short_uuid FROM webhook_log WHERE $bf LIMIT 200") as $row) {
                $bs = (string) $row['short_uuid'];
                $nm->execute([$bs]);
                $bn = $nm->fetchColumn();
                if (is_string($bn) && $bn !== '') $up->execute([$bn, $bs]);
            }
        }
        foreach ($p->query("SELECT event, COUNT(*) AS c FROM webhook_log WHERE $wh_scope GROUP BY event ORDER BY c DESC, event") as $row) {
            $out['events'][] = ['event' => (string) $row['event'], 'count' => (int) $row['c']];
        }
        $out['total'] = array_sum(array_column($out['events'], 'count'));
        if ($scope === 'user') {
            foreach ($p->query("SELECT DISTINCT action FROM webhook_log WHERE $wh_scope AND action IS NOT NULL ORDER BY action") as $row) {
                $out['actions'][] = (string) $row['action'];
            }
        }
        $st = $p->prepare("SELECT COUNT(*) FROM webhook_log WHERE $where");
        $st->execute($args);
        $out['matched'] = (int) $st->fetchColumn();
        $st = $p->prepare("SELECT *, " . sql_epoch('ts') . " AS ts_epoch FROM webhook_log WHERE $where ORDER BY id DESC LIMIT 3000");
        $st->execute($args);
        $out['rows'] = $st->fetchAll(PDO::FETCH_ASSOC);
    } catch (Throwable $e) {
        error_log('submw whlog api: ' . $e->getMessage());
    }
    return $out;
}

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
