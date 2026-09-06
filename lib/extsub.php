<?php
// Форк Quazar (R2): импорт хостов из ЧУЖИХ подписок. Сохраняемые источники,
// извлечение хостов (xray-json массив / base64), выборочный импорт в squad_configs
// с привязкой к источнику, ре-синк и дрифт. Запросы к источнику — только под UA
// реального клиента (Happ/v2rayN/INCY), чтобы выглядеть не палевно.

function extsub_ensure() {
    static $done = false;
    if ($done) return;
    $done = true;
    if (!($p = db())) return;
    try {
        if (db_driver() === 'mysql') {
            $p->exec("CREATE TABLE IF NOT EXISTS ext_subs (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                name VARCHAR(191) NOT NULL,
                url TEXT NOT NULL,
                ua VARCHAR(32) NOT NULL DEFAULT 'happ',
                enabled TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_fetch_ts INT UNSIGNED NOT NULL DEFAULT 0,
                last_status VARCHAR(16) NULL,
                last_error VARCHAR(255) NULL,
                host_count INT UNSIGNED NOT NULL DEFAULT 0,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        } else {
            $p->exec("CREATE TABLE IF NOT EXISTS ext_subs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                ua TEXT NOT NULL DEFAULT 'happ',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_fetch_ts INTEGER NOT NULL DEFAULT 0,
                last_status TEXT NULL,
                last_error TEXT NULL,
                host_count INTEGER NOT NULL DEFAULT 0
            )");
        }
    } catch (Throwable $e) { error_log('submw extsub ensure: ' . $e->getMessage()); }
}

// UA реальных клиентов. Ключ хранится в БД, строка уходит в запрос к источнику.
function extsub_ua_options() {
    return [
        'happ'    => 'Happ/4.12.0',
        'v2rayng' => 'v2rayNG/1.10.2',
        'incy'    => 'INCY/3.5.8',
    ];
}
function extsub_ua_string($key) {
    $o = extsub_ua_options();
    $k = strtolower(trim((string) $key));
    return $o[$k] ?? $o['happ'];
}

function extsub_all() {
    extsub_ensure();
    if (!($p = db())) return [];
    try { return $p->query('SELECT * FROM ext_subs ORDER BY id')->fetchAll(); }
    catch (Throwable $e) { return []; }
}
function extsub_get($id) {
    extsub_ensure();
    $id = (int) $id;
    if (!($p = db()) || $id <= 0) return null;
    try { $st = $p->prepare('SELECT * FROM ext_subs WHERE id = ?'); $st->execute([$id]); $r = $st->fetch(); return $r ?: null; }
    catch (Throwable $e) { return null; }
}
function extsub_add($name, $url, $ua) {
    extsub_ensure();
    $name = trim((string) $name); $url = trim((string) $url);
    if (!($p = db()) || $name === '' || $url === '') return false;
    if (!preg_match('~^https?://~i', $url)) return false;
    $ua = isset(extsub_ua_options()[strtolower($ua)]) ? strtolower($ua) : 'happ';
    try {
        $st = $p->prepare('INSERT INTO ext_subs (name, url, ua) VALUES (?, ?, ?)');
        return $st->execute([mb_substr($name, 0, 191), $url, $ua]);
    } catch (Throwable $e) { error_log('submw extsub add: ' . $e->getMessage()); return false; }
}
function extsub_update($id, $name, $url, $ua) {
    extsub_ensure();
    $id = (int) $id; $name = trim((string) $name); $url = trim((string) $url);
    if (!($p = db()) || $id <= 0 || $name === '' || $url === '') return false;
    if (!preg_match('~^https?://~i', $url)) return false;
    $ua = isset(extsub_ua_options()[strtolower($ua)]) ? strtolower($ua) : 'happ';
    try { return $p->prepare('UPDATE ext_subs SET name = ?, url = ?, ua = ? WHERE id = ?')->execute([mb_substr($name, 0, 191), $url, $ua, $id]); }
    catch (Throwable $e) { return false; }
}
function extsub_delete($id) {
    extsub_ensure();
    $id = (int) $id;
    if (!($p = db()) || $id <= 0) return false;
    // Отвязываем импортированные хосты (не удаляем их).
    try { $p->prepare('UPDATE squad_configs SET source_id = NULL, source_key = NULL WHERE source_id = ?')->execute([$id]); } catch (Throwable $e) {}
    try { return $p->prepare('DELETE FROM ext_subs WHERE id = ?')->execute([$id]); }
    catch (Throwable $e) { return false; }
}
function extsub_touch($id, $status, $error, $count) {
    extsub_ensure();
    $id = (int) $id;
    if (!($p = db()) || $id <= 0) return;
    try {
        $p->prepare('UPDATE ext_subs SET last_fetch_ts = ?, last_status = ?, last_error = ?, host_count = ? WHERE id = ?')
          ->execute([time(), mb_substr((string) $status, 0, 16), ($error !== '' ? mb_substr((string) $error, 0, 255) : null), (int) $count, $id]);
    } catch (Throwable $e) {}
}

// HTTP-запрос к источнику под UA клиента. Чистые заголовки (клиентские не форвардим).
function extsub_fetch($url, $ua_key, &$err = '') {
    $err = '';
    $url = trim((string) $url);
    if (!preg_match('~^https?://~i', $url)) { $err = 'Некорректный URL'; return null; }
    $ua = extsub_ua_string($ua_key);
    $to = function_exists('proxy_timeout') ? max(20, (int) proxy_timeout()) : 30;
    $verify = function_exists('api_tls_verify') ? api_tls_verify() : true;
    $ch = curl_init();
    curl_setopt_array($ch, [
        CURLOPT_URL            => $url,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS      => 5,
        CURLOPT_TIMEOUT        => $to,
        CURLOPT_CONNECTTIMEOUT => 15,
        CURLOPT_SSL_VERIFYPEER => $verify,
        CURLOPT_SSL_VERIFYHOST => $verify ? 2 : 0,
        CURLOPT_ENCODING       => '',
        CURLOPT_HTTPHEADER     => ['User-Agent: ' . $ua, 'Accept: */*'],
    ]);
    $body = curl_exec($ch);
    $e = curl_error($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($e !== '') { $err = 'Сеть: ' . $e; return null; }
    if ($code < 200 || $code >= 300) { $err = 'HTTP ' . $code; return null; }
    if (!is_string($body) || $body === '') { $err = 'Пустой ответ'; return null; }
    return $body;
}

function extsub_node_key($parsed) {
    if (!is_array($parsed)) return '';
    $h = (string) ($parsed['host'] ?? '');
    $p = (int) ($parsed['port'] ?? 0);
    if ($h === '' || $p <= 0) return '';
    return strtolower($h) . ':' . $p;
}

// URI без #remark — для сравнения параметров (drift), нечувствительно к имени.
function extsub_uri_norm($uri) {
    $uri = trim((string) $uri);
    $h = strpos($uri, '#');
    return $h === false ? $uri : substr($uri, 0, $h);
}

// Разбор тела источника → список хостов [{key,remark,type,uri,ok}].
function extsub_extract_hosts($body) {
    $body = (string) $body;
    $trim = ltrim($body);
    $out = []; $seen = [];
    $push = function ($uri, $remark) use (&$out, &$seen) {
        $uri = (string) $uri;
        if ($uri === '') return;
        $pn = squadconf_parse_any($uri);
        $key = extsub_node_key($pn);
        if ($key === '' || isset($seen[$key])) return;
        $seen[$key] = true;
        $out[] = [
            'key'    => $key,
            'remark' => (string) $remark !== '' ? (string) $remark : (string) ($pn['remark'] ?? ''),
            'type'   => (string) ($pn['type'] ?? ''),
            'uri'    => $uri,
            'ok'     => !empty($pn['ok']),
        ];
    };
    if ($trim !== '' && ($trim[0] === '[' || $trim[0] === '{')) {
        $j = json_decode($body, true);
        if (is_array($j)) {
            // xray-json массив конфигов (Happ) — по элементу на хост.
            $elements = (array_keys($j) === range(0, count($j) - 1)) ? $j : [$j];
            foreach ($elements as $el) {
                if (!is_array($el) || empty($el['outbounds']) || !is_array($el['outbounds'])) continue;
                $remark = (string) ($el['remarks'] ?? '');
                foreach ($el['outbounds'] as $ob) {
                    if (!is_array($ob)) continue;
                    $proto = (string) ($ob['protocol'] ?? '');
                    if ($proto === '' || in_array($proto, ['freedom', 'blackhole', 'dns'], true)) continue;
                    $uri = squadconf_node_from_xray($ob, $remark);
                    $push($uri, $remark);
                    break; // один прокси-аутбаунд на элемент
                }
            }
        }
        return $out;
    }
    // base64-подписка — список URI-строк.
    $dec = base64_decode(trim($body), true);
    if ($dec !== false && $dec !== '' && strpos($dec, '://') !== false) {
        foreach (preg_split('/\r\n|\r|\n/', $dec) as $ln) {
            $ln = trim($ln);
            if ($ln === '' || strpos($ln, '://') === false) continue;
            $push($ln, '');
        }
    }
    return $out;
}

// Фетч + извлечение + аннотация (imported/drift относительно уже импортированных).
function extsub_fetch_hosts($id, &$err = '') {
    $err = '';
    $s = extsub_get($id);
    if (!$s) { $err = 'Источник не найден'; return []; }
    $body = extsub_fetch($s['url'], $s['ua'], $err);
    if ($body === null) { extsub_touch($id, 'error', $err, 0); return []; }
    $hosts = extsub_extract_hosts($body);
    extsub_touch($id, 'ok', '', count($hosts));
    // существующие импортированные из этого источника — по source_key
    $mine = [];
    foreach (squadconf_by_source($id) as $r) {
        $k = (string) ($r['source_key'] ?? '');
        if ($k !== '') $mine[$k] = (string) ($r['raw'] ?? '');
    }
    foreach ($hosts as &$h) {
        $h['imported'] = isset($mine[$h['key']]);
        $h['drift'] = $h['imported'] && extsub_uri_norm($mine[$h['key']]) !== extsub_uri_norm($h['uri']);
    }
    unset($h);
    return $hosts;
}

// Импорт выбранных хостов (по ключам addr:port) в squad_configs с привязкой.
function extsub_import($id, array $keys, array $squads, $position, &$err = '') {
    $err = '';
    $s = extsub_get($id);
    if (!$s) { $err = 'Источник не найден'; return 0; }
    $squads = array_values(array_filter(array_map('strval', $squads), fn($x) => trim($x) !== ''));
    if (!$squads) { $err = 'Не выбраны сквады'; return 0; }
    $hosts = extsub_fetch_hosts($id, $err);
    if (!$hosts && $err !== '') return 0;
    $want = array_flip(array_values(array_map('strval', $keys)));
    $already = [];
    foreach (squadconf_by_source($id) as $r) { $k = (string) ($r['source_key'] ?? ''); if ($k !== '') $already[$k] = true; }
    $p = db();
    $n = 0;
    foreach ($hosts as $h) {
        if (!isset($want[$h['key']]) || empty($h['ok'])) continue;
        if (isset($already[$h['key']])) continue; // уже импортирован
        $pn = squadconf_parse_any($h['uri']);
        if (empty($pn['ok'])) continue;
        $ok = squadconf_add($squads, $pn['type'], ($h['remark'] !== '' ? $h['remark'] : squadconf_default_name($pn['type'])),
            $h['uri'], json_encode($pn, JSON_UNESCAPED_UNICODE), '', (string) $position, '', '');
        if (!$ok) continue;
        $newid = $p ? (int) $p->lastInsertId() : 0;
        if ($newid > 0) squadconf_set_source($newid, $id, $h['key']);
        $already[$h['key']] = true;
        $n++;
    }
    return $n;
}

// Дрифт: сверка привязанных хостов с текущим источником по source_key (addr:port).
function extsub_diff($id, &$err = '') {
    $err = '';
    $hosts = extsub_fetch_hosts($id, $err);
    $src = [];
    foreach ($hosts as $h) $src[$h['key']] = $h;
    $mine = [];
    foreach (squadconf_by_source($id) as $r) { $k = (string) ($r['source_key'] ?? ''); if ($k !== '') $mine[$k] = $r; }
    $res = ['new' => [], 'changed' => [], 'removed' => [], 'unchanged' => []];
    foreach ($src as $k => $h) {
        if (!isset($mine[$k])) { if (!empty($h['ok'])) $res['new'][] = $h; continue; }
        if (extsub_uri_norm((string) $mine[$k]['raw']) !== extsub_uri_norm($h['uri'])) $res['changed'][] = $h;
        else $res['unchanged'][] = $h;
    }
    foreach ($mine as $k => $r) { if (!isset($src[$k])) $res['removed'][] = ['key' => $k, 'remark' => (string) ($r['name'] ?? $k)]; }
    return $res;
}

// Ре-синк: обновить raw/parsed привязанных хостов из источника (сохраняя
// name/position/overrides/xray_tpl/squads). Возвращает число обновлённых.
function extsub_resync($id, &$err = '') {
    $err = '';
    $d = extsub_diff($id, $err);
    if ($err !== '' && !$d['changed']) return 0;
    $mine = [];
    foreach (squadconf_by_source($id) as $r) { $k = (string) ($r['source_key'] ?? ''); if ($k !== '') $mine[$k] = $r; }
    $n = 0;
    foreach ($d['changed'] as $h) {
        $row = $mine[$h['key']] ?? null;
        if (!$row) continue;
        $pn = squadconf_parse_any($h['uri']);
        if (empty($pn['ok'])) continue;
        $ok = squadconf_update((int) $row['id'], squadconf_squads_of($row), $pn['type'],
            (string) ($row['name'] ?? ''), $h['uri'], json_encode($pn, JSON_UNESCAPED_UNICODE));
        if ($ok) $n++;
    }
    return $n;
}
