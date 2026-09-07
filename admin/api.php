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

jout(['ok' => false, 'error' => 'unknown resource: ' . $r], 404);
