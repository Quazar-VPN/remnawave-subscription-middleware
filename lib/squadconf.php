<?php

function squadconf_ensure() {
    static $done = false;
    if ($done) return;
    $done = true;
    if (!($p = db())) return;
    try {
        if (db_driver() === 'mysql') {
            $p->exec("CREATE TABLE IF NOT EXISTS squad_configs (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                squad_uuid VARCHAR(64) NOT NULL,
                type VARCHAR(32) NOT NULL DEFAULT 'amneziawg',
                name VARCHAR(191) NULL,
                enabled TINYINT(1) NOT NULL DEFAULT 1,
                raw MEDIUMTEXT NOT NULL,
                parsed MEDIUMTEXT NULL,
                grp VARCHAR(64) NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_squad (squad_uuid)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        } else {
            $p->exec("CREATE TABLE IF NOT EXISTS squad_configs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                squad_uuid TEXT NOT NULL,
                type TEXT NOT NULL DEFAULT 'amneziawg',
                name TEXT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                raw TEXT NOT NULL,
                parsed TEXT NULL,
                grp TEXT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )");
            $p->exec("CREATE INDEX IF NOT EXISTS idx_squad_cfg ON squad_configs(squad_uuid)");
        }
        if (setting('sqcfg_squads_col', '') !== '1') {
            try { $p->exec('ALTER TABLE squad_configs ADD COLUMN squads ' . (db_driver() === 'mysql' ? 'MEDIUMTEXT' : 'TEXT') . ' NULL'); } catch (Throwable $e) {}
            set_setting('sqcfg_squads_col', '1');
        }
        if (setting('sqcfg_grp_col', '') !== '1') {
            try { $p->exec('ALTER TABLE squad_configs ADD COLUMN grp ' . (db_driver() === 'mysql' ? 'VARCHAR(64)' : 'TEXT') . ' NULL'); } catch (Throwable $e) {}
            set_setting('sqcfg_grp_col', '1');
        }
        // Форк Quazar: позиция вставки хоста, per-host xray-json шаблон и JSON-оверрайды
        // (sockopt / xhttpExtra / mux / finalMask / serverDescription). Аддитивны —
        // старый образ их игнорирует, поэтому rollback безопасен.
        if (setting('sqcfg_position_col', '') !== '1') {
            try { $p->exec('ALTER TABLE squad_configs ADD COLUMN position ' . (db_driver() === 'mysql' ? 'VARCHAR(191)' : 'TEXT') . ' NULL'); } catch (Throwable $e) {}
            set_setting('sqcfg_position_col', '1');
        }
        if (setting('sqcfg_xray_tpl_col', '') !== '1') {
            try { $p->exec('ALTER TABLE squad_configs ADD COLUMN xray_tpl ' . (db_driver() === 'mysql' ? 'VARCHAR(64)' : 'TEXT') . ' NULL'); } catch (Throwable $e) {}
            set_setting('sqcfg_xray_tpl_col', '1');
        }
        if (setting('sqcfg_overrides_col', '') !== '1') {
            try { $p->exec('ALTER TABLE squad_configs ADD COLUMN overrides ' . (db_driver() === 'mysql' ? 'MEDIUMTEXT' : 'TEXT') . ' NULL'); } catch (Throwable $e) {}
            set_setting('sqcfg_overrides_col', '1');
        }
        // Форк Quazar (R2): привязка хоста к внешней подписке-источнику (импорт /
        // ре-синк / дрифт). source_key = addr:port (ключ сопоставления с источником).
        if (setting('sqcfg_source_col', '') !== '1') {
            try { $p->exec('ALTER TABLE squad_configs ADD COLUMN source_id ' . (db_driver() === 'mysql' ? 'INT UNSIGNED' : 'INTEGER') . ' NULL'); } catch (Throwable $e) {}
            try { $p->exec('ALTER TABLE squad_configs ADD COLUMN source_key ' . (db_driver() === 'mysql' ? 'VARCHAR(191)' : 'TEXT') . ' NULL'); } catch (Throwable $e) {}
            set_setting('sqcfg_source_col', '1');
        }
        // Форк Quazar (R3): тег-балансер. Хосты с одинаковым lb_tag в формате Happ/xray
        // дополнительно сводятся в один клиентский балансер (см. squadconf_inject_xray_json).
        // Тег = имя тега хоста в панели Remnawave (напр. LTE_BALANCER). Аддитивно.
        if (setting('sqcfg_lbtag_col', '') !== '1') {
            try { $p->exec('ALTER TABLE squad_configs ADD COLUMN lb_tag ' . (db_driver() === 'mysql' ? 'VARCHAR(64)' : 'TEXT') . ' NULL'); } catch (Throwable $e) {}
            set_setting('sqcfg_lbtag_col', '1');
        }
    } catch (Throwable $e) { error_log('submw squadconf ensure: ' . $e->getMessage()); }
}

// Форк Quazar (R2): привязка/чтение источника для строки конфига.
function squadconf_set_source($id, $source_id, $source_key) {
    squadconf_ensure();
    $id = (int) $id;
    if (!($p = db()) || $id <= 0) return false;
    try {
        $st = $p->prepare('UPDATE squad_configs SET source_id = ?, source_key = ? WHERE id = ?');
        return $st->execute([
            ($source_id ? (int) $source_id : null),
            (trim((string) $source_key) !== '' ? mb_substr((string) $source_key, 0, 191) : null),
            $id,
        ]);
    } catch (Throwable $e) { error_log('submw squadconf set_source: ' . $e->getMessage()); return false; }
}

function squadconf_by_source($source_id) {
    squadconf_ensure();
    $source_id = (int) $source_id;
    if (!($p = db()) || $source_id <= 0) return [];
    try {
        $st = $p->prepare('SELECT * FROM squad_configs WHERE source_id = ?');
        $st->execute([$source_id]);
        return $st->fetchAll();
    } catch (Throwable $e) { return []; }
}

// -----------------------------------------------------------------------------
// Форк Quazar: доступ к новым полям строки конфига + разбор позиции вставки.
// -----------------------------------------------------------------------------

// Позиция вставки: end (дефолт) | start | before:<remark> | after:<remark>.
// Возвращает ['mode' => end|start|before|after, 'anchor' => <remark>].
function squadconf_position_parse($pos) {
    $pos = trim((string) $pos);
    if ($pos === '' || $pos === 'end') return ['mode' => 'end', 'anchor' => ''];
    if ($pos === 'start') return ['mode' => 'start', 'anchor' => ''];
    if (strpos($pos, 'before:') === 0) return ['mode' => 'before', 'anchor' => trim(substr($pos, 7))];
    if (strpos($pos, 'after:') === 0)  return ['mode' => 'after',  'anchor' => trim(substr($pos, 6))];
    return ['mode' => 'end', 'anchor' => ''];
}

function squadconf_position_of($row) {
    return squadconf_position_parse((string) ($row['position'] ?? ''));
}

function squadconf_tpl_of($row) {
    return trim((string) ($row['xray_tpl'] ?? ''));
}

// Форк Quazar (R3): тег-балансер строки конфига (имя тега хоста в панели).
function squadconf_lbtag_of($row) {
    return trim((string) ($row['lb_tag'] ?? ''));
}

function squadconf_overrides_of($row) {
    $s = (string) ($row['overrides'] ?? '');
    if ($s === '') return [];
    $a = json_decode($s, true);
    return is_array($a) ? $a : [];
}

// Нормализация имени узла для сопоставления anchor'а и дедупа: срезаем ведущие
// emoji-флаги и пробелы, приводим к нижнему регистру. Позволяет попасть в хост,
// чей remark в теле подписки отрендерен с флагом-префиксом.
function squadconf_name_norm($s) {
    $s = trim((string) $s);
    // убрать ведущие региональные индикаторы (флаги) и разделители
    $s = preg_replace('/^(?:[\x{1F1E6}-\x{1F1FF}]{2}\s*)+/u', '', $s);
    return mb_strtolower(trim($s));
}

// Слить админские оверрайды в структуру parsed перед сборкой узла. Emitter'ы
// читают эти поля из parsed и выводят их (sockopt/mux — в xray; xhttpExtra/fm —
// в xhttp/finalmask). serverDescription применяет инжектор на уровне элемента.
function squadconf_apply_overrides($parsed, $ov) {
    if (!is_array($parsed) || !is_array($ov) || !$ov) return $parsed;
    if (isset($ov['xhttpExtra']) && is_array($ov['xhttpExtra']) && $ov['xhttpExtra']) $parsed['extra'] = $ov['xhttpExtra'];
    if (isset($ov['finalMask']) && is_array($ov['finalMask']) && $ov['finalMask'])     $parsed['fm'] = $ov['finalMask'];
    if (isset($ov['sockopt']) && is_array($ov['sockopt']) && $ov['sockopt'])           $parsed['sockopt'] = $ov['sockopt'];
    if (isset($ov['mux']) && is_array($ov['mux']) && $ov['mux'])                        $parsed['mux'] = $ov['mux'];
    $sd = trim((string) ($ov['serverDescription'] ?? ''));
    if ($sd !== '') $parsed['serverDescription'] = $sd;
    return $parsed;
}

// Планировщик порядка для форматов-списков (base64 / clash / xray-array).
// Вход: имена существующих узлов В ПОРЯДКЕ ТЕЛА + кандидаты
//   [{'name','pos'=>['mode','anchor'],'payload'}]. На выходе — финальная
// последовательность слотов ['kind'=>existing|new,'orig'=>i|'payload'=>...].
// Дедуп кандидатов делает вызывающий (skip до передачи сюда); здесь только порядок.
function squadconf_plan_order(array $existing_names, array $candidates) {
    $norm = array_map('squadconf_name_norm', $existing_names);
    $n = count($existing_names);
    // Поиск якоря среди УЖЕ присутствующих в подписке имён (панельные хосты).
    $find = function ($anchor) use ($norm) {
        $a = squadconf_name_norm($anchor);
        if ($a === '') return -1;
        foreach ($norm as $i => $x) if ($x === $a) return $i;                         // точное совпадение
        foreach ($norm as $i => $x) if ($x !== '' && strpos($x, $a) !== false) return $i; // по подстроке (терпимо к флагам/суффиксам)
        return -1;
    };
    // Имена самих кандидатов (добавленных конфигов) — чтобы before/after мог
    // ссылаться на другой добавленный конфиг того же сквада, а не только на
    // панельный хост. Индекс кандидата → его normalized name.
    $candNorm = [];
    foreach ($candidates as $ci => $c) $candNorm[$ci] = squadconf_name_norm((string) ($c['name'] ?? ''));
    $findCand = function ($anchor, $self) use ($candNorm) {
        $a = squadconf_name_norm($anchor);
        if ($a === '') return -1;
        foreach ($candNorm as $cj => $x) if ($cj !== $self && $x !== '' && $x === $a) return $cj;
        foreach ($candNorm as $cj => $x) if ($cj !== $self && $x !== '' && strpos($x, $a) !== false) return $cj;
        return -1;
    };

    // Ключ каждого кандидата. Якорь на панельный хост / start / end считается
    // сразу; якорь на другой кандидат откладываем и разрешаем относительно него.
    $keys = [];        // ci => float|null (null = ещё не разрешён)
    $pending = [];     // ci => [targetCandIndex, side]
    $seq = 0;
    foreach ($candidates as $ci => $c) {
        $seq++;
        $eps = $seq / 1000000.0; // стабильный tie-break между кандидатами на одной позиции
        $pos = $c['pos'] ?? ['mode' => 'end', 'anchor' => ''];
        $mode = $pos['mode'] ?? 'end';
        $anchor = $pos['anchor'] ?? '';
        if ($mode === 'start') { $keys[$ci] = -1.0 + $eps; continue; }
        if ($mode === 'end')   { $keys[$ci] = (float) $n + $eps; continue; }
        // before / after
        $a = $find($anchor);
        if ($a >= 0) { $keys[$ci] = ($mode === 'before' ? $a - 0.5 : $a + 0.5) + $eps; continue; }
        $tgt = $findCand($anchor, $ci);
        if ($tgt >= 0) { $keys[$ci] = null; $pending[$ci] = [$tgt, $mode]; continue; }
        $keys[$ci] = (float) $n + $eps; // якорь нигде не найден → в конец
    }
    // Итеративно разрешаем кандидат→кандидат (в т.ч. цепочки). Число проходов
    // ограничено количеством кандидатов, поэтому циклы не зациклят.
    for ($pass = count($candidates); $pass > 0 && $pending; $pass--) {
        $progress = false;
        foreach ($pending as $ci => [$tgt, $side]) {
            if ($keys[$tgt] === null) continue; // цель ещё не готова
            $delta = ($side === 'before' ? -1 : 1) * 0.001;
            $keys[$ci] = $keys[$tgt] + $delta + ($ci + 1) / 1000000000.0; // сдвиг + tie-break
            unset($pending[$ci]);
            $progress = true;
        }
        if (!$progress) break; // остались только циклы
    }
    foreach ($pending as $ci => $_) $keys[$ci] = (float) $n + ($ci + 1) / 1000000.0; // цикл → в конец

    $items = [];
    foreach ($existing_names as $i => $nm) $items[] = ['key' => (float) $i, 'kind' => 'existing', 'orig' => $i];
    foreach ($candidates as $ci => $c) $items[] = ['key' => $keys[$ci], 'kind' => 'new', 'payload' => $c['payload'], 'name' => $c['name']];
    usort($items, fn($x, $y) => $x['key'] <=> $y['key']); // PHP 8 — стабильная сортировка
    return $items;
}

// Общий шаг сборки кандидатов: разбор parsed, слияние оверрайдов, разрешение
// имени с дедупом по УЖЕ присутствующим именам и между кандидатами. Возвращает
// [{'c'=>row,'pn'=>parsed,'name'=>resolved}] только для НЕ-дублей нужных типов.
function squadconf_candidates(array $configs, array $existing_names, array $types, $default_name_fn) {
    $taken = array_map('squadconf_name_norm', $existing_names);
    $taken = array_flip(array_filter($taken, fn($x) => $x !== ''));
    $out = [];
    foreach ($configs as $c) {
        $pn = json_decode((string) ($c['parsed'] ?? ''), true);
        if (!is_array($pn)) continue;
        $t = $pn['type'] ?? '';
        if ($types && !in_array($t, $types, true)) continue;
        $pn = squadconf_apply_overrides($pn, squadconf_overrides_of($c));
        $nm = ($c['name'] !== null && trim((string) $c['name']) !== '') ? trim((string) $c['name']) : (string) $default_name_fn($t);
        $key = squadconf_name_norm($nm);
        if ($key === '' || isset($taken[$key])) continue; // п.4: имя уже есть у юзера → пропускаем
        $taken[$key] = true;
        $out[] = ['c' => $c, 'pn' => $pn, 'name' => $nm];
    }
    return $out;
}

// -----------------------------------------------------------------------------
// Форк Quazar: матрица «протокол → ядра» и диспетчеры эмиттеров.
// URI-протоколы (кроме wg/awg) собираются per-core функциями <type>_to_<core>()
// из lib/proto/*.php и lib/vless.php. hy2/tuic в xray-core отсутствуют.
// -----------------------------------------------------------------------------
function squadconf_proto_matrix() {
    return [
        'vless'       => ['base64', 'clash', 'singbox', 'xray'],
        'trojan'      => ['base64', 'clash', 'singbox', 'xray'],
        'shadowsocks' => ['base64', 'clash', 'singbox', 'xray'],
        'hysteria2'   => ['base64', 'clash', 'singbox', 'xray'],
        'tuic'        => ['base64', 'clash', 'singbox'],
        'wireguard'   => ['base64', 'clash', 'singbox', 'xray'],
        'amneziawg'   => ['base64', 'clash'],
    ];
}

// URI-протоколы = всё, кроме wg/awg (у тех своя .conf-модель и эмиттеры awg_*).
function squadconf_uri_protos() { return ['vless', 'trojan', 'shadowsocks', 'hysteria2', 'tuic']; }

function squadconf_is_uri_proto($t) { return in_array((string) $t, squadconf_uri_protos(), true); }

function squadconf_proto_core_ok($type, $core) {
    $m = squadconf_proto_matrix();
    return isset($m[$type]) && in_array($core, $m[$type], true);
}

function squadconf_default_name($t) {
    switch ($t) {
        case 'vless': return 'VLESS';
        case 'trojan': return 'Trojan';
        case 'shadowsocks': return 'Shadowsocks';
        case 'hysteria2': return 'Hysteria2';
        case 'tuic': return 'TUIC';
        case 'wireguard': return 'WireGuard';
        case 'amneziawg': return 'AmneziaWG';
    }
    return 'Config';
}

// Диспетчеры: wg/awg — спец. эмиттеры; остальные URI-протоколы по имени функции
// <type>_to_<core>. function_exists — чтобы форк грузился до появления lib/proto/*.
function squadconf_to_clash($pn, $name) {
    $t = (string) ($pn['type'] ?? '');
    if (in_array($t, ['wireguard', 'amneziawg'], true)) return awg_to_clash($pn, $name);
    $fn = $t . '_to_clash';
    return function_exists($fn) ? (string) $fn($pn, $name) : '';
}
function squadconf_to_singbox_node($pn, $tag) {
    $t = (string) ($pn['type'] ?? '');
    $fn = $t . '_to_singbox';
    return function_exists($fn) ? $fn($pn, $tag) : null;
}
function squadconf_to_xray($pn, $tag) {
    $t = (string) ($pn['type'] ?? '');
    if ($t === 'wireguard') return xray_wg_outbound($pn, $tag);
    $fn = $t . '_to_xray';
    return function_exists($fn) ? $fn($pn, $tag) : null;
}

// Реверс-диспетчер для импорта: xray-outbound → URI (vless/hysteria2/…). '' если
// протокол не поддержан для извлечения. Использует <proto>_from_xray из lib/proto/*.
function squadconf_node_from_xray($ob, $remark = '') {
    if (!is_array($ob)) return '';
    $proto = (string) ($ob['protocol'] ?? '');
    // xray-имя протокола → наш тип/функция (hysteria = hysteria2).
    $map = ['vless' => 'vless', 'trojan' => 'trojan', 'shadowsocks' => 'shadowsocks', 'hysteria' => 'hysteria2'];
    if (!isset($map[$proto])) return '';
    $fn = $map[$proto] . '_from_xray';
    return function_exists($fn) ? (string) $fn($ob, $remark) : '';
}

function squadconf_squads_of($row) {
    $s = (string) ($row['squads'] ?? '');
    if ($s !== '') {
        $a = json_decode($s, true);
        if (is_array($a)) { $a = array_values(array_filter(array_map('strval', $a), fn($x) => $x !== '')); if ($a) return $a; }
    }
    $u = (string) ($row['squad_uuid'] ?? '');
    return $u !== '' ? [$u] : [];
}

function squadconf_by_ids(array $ids) {
    squadconf_ensure();
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids), fn($x) => $x > 0)));
    if (!$ids || !($p = db())) return [];
    try {
        $in = implode(',', array_fill(0, count($ids), '?'));
        $st = $p->prepare("SELECT * FROM squad_configs WHERE id IN ($in)");
        $st->execute($ids);
        return $st->fetchAll();
    } catch (Throwable $e) { return []; }
}

function squadconf_all() {
    squadconf_ensure();
    if (!($p = db())) return [];
    try {
        $out = [];
        foreach ($p->query('SELECT * FROM squad_configs ORDER BY squad_uuid, id') as $r) $out[] = $r;
        return $out;
    } catch (Throwable $e) { return []; }
}

function squadconf_for_squads(array $squad_uuids) {
    squadconf_ensure();
    $user = array_flip(array_values(array_filter(array_map('strval', $squad_uuids), fn($s) => $s !== '')));
    if (!$user || !($p = db())) return [];
    $out = [];
    try {
        foreach ($p->query('SELECT * FROM squad_configs WHERE enabled = 1 ORDER BY id') as $r) {
            foreach (squadconf_squads_of($r) as $sq) {
                if (isset($user[$sq])) { $out[] = $r; break; }
            }
        }
    } catch (Throwable $e) { error_log('submw squadconf for_squads: ' . $e->getMessage()); }
    return $out;
}

function squadconf_add($squad_uuids, $type, $name, $raw, $parsed, $grp = '', $position = 'end', $xray_tpl = '', $overrides = '', $lb_tag = '') {
    squadconf_ensure();
    $squad_uuids = array_values(array_filter(array_unique(array_map('strval', (array) $squad_uuids)), fn($s) => trim($s) !== ''));
    $raw = (string) $raw;
    if (!($p = db()) || !$squad_uuids || trim($raw) === '') return false;
    $grp = trim((string) $grp);
    $position = trim((string) $position);
    $xray_tpl = trim((string) $xray_tpl);
    $overrides = trim((string) $overrides);
    $lb_tag = trim((string) $lb_tag);
    try {
        $st = $p->prepare('INSERT INTO squad_configs (squad_uuid, squads, type, name, raw, parsed, grp, position, xray_tpl, overrides, lb_tag) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        return $st->execute([
            $squad_uuids[0],
            json_encode(array_values($squad_uuids), JSON_UNESCAPED_SLASHES),
            mb_substr((string) $type, 0, 32),
            ($name !== '' ? mb_substr((string) $name, 0, 191) : null),
            $raw,
            ($parsed !== '' ? (string) $parsed : null),
            ($grp !== '' ? mb_substr($grp, 0, 64) : null),
            ($position !== '' ? mb_substr($position, 0, 191) : null),
            ($xray_tpl !== '' ? mb_substr($xray_tpl, 0, 64) : null),
            ($overrides !== '' ? $overrides : null),
            ($lb_tag !== '' ? mb_substr($lb_tag, 0, 64) : null),
        ]);
    } catch (Throwable $e) { error_log('submw squadconf add: ' . $e->getMessage()); return false; }
}

// $grp === null → группу не трогаем (для массовых правок параметров конфига).
function squadconf_set_group(array $ids, $grp) {
    squadconf_ensure();
    $ids = array_values(array_filter(array_map('intval', $ids), fn($i) => $i > 0));
    if (!($p = db()) || !$ids) return 0;
    $g = trim((string) $grp);
    $in = implode(',', array_fill(0, count($ids), '?'));
    try {
        $st = $p->prepare("UPDATE squad_configs SET grp = ? WHERE id IN ($in)");
        $st->execute(array_merge([$g !== '' ? mb_substr($g, 0, 64) : null], $ids));
        return $st->rowCount();
    } catch (Throwable $e) { error_log('submw squadconf set_group: ' . $e->getMessage()); return 0; }
}

function squadconf_delete($id) {
    squadconf_ensure();
    $id = (int) $id;
    if (!($p = db()) || $id <= 0) return false;
    try { return $p->prepare('DELETE FROM squad_configs WHERE id = ?')->execute([$id]); }
    catch (Throwable $e) { error_log('submw squadconf delete: ' . $e->getMessage()); return false; }
}

function squadconf_toggle($id, $enabled) {
    squadconf_ensure();
    $id = (int) $id;
    if (!($p = db()) || $id <= 0) return false;
    try { return $p->prepare('UPDATE squad_configs SET enabled = ? WHERE id = ?')->execute([$enabled ? 1 : 0, $id]); }
    catch (Throwable $e) { error_log('submw squadconf toggle: ' . $e->getMessage()); return false; }
}

// $grp/$position/$xray_tpl/$overrides === null → соответствующее поле НЕ трогаем
// (для массовых правок параметров конфига, которые шлют только базовые поля).
function squadconf_update($id, $squad_uuids, $type, $name, $raw, $parsed, $grp = null, $position = null, $xray_tpl = null, $overrides = null, $lb_tag = null) {
    squadconf_ensure();
    $id = (int) $id;
    $squad_uuids = array_values(array_filter(array_unique(array_map('strval', (array) $squad_uuids)), fn($s) => trim($s) !== ''));
    $raw = (string) $raw;
    if (!($p = db()) || $id <= 0 || !$squad_uuids || trim($raw) === '') return false;
    // Базовые поля есть всегда; опциональные добавляем в SET только когда переданы.
    $cols = ['squad_uuid = ?', 'squads = ?', 'type = ?', 'name = ?', 'raw = ?', 'parsed = ?'];
    $vals = [
        $squad_uuids[0],
        json_encode(array_values($squad_uuids), JSON_UNESCAPED_SLASHES),
        mb_substr((string) $type, 0, 32),
        ($name !== '' ? mb_substr((string) $name, 0, 191) : null),
        $raw,
        ($parsed !== '' ? (string) $parsed : null),
    ];
    if ($grp !== null)       { $g = trim((string) $grp);       $cols[] = 'grp = ?';       $vals[] = ($g !== '' ? mb_substr($g, 0, 64) : null); }
    if ($position !== null)  { $ps = trim((string) $position); $cols[] = 'position = ?';  $vals[] = ($ps !== '' ? mb_substr($ps, 0, 191) : null); }
    if ($xray_tpl !== null)  { $xt = trim((string) $xray_tpl); $cols[] = 'xray_tpl = ?';  $vals[] = ($xt !== '' ? mb_substr($xt, 0, 64) : null); }
    if ($overrides !== null) { $ovr = trim((string) $overrides); $cols[] = 'overrides = ?'; $vals[] = ($ovr !== '' ? $ovr : null); }
    if ($lb_tag !== null)    { $lt = trim((string) $lb_tag);   $cols[] = 'lb_tag = ?';    $vals[] = ($lt !== '' ? mb_substr($lt, 0, 64) : null); }
    $vals[] = $id;
    try {
        $st = $p->prepare('UPDATE squad_configs SET ' . implode(', ', $cols) . ' WHERE id = ?');
        return $st->execute($vals);
    } catch (Throwable $e) { error_log('submw squadconf update: ' . $e->getMessage()); return false; }
}

function awg_split_list($v) {
    $out = [];
    foreach (explode(',', (string) $v) as $part) {
        $part = trim($part);
        if ($part !== '') $out[] = $part;
    }
    return $out;
}

function awg_parse_conf($raw) {
    $res = ['ok' => false, 'type' => 'unknown', 'version' => '', 'iface' => [], 'peer' => [], 'clients' => [], 'warnings' => []];
    $raw = (string) $raw;
    if (stripos(ltrim($raw), 'vpn://') === 0) {
        $res['warnings'][] = 'Это контейнер AmneziaVPN (vpn://), а не клиентский конфиг. Нужен .conf с секциями [Interface] и [Peer].';
        return $res;
    }
    $section = '';
    foreach (preg_split('/\r\n|\r|\n/', $raw) as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#' || $line[0] === ';') continue;
        if ($line[0] === '[') { $section = strtolower(trim($line, "[] \t")); continue; }
        $pos = strpos($line, '=');
        if ($pos === false) continue;
        $k = trim(substr($line, 0, $pos));
        $v = trim(substr($line, $pos + 1));
        if ($section === 'interface') $res['iface'][$k] = $v;
        elseif ($section === 'peer') $res['peer'][$k] = $v;
    }
    if (!$res['iface'] || !$res['peer']) {
        $res['warnings'][] = 'Не найдены секции [Interface] и [Peer] — это не похоже на WireGuard/AmneziaWG .conf.';
        return $res;
    }

    $obf = ['Jc', 'Jmin', 'Jmax', 'S1', 'S2', 'S3', 'S4', 'H1', 'H2', 'H3', 'H4', 'I1', 'I2', 'I3', 'I4', 'I5'];
    $has_obf = false;
    foreach ($obf as $f) if (isset($res['iface'][$f]) && $res['iface'][$f] !== '') { $has_obf = true; break; }
    $res['type'] = $has_obf ? 'amneziawg' : 'wireguard';

    $h_range = false;
    foreach (['H1', 'H2', 'H3', 'H4'] as $f) if (!empty($res['iface'][$f]) && strpos($res['iface'][$f], '-') !== false) $h_range = true;
    $has_s34 = (!empty($res['iface']['S3']) || !empty($res['iface']['S4']));
    $has_i = false;
    foreach (['I1', 'I2', 'I3', 'I4', 'I5'] as $f) if (!empty($res['iface'][$f])) $has_i = true;
    if ($res['type'] === 'amneziawg') {
        if ($h_range || $has_s34) $res['version'] = '2.0';
        elseif ($has_i) $res['version'] = '1.5';
        else $res['version'] = '1.0';
    }

    $missing = false;
    foreach (['PrivateKey', 'Address'] as $f) if (empty($res['iface'][$f])) { $res['warnings'][] = "В [Interface] нет обязательного поля $f."; $missing = true; }
    foreach (['PublicKey', 'Endpoint'] as $f) if (empty($res['peer'][$f])) { $res['warnings'][] = "В [Peer] нет обязательного поля $f."; $missing = true; }

    if ($res['type'] === 'amneziawg') {
        $res['clients'] = ['Mihomo / Clash.Meta', 'Throne (wg://)'];
        $res['warnings'][] = 'AmneziaWG: работает в Mihomo (clash) и в клиентах с wg://-AmneziaWG (Throne и др.). В v2rayNG (wireguard://), xray и sing-box — нет (там нет amnezia-обфускации).';
    } elseif ($res['type'] === 'wireguard') {
        $res['clients'] = ['Mihomo / Clash.Meta', 'base64-клиенты (v2rayNG и др.)', 'sing-box 1.11+'];
        $res['warnings'][] = 'sing-box: только актуальная версия (1.11+) — WG отдаётся новым форматом endpoints; в сборках до 1.11 узел не подхватится.';
    }

    $res['ok'] = in_array($res['type'], ['wireguard', 'amneziawg'], true) && !$missing;
    return $res;
}

function awg_summary($parsed) {
    if (!is_array($parsed)) return '';
    if ($parsed['type'] === 'amneziawg') return 'AmneziaWG ' . ($parsed['version'] ?: '');
    if ($parsed['type'] === 'wireguard') return 'WireGuard';
    return 'неизвестный формат';
}

function awg_to_clash($parsed, $name) {
    if (!is_array($parsed) || !in_array($parsed['type'] ?? '', ['amneziawg', 'wireguard'], true)) return '';
    $if = $parsed['iface']; $pe = $parsed['peer'];
    $ep = (string) ($pe['Endpoint'] ?? '');
    $host = $ep; $port = '';
    if (($pos = strrpos($ep, ':')) !== false) { $host = substr($ep, 0, $pos); $port = substr($ep, $pos + 1); }
    $host = trim($host, '[]');

    $addr = awg_split_list($if['Address'] ?? '');
    $ip4 = ''; $ip6 = '';
    foreach ($addr as $a) { if (strpos($a, ':') !== false) { if ($ip6 === '') $ip6 = $a; } elseif ($ip4 === '') $ip4 = $a; }

    $allowed = awg_split_list($pe['AllowedIPs'] ?? '0.0.0.0/0, ::/0');
    $dns = awg_split_list($if['DNS'] ?? '');

    $L = [];
    $L[] = '  - name: ' . yaml_q($name);
    $L[] = '    type: wireguard';
    $L[] = '    server: ' . $host;
    if ($port !== '') $L[] = '    port: ' . (int) $port;
    if ($ip4 !== '') $L[] = '    ip: ' . $ip4;
    if ($ip6 !== '') $L[] = '    ipv6: ' . $ip6;
    $L[] = '    private-key: ' . yaml_q($if['PrivateKey'] ?? '');
    $L[] = '    public-key: ' . yaml_q($pe['PublicKey'] ?? '');
    if (!empty($pe['PresharedKey'])) $L[] = '    pre-shared-key: ' . yaml_q($pe['PresharedKey']);
    $L[] = '    allowed-ips: [' . implode(', ', array_map('yaml_q', $allowed)) . ']';
    if ($dns) $L[] = '    dns: [' . implode(', ', array_map('yaml_q', $dns)) . ']';
    if (!empty($if['MTU'])) $L[] = '    mtu: ' . (int) $if['MTU'];
    $L[] = '    udp: true';
    $ka = (int) ($pe['PersistentKeepalive'] ?? 25);
    if ($ka > 0) $L[] = '    persistent-keepalive: ' . $ka;

    $opt = [];
    foreach (['Jc' => 'jc', 'Jmin' => 'jmin', 'Jmax' => 'jmax', 'S1' => 's1', 'S2' => 's2', 'S3' => 's3', 'S4' => 's4'] as $src => $dst) {
        if (isset($if[$src]) && $if[$src] !== '') $opt[] = [$dst, (string) (int) $if[$src]];
    }
    foreach (['H1' => 'h1', 'H2' => 'h2', 'H3' => 'h3', 'H4' => 'h4'] as $src => $dst) {
        if (isset($if[$src]) && $if[$src] !== '') $opt[] = [$dst, (string) $if[$src]];
    }
    foreach (['I1' => 'i1', 'I2' => 'i2', 'I3' => 'i3', 'I4' => 'i4', 'I5' => 'i5'] as $src => $dst) {
        if (!empty($if[$src])) $opt[] = [$dst, yaml_q((string) $if[$src])];
    }
    if ($opt) {
        $L[] = '    amnezia-wg-option:';
        foreach ($opt as $kv) $L[] = '      ' . $kv[0] . ': ' . $kv[1];
    }
    return implode("\n", $L);
}

function wg_to_uri($parsed, $name) {
    if (!is_array($parsed) || ($parsed['type'] ?? '') !== 'wireguard') return '';
    $if = $parsed['iface']; $pe = $parsed['peer'];
    $ep = (string) ($pe['Endpoint'] ?? '');
    $host = $ep; $port = '';
    if (($pos = strrpos($ep, ':')) !== false) { $host = substr($ep, 0, $pos); $port = substr($ep, $pos + 1); }
    $host = trim($host, '[]');
    $pk = (string) ($if['PrivateKey'] ?? '');
    if ($pk === '' || $host === '' || $port === '' || empty($pe['PublicKey'])) return '';
    $q = [];
    $addr = str_replace(' ', '', (string) ($if['Address'] ?? ''));
    if ($addr !== '') $q[] = 'address=' . $addr;
    $q[] = 'publickey=' . (string) $pe['PublicKey'];
    if (!empty($pe['PresharedKey'])) $q[] = 'presharedkey=' . (string) $pe['PresharedKey'];
    if (!empty($if['MTU'])) $q[] = 'mtu=' . (int) $if['MTU'];
    if (!empty($pe['PersistentKeepalive'])) $q[] = 'keepalive=' . (int) $pe['PersistentKeepalive'];
    return 'wireguard://' . $pk . '@' . $host . ':' . (int) $port . '?' . implode('&', $q) . '#' . rawurlencode($name);
}

function squadconf_any() {
    static $cached = null;
    if ($cached !== null) return $cached;
    squadconf_ensure();
    $cached = false;
    if (!($p = db())) return false;
    try { $cached = (bool) $p->query('SELECT 1 FROM squad_configs WHERE enabled = 1 LIMIT 1')->fetchColumn(); }
    catch (Throwable $e) { $cached = false; }
    return $cached;
}

function squadconf_cache_ensure() {
    static $done = false;
    if ($done) return;
    $done = true;
    if (!($p = db())) return;
    try {
        if (db_driver() === 'mysql') {
            $p->exec("CREATE TABLE IF NOT EXISTS squad_cache (
                su VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                squads TEXT NULL,
                st VARCHAR(32) NULL,
                ts INT UNSIGNED NOT NULL DEFAULT 0,
                PRIMARY KEY (su)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        } else {
            $p->exec("CREATE TABLE IF NOT EXISTS squad_cache (
                su TEXT NOT NULL PRIMARY KEY,
                squads TEXT NULL,
                st TEXT NULL,
                ts INTEGER NOT NULL DEFAULT 0
            )");
        }
        if (setting('sqcache_st_col', '') !== '1') {
            try { $p->exec('ALTER TABLE squad_cache ADD COLUMN st ' . (db_driver() === 'mysql' ? 'VARCHAR(32)' : 'TEXT') . ' NULL'); } catch (Throwable $e) {}
            set_setting('sqcache_st_col', '1');
        }
    } catch (Throwable $e) { error_log('submw squad_cache ensure: ' . $e->getMessage()); }
}

function squadconf_cache_drop($short) {
    $short = trim((string) $short);
    if ($short === '' || !($p = db())) return;
    squadconf_cache_ensure();
    try { $p->prepare('DELETE FROM squad_cache WHERE su = ?')->execute([$short]); }
    catch (Throwable $e) {}
}

function squadconf_user_state($short) {
    static $memo = [];
    $short = trim((string) $short);
    if ($short === '') return ['squads' => [], 'status' => ''];
    if (isset($memo[$short])) return $memo[$short];
    $none = ['squads' => [], 'status' => ''];
    if (remnawave_url() === '' || remnawave_token() === '') return $none;
    squadconf_cache_ensure();
    if (!($p = db())) return $none;
    $now = time();
    $row = null;
    try {
        $st = $p->prepare('SELECT squads, st, ts FROM squad_cache WHERE su = ?');
        $st->execute([$short]);
        $row = $st->fetch();
    } catch (Throwable $e) {}
    $from_row = function ($r) {
        $a = json_decode((string) ($r['squads'] ?? ''), true);
        return ['squads' => is_array($a) ? $a : [], 'status' => strtoupper(trim((string) ($r['st'] ?? '')))];
    };
    if ($row && ($now - (int) $row['ts'] < 300)) return $memo[$short] = $from_row($row);
    $e = '';
    $u = remnawave_get_user_by_short($short, $e);
    if (!is_array($u)) return $memo[$short] = ($row ? $from_row($row) : $none);
    $squads = function_exists('grace_squads_from_user') ? grace_squads_from_user($u) : [];
    $status = strtoupper(trim((string) ($u['status'] ?? '')));
    try {
        if (db_driver() === 'mysql') {
            $st = $p->prepare('INSERT INTO squad_cache (su, squads, st, ts) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE squads = VALUES(squads), st = VALUES(st), ts = VALUES(ts)');
        } else {
            $st = $p->prepare('INSERT INTO squad_cache (su, squads, st, ts) VALUES (?, ?, ?, ?) ON CONFLICT(su) DO UPDATE SET squads = excluded.squads, st = excluded.st, ts = excluded.ts');
        }
        $st->execute([$short, json_encode(array_values($squads)), $status, $now]);
    } catch (Throwable $e2) {}
    return $memo[$short] = ['squads' => $squads, 'status' => $status];
}

function squadconf_user_squads($short) {
    return squadconf_user_state($short)['squads'];
}

// Панель не шлёт вебхук мгновенно (а при упоре в лимит устройств не меняет статус
// вообще), поэтому перед подмешиванием конфигов статус сверяем с самой панелью.
// Ответ уже кэшируется в squad_cache на 300 с и сбрасывается вебхуком, так что
// лишних запросов к API это не добавляет. Панель недоступна -> статус пустой и
// прежнее поведение сохраняется.
function squadconf_user_inactive($short) {
    if (trim((string) $short) === '') return false;
    if (!squadconf_any() && !addsub_enabled()) return false;
    $st = squadconf_user_state($short)['status'];
    return $st !== '' && $st !== 'ACTIVE';
}

function squadconf_inject_clash($body, array $configs) {
    // Тело должно быть YAML-подпиской Clash, а не base64/JSON/страницей ошибки —
    // иначе не дописываем ничего, чтобы не испортить ответ.
    $s = ltrim((string) $body);
    if ($s === '' || $s[0] === '{' || $s[0] === '[') return $body;
    if (!preg_match('~(^|\n)\s*(proxies|proxy-groups|proxy-providers|mixed-port|port|mode)\s*:~i', $s)) return $body;
    [$exBlocks, $exNames] = addsub_clash_extract($body);
    $types = array_merge(squadconf_uri_protos(), ['wireguard', 'amneziawg']);
    $cands = squadconf_candidates($configs, $exNames, $types, 'squadconf_default_name');
    $built = [];
    foreach ($cands as $cd) {
        $blk = squadconf_to_clash($cd['pn'], $cd['name']);
        if ($blk === '') continue; // ядро не собирает этот транспорт — пропускаем формат
        $built[] = ['name' => $cd['name'], 'pos' => squadconf_position_of($cd['c']), 'payload' => $blk];
    }
    if (!$built) return $body;
    $items = squadconf_plan_order($exNames, $built);
    $ordered = []; $newNames = [];
    foreach ($items as $it) {
        if ($it['kind'] === 'existing') { $ordered[] = $exBlocks[$it['orig']]; }
        else { $ordered[] = $it['payload']; $newNames[] = $it['name']; }
    }
    return squadconf_clash_place($body, $ordered, $newNames);
}

// Заменяет секцию top-level `proxies:` телом из $ordered (существующие + новые
// блоки в спланированном порядке) и дописывает $newNames в списки proxy-групп.
// Существующие блоки берутся as-is (addsub_clash_extract), их формат сохраняется.
function squadconf_clash_place($body, array $ordered, array $newNames) {
    $nl = (strpos($body, "\r\n") !== false) ? "\r\n" : "\n";
    $lines = preg_split('/\r\n|\r|\n/', (string) $body);
    $out = [];
    $done = false;              // top-level proxies уже перестроили
    $skip_list = false;         // проходим старые элементы top-level списка (выкидываем)
    $emit_ordered = function () use (&$out, $ordered) {
        $out[] = 'proxies:';
        foreach ($ordered as $blk) foreach (explode("\n", (string) $blk) as $bl) $out[] = $bl;
    };
    // Первый проход: перестроить top-level proxies.
    foreach ($lines as $line) {
        if ($skip_list) {
            // элемент/продолжение списка (с отступом) — пропускаем; иначе список кончился
            if ($line === '' || preg_match('/^\s+\S/', $line) || preg_match('/^\s*-\s/', $line)) continue;
            $skip_list = false;
        }
        if (!$done && preg_match('/^proxies:\s*\[\s*\]\s*$/', $line)) { $emit_ordered(); $done = true; continue; }
        if (!$done && preg_match('/^proxies:\s*$/', $line)) { $emit_ordered(); $done = true; $skip_list = true; continue; }
        $out[] = $line;
    }
    if (!$done) { // top-level proxies не было — добавляем секцию в конец
        if ($out && end($out) !== '') $out[] = '';
        $emit_ordered();
    }
    $body2 = implode($nl, $out);
    // Второй проход: дописать имена новых узлов в списки proxy-групп (порядок не важен).
    if ($newNames) $body2 = squadconf_clash_add_group_members($body2, $newNames);
    return $body2;
}

// Дописывает имена в каждый ВЛОЖЕННЫЙ `proxies:` (списки proxy-групп), не трогая
// top-level proxies (он уже перестроен). Отступ берётся у существующих элементов.
function squadconf_clash_add_group_members($body, array $names) {
    $nl = (strpos($body, "\r\n") !== false) ? "\r\n" : "\n";
    $lines = preg_split('/\r\n|\r|\n/', (string) $body);
    $out = [];
    $in_list = false; $item_indent = null; $key_indent = 0;
    foreach ($lines as $line) {
        if ($in_list) {
            if (preg_match('/^(\s*)-\s/', $line, $mm) && strlen($mm[1]) >= $key_indent) {
                if ($item_indent === null) $item_indent = $mm[1];
                $out[] = $line; continue;
            }
            $ind = ($item_indent !== null) ? $item_indent : str_repeat(' ', $key_indent + 2);
            foreach ($names as $n) $out[] = $ind . '- ' . yaml_q($n);
            $in_list = false;
        }
        if (preg_match('/^(\s+)proxies:\s*$/', $line, $m)) { // только вложенные (с отступом)
            $out[] = $line; $in_list = true; $item_indent = null; $key_indent = strlen($m[1]); continue;
        }
        $out[] = $line;
    }
    if ($in_list) {
        $ind = ($item_indent !== null) ? $item_indent : str_repeat(' ', $key_indent + 2);
        foreach ($names as $n) $out[] = $ind . '- ' . yaml_q($n);
    }
    return implode($nl, $out);
}

function squadconf_wgkey($v) { return str_replace('=', '%3D', (string) $v); }

function wg_to_uri_wg($parsed, $name) {
    if (!is_array($parsed) || !in_array($parsed['type'] ?? '', ['wireguard', 'amneziawg'], true)) return '';
    $if = $parsed['iface']; $pe = $parsed['peer'];
    $ep = (string) ($pe['Endpoint'] ?? '');
    $host = $ep; $port = '';
    if (($pos = strrpos($ep, ':')) !== false) { $host = substr($ep, 0, $pos); $port = substr($ep, $pos + 1); }
    $host = trim($host, '[]');
    $pk = (string) ($if['PrivateKey'] ?? '');
    if ($pk === '' || $host === '' || $port === '' || empty($pe['PublicKey'])) return '';
    $q = ['private_key=' . squadconf_wgkey($pk)];
    $addr = str_replace(' ', '', (string) ($if['Address'] ?? ''));
    if ($addr !== '') $q[] = 'local_address=' . $addr;
    if (($parsed['type'] ?? '') === 'amneziawg') {
        $q[] = 'enable_amnezia=true';
        foreach (['Jc' => 'jc', 'Jmin' => 'jmin', 'Jmax' => 'jmax', 'S1' => 's1', 'S2' => 's2', 'S3' => 's3', 'S4' => 's4'] as $src => $dst) {
            if (isset($if[$src]) && $if[$src] !== '') $q[] = $dst . '=' . (int) $if[$src];
        }
        foreach (['H1' => 'h1', 'H2' => 'h2', 'H3' => 'h3', 'H4' => 'h4'] as $src => $dst) {
            if (isset($if[$src]) && $if[$src] !== '') $q[] = $dst . '=' . $if[$src];
        }
        foreach (['I1' => 'i1', 'I2' => 'i2', 'I3' => 'i3', 'I4' => 'i4', 'I5' => 'i5'] as $src => $dst) {
            if (!empty($if[$src])) $q[] = $dst . '=' . rawurlencode((string) $if[$src]);
        }
    }
    $q[] = 'public_key=' . squadconf_wgkey((string) $pe['PublicKey']);
    if (!empty($pe['PresharedKey'])) $q[] = 'pre_shared_key=' . squadconf_wgkey((string) $pe['PresharedKey']);
    if (!empty($if['MTU'])) $q[] = 'mtu=' . (int) $if['MTU'];
    if (!empty($pe['PersistentKeepalive'])) $q[] = 'persistent_keepalive_interval=' . (int) $pe['PersistentKeepalive'];
    return 'wg://' . $host . ':' . (int) $port . '?' . implode('&', $q) . '#' . rawurlencode($name);
}

// Единый справочник клиентов — источник и для правил выдачи (core/no_awg/no_wg),
// и для каталога «Правил ответа» (rk = ключ, rg = группа в UI). Добавлять клиента здесь одним местом.
function client_catalog() {
    return [
        ['ua' => 'mihomo',       'label' => 'Clash Meta / Mihomo', 'core' => 'mihomo',   'no_awg' => 0, 'no_wg' => 0, 'rk' => 'clashmeta',    'rg' => 'other'],
        ['ua' => 'clash',        'label' => 'Clash',               'core' => 'mihomo',   'no_awg' => 0, 'no_wg' => 0],
        ['ua' => 'verge',        'label' => 'Clash Verge',         'core' => 'mihomo',   'no_awg' => 0, 'no_wg' => 0, 'rk' => 'clashverge',   'rg' => 'other'],
        ['ua' => 'flclash',      'label' => 'FlClash',             'core' => 'mihomo',   'no_awg' => 0, 'no_wg' => 0, 'rk' => 'flclash',      'rg' => 'other'],
        ['ua' => 'flclashx',     'label' => 'FlClashX',            'core' => 'mihomo',   'no_awg' => 0, 'no_wg' => 0, 'rk' => 'flclashx',     'rg' => 'popular'],
        ['ua' => 'koala',        'label' => 'Koala Clash',         'core' => 'mihomo',   'no_awg' => 0, 'no_wg' => 0, 'rk' => 'koala',        'rg' => 'popular'],
        ['ua' => 'stash',        'label' => 'Stash',               'core' => 'mihomo',   'no_awg' => 0, 'no_wg' => 0, 'rk' => 'stash',        'rg' => 'other'],
        ['ua' => 'throne',       'label' => 'Throne',              'core' => 'sing-box', 'no_awg' => 0, 'no_wg' => 0],
        ['ua' => 'happ',         'label' => 'Happ',                'core' => 'xray',     'no_awg' => 1, 'no_wg' => 0, 'rk' => 'happ',         'rg' => 'popular'],
        ['ua' => 'incy',         'label' => 'INCY',                'core' => 'xray',     'no_awg' => 1, 'no_wg' => 0, 'rk' => 'incy',         'rg' => 'popular'],
        ['ua' => 'v2rayng',      'label' => 'v2rayNG',             'core' => 'xray',     'no_awg' => 1, 'no_wg' => 0, 'rk' => 'v2rayng',      'rg' => 'other'],
        ['ua' => 'v2rayn',       'label' => 'v2rayN',              'core' => 'xray',     'no_awg' => 1, 'no_wg' => 0, 'rk' => 'v2rayn',       'rg' => 'other'],
        ['ua' => 'v2raytun',     'label' => 'v2RayTun',            'core' => 'xray',     'no_awg' => 1, 'no_wg' => 0],
        ['ua' => 'v2box',        'label' => 'V2Box',               'core' => 'xray',     'no_awg' => 1, 'no_wg' => 0],
        ['ua' => 'foxray',       'label' => 'FoXray',              'core' => 'xray',     'no_awg' => 1, 'no_wg' => 0],
        ['ua' => 'shadowrocket', 'label' => 'Shadowrocket',        'core' => 'xray',     'no_awg' => 1, 'no_wg' => 0, 'rk' => 'shadowrocket', 'rg' => 'other'],
        ['ua' => 'sing-box',     'label' => 'sing-box',            'core' => 'sing-box', 'no_awg' => 1, 'no_wg' => 0, 'rk' => 'singbox',      'rg' => 'other'],
        ['ua' => 'nekobox',      'label' => 'NekoBox',             'core' => 'sing-box', 'no_awg' => 1, 'no_wg' => 0, 'rk' => 'nekobox',      'rg' => 'other'],
        ['ua' => 'nekoray',      'label' => 'NekoRay',             'core' => 'sing-box', 'no_awg' => 1, 'no_wg' => 0],
        ['ua' => 'hiddify',      'label' => 'Hiddify',             'core' => 'sing-box', 'no_awg' => 1, 'no_wg' => 0, 'rk' => 'hiddify',      'rg' => 'other'],
        ['ua' => 'streisand',    'label' => 'Streisand',           'core' => 'sing-box', 'no_awg' => 1, 'no_wg' => 0, 'rk' => 'streisand',    'rg' => 'other'],
        ['ua' => 'karing',       'label' => 'Karing',              'core' => 'sing-box', 'no_awg' => 1, 'no_wg' => 0, 'rk' => 'karing',       'rg' => 'other'],
    ];
}

function squadconf_ua_rules_catalog() {
    $out = [];
    foreach (client_catalog() as $c) {
        $out[] = ['ua' => $c['ua'], 'label' => $c['label'], 'core' => $c['core'], 'no_awg' => $c['no_awg'], 'no_wg' => $c['no_wg']];
    }
    return $out;
}

function squadconf_ua_rules() {
    $j = (string) setting('ua_delivery_rules', '');
    if ($j !== '') {
        $a = json_decode($j, true);
        if (is_array($a)) {
            $out = [];
            foreach ($a as $r) {
                if (!is_array($r)) continue;
                $ua = strtolower(trim((string) ($r['ua'] ?? '')));
                if ($ua === '') continue;
                $out[] = [
                    'ua'     => $ua,
                    'label'  => trim((string) ($r['label'] ?? $ua)),
                    'core'   => (string) ($r['core'] ?? ''),
                    'no_awg' => !empty($r['no_awg']) ? 1 : 0,
                    'no_wg'  => !empty($r['no_wg']) ? 1 : 0,
                ];
            }
            return $out;
        }
    }
    return squadconf_ua_rules_catalog();
}

function squadconf_ua_flags() {
    static $cache = null;
    if ($cache !== null) return $cache;
    $ua = strtolower((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
    $no_awg = false; $no_wg = false;
    if ($ua !== '') {
        foreach (squadconf_ua_rules() as $r) {
            $needle = (string) $r['ua'];
            if ($needle !== '' && strpos($ua, $needle) !== false) {
                if (!empty($r['no_awg'])) $no_awg = true;
                if (!empty($r['no_wg'])) $no_wg = true;
            }
        }
    }
    return $cache = ['no_awg' => $no_awg, 'no_wg' => $no_wg];
}

function squadconf_ua_no_amnezia() { $f = squadconf_ua_flags(); return $f['no_awg']; }

function squadconf_ua_no_wg() { $f = squadconf_ua_flags(); return $f['no_wg']; }

// Имя (remark) из URI-строки base64-подписки — часть после последнего '#'.
function squadconf_uri_name($line) {
    $h = strpos((string) $line, '#');
    return $h === false ? '' : rawurldecode(substr((string) $line, $h + 1));
}

function squadconf_inject_base64($body, array $configs) {
    $decoded = base64_decode(trim((string) $body), true);
    if ($decoded === false || $decoded === '') return $body;
    $no_amnezia = squadconf_ua_no_amnezia();
    if ($no_amnezia) {
        $scheme = 'wireguard';
    } else {
        $scheme = (strpos($decoded, 'wireguard://') !== false && strpos($decoded, 'wg://') === false) ? 'wireguard' : 'wg';
    }
    $sep = (strpos($decoded, "\r\n") !== false) ? "\r\n" : "\n";
    // Существующие узлы тела — непустые строки-ссылки, в исходном порядке.
    $ex_lines = []; $ex_names = [];
    foreach (preg_split('/\r\n|\r|\n/', $decoded) as $ln) {
        $ln = rtrim($ln);
        if ($ln === '' || strpos($ln, '://') === false) continue;
        $ex_lines[] = $ln; $ex_names[] = squadconf_uri_name($ln);
    }
    $types = array_merge(squadconf_uri_protos(), ['wireguard', 'amneziawg']);
    $cands = squadconf_candidates($configs, $ex_names, $types, 'squadconf_default_name');
    $built = [];
    foreach ($cands as $cd) {
        $t = $cd['pn']['type'] ?? '';
        if (squadconf_is_uri_proto($t)) {
            $u = vless_relabel_uri((string) $cd['c']['raw'], $cd['name']); // relabel скорректирует #remark у любой схемы
        } elseif (in_array($t, ['wireguard', 'amneziawg'], true)) {
            if ($scheme === 'wg') { if (!in_array($t, ['wireguard', 'amneziawg'], true)) continue; }
            elseif ($t !== 'wireguard') continue;
            $u = ($scheme === 'wg') ? wg_to_uri_wg($cd['pn'], $cd['name']) : wg_to_uri($cd['pn'], $cd['name']);
        } else { continue; }
        if ($u === '') continue;
        $built[] = ['name' => $cd['name'], 'pos' => squadconf_position_of($cd['c']), 'payload' => $u];
    }
    if (!$built) return $body;
    $items = squadconf_plan_order($ex_names, $built);
    $ordered = [];
    foreach ($items as $it) $ordered[] = ($it['kind'] === 'existing') ? $ex_lines[$it['orig']] : $it['payload'];
    return base64_encode(implode($sep, $ordered));
}

function squadconf_singbox_endpoint($parsed, $tag) {
    if (!is_array($parsed) || ($parsed['type'] ?? '') !== 'wireguard') return null;
    $if = $parsed['iface']; $pe = $parsed['peer'];
    $ep = (string) ($pe['Endpoint'] ?? '');
    if ($ep === '' || empty($if['PrivateKey']) || empty($pe['PublicKey'])) return null;
    $host = $ep; $port = '';
    if (($pos = strrpos($ep, ':')) !== false) { $host = substr($ep, 0, $pos); $port = substr($ep, $pos + 1); }
    $host = trim($host, '[]');
    if ($host === '' || $port === '') return null;
    $addr = array_values(array_filter(array_map('trim', explode(',', (string) ($if['Address'] ?? '')))));
    $allowed = array_values(array_filter(array_map('trim', explode(',', (string) ($pe['AllowedIPs'] ?? '0.0.0.0/0, ::/0')))));
    $peer = [
        'address'     => $host,
        'port'        => (int) $port,
        'public_key'  => (string) $pe['PublicKey'],
        'allowed_ips' => $allowed ?: ['0.0.0.0/0', '::/0'],
    ];
    if (!empty($pe['PresharedKey'])) $peer['pre_shared_key'] = (string) $pe['PresharedKey'];
    if (!empty($pe['PersistentKeepalive'])) $peer['persistent_keepalive_interval'] = (int) $pe['PersistentKeepalive'];
    $o = [
        'type'        => 'wireguard',
        'tag'         => ($tag !== '' ? $tag : 'wg-squad'),
        'address'     => $addr ?: ['10.0.0.2/32'],
        'private_key' => (string) $if['PrivateKey'],
        'peers'       => [$peer],
    ];
    if (!empty($if['MTU'])) $o['mtu'] = (int) $if['MTU'];
    return $o;
}

function squadconf_is_singbox($obj) {
    if (!is_array($obj) || !isset($obj['outbounds']) || !is_array($obj['outbounds'])) return false;
    if (isset($obj['routing']) || isset($obj['policy']) || isset($obj['stats']) || isset($obj['inbounds'][0]['protocol'])) return false;
    return isset($obj['route']) || isset($obj['endpoints']) || isset($obj['experimental']) || isset($obj['log']['level']) || isset($obj['inbounds'][0]['type']);
}

function squadconf_inject_singbox($body, array $configs) {
    if (!squadconf_is_singbox(json_decode((string) $body, true))) return $body;
    $obj = json_decode((string) $body);
    if (!is_object($obj) || !isset($obj->outbounds) || !is_array($obj->outbounds)) return $body;
    // Все занятые теги (узлы + селекторы + endpoints) — для дедупа по имени.
    $all_tags = [];
    foreach ($obj->outbounds as $o) if (is_object($o) && isset($o->tag)) $all_tags[] = (string) $o->tag;
    if (isset($obj->endpoints) && is_array($obj->endpoints)) {
        foreach ($obj->endpoints as $e) if (is_object($e) && isset($e->tag)) $all_tags[] = (string) $e->tag;
    }
    // Порядок узлов-аутбаундов (для anchor'а позиции) и индекс первого узла.
    $node_names = []; $first_node = null;
    foreach ($obj->outbounds as $idx => $o) {
        if (addsub_singbox_is_node($o)) { if ($first_node === null) $first_node = $idx; $node_names[] = (string) ($o->tag ?? ''); }
    }
    $types = array_merge(squadconf_uri_protos(), ['wireguard']);
    $cands = squadconf_candidates($configs, $all_tags, $types, 'squadconf_default_name');
    $out_built = [];  // узлы-аутбаунды: ['name','pos','payload'=>object]
    $added = [];
    foreach ($cands as $cd) {
        $t = $cd['pn']['type'] ?? '';
        if ($t === 'wireguard') {
            $ep = squadconf_singbox_endpoint($cd['pn'], $cd['name']);
            if (!$ep) continue;
            if (!isset($obj->endpoints) || !is_array($obj->endpoints)) $obj->endpoints = [];
            $obj->endpoints[] = $ep;                 // wg-endpoints — отдельный массив, дописываем в конец
            $added[] = $cd['name'];
            continue;
        }
        $ob = squadconf_to_singbox_node($cd['pn'], $cd['name']);
        if (!$ob) continue;                          // ядро не собирает этот транспорт
        $out_built[] = ['name' => $cd['name'], 'pos' => squadconf_position_of($cd['c']), 'payload' => $ob];
        $added[] = $cd['name'];
    }
    if (!$added) return $body;
    // Вставка узлов-аутбаундов на спланированные позиции среди существующих узлов.
    if ($out_built) {
        $items = squadconf_plan_order($node_names, $out_built);
        $node_seq = [];
        $orig_nodes = [];
        foreach ($obj->outbounds as $o) if (addsub_singbox_is_node($o)) $orig_nodes[] = $o;
        foreach ($items as $it) $node_seq[] = ($it['kind'] === 'existing') ? $orig_nodes[$it['orig']] : $it['payload'];
        // Пересобрать outbounds: не-узлы на местах, блок узлов — на позиции первого узла.
        $rebuilt = []; $placed = false;
        foreach ($obj->outbounds as $idx => $o) {
            if (addsub_singbox_is_node($o)) {
                if (!$placed) { foreach ($node_seq as $ns) $rebuilt[] = $ns; $placed = true; }
                continue; // старые узлы выкидываем — они уже в node_seq
            }
            $rebuilt[] = $o;
        }
        if (!$placed) foreach ($node_seq as $ns) $rebuilt[] = $ns; // узлов не было — в конец
        $obj->outbounds = $rebuilt;
    }
    // Добавить новые имена в селекторы/urltest.
    foreach ($obj->outbounds as $o) {
        if (is_object($o) && in_array(($o->type ?? ''), ['selector', 'urltest'], true) && isset($o->outbounds) && is_array($o->outbounds)) {
            foreach ($added as $nm) if (!in_array($nm, $o->outbounds, true)) $o->outbounds[] = $nm;
        }
    }
    $enc = json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return $enc === false ? $body : $enc;
}

function squadconf_xray_json_enabled() { return setting('squad_xray_json_inject', '0') === '1'; }

function squadconf_xray_tpl_name() {
    $n = trim((string) setting('squad_xray_tpl_name', ''));
    return $n === '' ? 'Default' : $n;
}

function squadconf_xray_tpl_ttl() { return 600; }

function squadconf_xray_tpl_cached() {
    $c = json_decode((string) setting('sqcfg_xtpl', ''), true);
    return is_array($c) ? $c : [];
}

function squadconf_xray_tpl_is_uuid($k) {
    return (bool) preg_match('/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/', trim((string) $k));
}

// Принимает ИМЯ шаблона (глобальная настройка) ИЛИ его uuid (per-host выбор).
function squadconf_xray_tpl_fetch($nameOrUuid, &$error = '') {
    $error = '';
    if (remnawave_url() === '' || remnawave_token() === '') {
        $error = 'Не заданы URL панели или API-токен';
        return null;
    }
    $e = '';
    if (squadconf_xray_tpl_is_uuid($nameOrUuid)) {
        $tpl = remnawave_sub_template_json(trim((string) $nameOrUuid), $e);
        if (!is_array($tpl)) { $error = $e ?: 'Пустое тело шаблона'; return null; }
        return $tpl;
    }
    $list = remnawave_sub_templates($e);
    if ($e !== '') { $error = $e; return null; }
    $uuid = '';
    foreach ($list as $t) {
        if (strcasecmp((string) $t['type'], 'XRAY_JSON') !== 0) continue;
        if (strcasecmp(trim((string) $t['name']), (string) $nameOrUuid) === 0) { $uuid = $t['uuid']; break; }
    }
    if ($uuid === '') { $error = 'Шаблон xray-json «' . $nameOrUuid . '» в панели не найден'; return null; }
    $tpl = remnawave_sub_template_json($uuid, $e);
    if (!is_array($tpl)) { $error = $e ?: 'Пустое тело шаблона'; return null; }
    return $tpl;
}

// Форк Quazar: per-host скелет xray-json по ключу (uuid шаблона из строки конфига).
// Пустой ключ → глобальный шаблон (squadconf_xray_tpl). Кэш — свой слот на ключ,
// с тем же TTL и кэшированием отрицательного результата, что у глобального.
function squadconf_xray_tpl_by($key, $maxAge = null, &$error = '') {
    $error = '';
    $key = trim((string) $key);
    if ($key === '') return squadconf_xray_tpl($maxAge, $error);
    if ($maxAge === null) $maxAge = squadconf_xray_tpl_ttl();
    $slot = 'sqcfg_xtpl_' . md5($key);
    $now = time();
    $c = json_decode((string) setting($slot, ''), true);
    if (is_array($c) && ($c['key'] ?? '') === $key && (int) ($c['ts'] ?? 0) > 0 && ($now - (int) $c['ts']) <= $maxAge) {
        $error = (string) ($c['err'] ?? '');
        $tpl = $c['tpl'] ?? null;
        return (is_array($tpl) && $tpl) ? $tpl : null;
    }
    $tpl = squadconf_xray_tpl_fetch($key, $error);
    set_setting($slot, json_encode(
        ['key' => $key, 'ts' => $now, 'err' => $error, 'tpl' => $tpl],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    ));
    return $tpl;
}

// Скелет для доп. конфигов берётся из шаблона панели, а не из отрендеренного
// профиля: у профиля свой шаблон хоста (clientOverrides.xrayJsonTemplate), и
// первый в списке хост навязывал доп. конфигам чужие правила маршрутизации.
// Отрицательный результат кэшируется наравне с удачным — иначе панель без
// нужных прав токена опрашивалась бы на каждый запрос подписки.
function squadconf_xray_tpl($maxAge = null, &$error = '') {
    $error = '';
    if ($maxAge === null) $maxAge = squadconf_xray_tpl_ttl();
    $name = squadconf_xray_tpl_name();
    $now = time();
    $c = squadconf_xray_tpl_cached();
    if (($c['name'] ?? '') === $name && (int) ($c['ts'] ?? 0) > 0 && ($now - (int) $c['ts']) <= $maxAge) {
        $error = (string) ($c['err'] ?? '');
        $tpl = $c['tpl'] ?? null;
        return (is_array($tpl) && $tpl) ? $tpl : null;
    }
    $tpl = squadconf_xray_tpl_fetch($name, $error);
    set_setting('sqcfg_xtpl', json_encode(
        ['name' => $name, 'ts' => $now, 'err' => $error, 'tpl' => $tpl],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    ));
    return $tpl;
}

function squadconf_xray_tpl_drop() { set_setting('sqcfg_xtpl', ''); }

function conf_set_param($raw, $section, $key, $value) {
    $section = strtolower($section);
    $lines = preg_split('/\r\n|\r|\n/', (string) $raw);
    $cur = ''; $done = false; $out = [];
    foreach ($lines as $ln) {
        if (preg_match('/^\s*\[([A-Za-z]+)\]/', $ln, $m)) $cur = strtolower($m[1]);
        if (!$done && $cur === $section && preg_match('/^\s*' . preg_quote($key, '/') . '\s*=/i', $ln)) {
            if ($value !== '') $out[] = $key . ' = ' . $value;
            $done = true;
            continue;
        }
        $out[] = $ln;
    }
    if (!$done && $value !== '') {
        $res = []; $ins = false;
        foreach ($out as $ln) {
            $res[] = $ln;
            if (!$ins && preg_match('/^\s*\[([A-Za-z]+)\]/', $ln, $m) && strtolower($m[1]) === $section) {
                $res[] = $key . ' = ' . $value; $ins = true;
            }
        }
        $out = $res;
    }
    return implode("\n", $out);
}

function squadconf_supported_types($body, $format) {
    $f = squadconf_ua_flags();
    $wg_ok = empty($f['no_wg']);
    $awg_ok = empty($f['no_awg']);
    // Определяем целевое ядро, чтобы отобрать URI-протоколы по матрице.
    if ($format === 'clash') {
        $core = 'clash';
    } else {
        $trim = ltrim((string) $body);
        $is_json = !($trim === '' || ($trim[0] !== '[' && $trim[0] !== '{'));
        if (!$is_json) $core = 'base64';
        else $core = squadconf_is_singbox(json_decode((string) $body, true)) ? 'singbox' : 'xray';
    }
    $t = [];
    foreach (squadconf_uri_protos() as $p) if (squadconf_proto_core_ok($p, $core)) $t[] = $p;
    if ($format === 'clash') {
        if ($wg_ok) $t[] = 'wireguard';
        if ($awg_ok) $t[] = 'amneziawg';
        return $t;
    }
    if ($wg_ok) $t[] = 'wireguard';
    if ($core === 'base64' && $awg_ok) {
        // AmneziaWG уходит клиенту только когда отдаётся схема wg:// (она несёт оба типа).
        // Если панель вернула wireguard:// без wg://, клиент получит только wireguard,
        // поэтому амнезию не бронируем — иначе адрес пула занимается впустую.
        $decoded = base64_decode(trim((string) $body), true);
        $scheme = (is_string($decoded) && strpos($decoded, 'wireguard://') !== false && strpos($decoded, 'wg://') === false) ? 'wireguard' : 'wg';
        if ($scheme === 'wg') $t[] = 'amneziawg';
    }
    return $t;
}

function squadconf_inject($body, $format, array $configs) {
    if (!$configs) return $body;
    $f = squadconf_ua_flags();
    if (!empty($f['no_wg']) || !empty($f['no_awg'])) {
        $configs = array_values(array_filter($configs, function ($c) use ($f) {
            $pn = json_decode((string) ($c['parsed'] ?? ''), true);
            $t = is_array($pn) ? ($pn['type'] ?? '') : '';
            if (!empty($f['no_wg']) && in_array($t, ['wireguard', 'amneziawg'], true)) return false;
            if (!empty($f['no_awg']) && $t === 'amneziawg') return false;
            return true;
        }));
        if (!$configs) return $body;
    }
    try {
        if ($format === 'clash') return squadconf_inject_clash($body, $configs);
        $trim = ltrim((string) $body);
        if ($trim === '' || ($trim[0] !== '[' && $trim[0] !== '{')) return squadconf_inject_base64($body, $configs);
        $obj = json_decode($body, true);
        if (squadconf_is_singbox($obj)) return squadconf_inject_singbox($body, $configs);
        if (squadconf_xray_json_enabled()) return squadconf_inject_xray_json($body, $configs);
        return $body;
    } catch (Throwable $e) { error_log('submw squadconf inject: ' . $e->getMessage()); return $body; }
}

function xray_wg_outbound($parsed, $tag) {
    if (!is_array($parsed) || ($parsed['type'] ?? '') !== 'wireguard') return null;
    $if = $parsed['iface']; $pe = $parsed['peer'];
    $ep = (string) ($pe['Endpoint'] ?? '');
    if ($ep === '' || empty($if['PrivateKey']) || empty($pe['PublicKey'])) return null;
    $addr = array_values(array_filter(array_map('trim', explode(',', (string) ($if['Address'] ?? '')))));
    $allowed = array_values(array_filter(array_map('trim', explode(',', (string) ($pe['AllowedIPs'] ?? '0.0.0.0/0, ::/0')))));
    $peer = [
        'publicKey'  => (string) $pe['PublicKey'],
        'endpoint'   => $ep,
        'allowedIPs' => $allowed ?: ['0.0.0.0/0', '::/0'],
    ];
    if (!empty($pe['PresharedKey'])) $peer['preSharedKey'] = (string) $pe['PresharedKey'];
    if (!empty($pe['PersistentKeepalive'])) $peer['keepAlive'] = (int) $pe['PersistentKeepalive'];
    $settings = [
        'secretKey' => (string) $if['PrivateKey'],
        'address'   => $addr ?: ['10.0.0.2/32'],
        'peers'     => [$peer],
        'noKernelTun' => true,
    ];
    if (!empty($if['MTU'])) $settings['mtu'] = (int) $if['MTU'];
    $o = ['protocol' => 'wireguard', 'settings' => $settings];
    if ($tag !== '') $o['tag'] = $tag;
    return $o;
}

function xray_outbound_any($pn, $tag) {
    return squadconf_to_xray($pn, $tag); // vless/trojan/ss/… + wireguard через диспетчер
}

function xray_tpl_make_single($el, $proxy) {
    $kept = [];
    if (isset($el->outbounds) && is_array($el->outbounds)) {
        foreach ($el->outbounds as $ob) {
            if (is_object($ob) && !in_array((string) ($ob->protocol ?? ''), ['freedom', 'blackhole', 'dns'], true)) continue;
            $kept[] = $ob;
        }
    }
    array_unshift($kept, $proxy);
    $el->outbounds = $kept;
    // remnawave — инструкция панели по сборке профиля, в готовом конфиге ей
    // делать нечего; meta описывает хост, с которого снят скелет, и к доп.
    // конфигу отношения не имеет.
    unset($el->observatory, $el->burstObservatory, $el->remnawave, $el->meta);
    if (isset($el->routing) && is_object($el->routing)) {
        unset($el->routing->balancers);
        if (isset($el->routing->rules) && is_array($el->routing->rules)) {
            foreach ($el->routing->rules as $r) {
                if (is_object($r) && isset($r->balancerTag)) { unset($r->balancerTag); $r->outboundTag = 'proxy'; }
            }
        }
    }
}

// Форк Quazar (R3): собрать элемент-БАЛАНСЕР из скелета шаблона + N member-аутбаундов.
// В отличие от make_single: СОХРАНЯЕТ routing.balancers (или синтезирует) и
// observatory/burstObservatory (нужны xray для замера латентности members). Все
// members получают тег с префиксом $prefix ('proxy'), selector балансера — тот же
// префикс, поэтому members попадают в балансер автоматически.
function xray_tpl_make_balancer($el, array $members, $prefix = 'proxy') {
    $term = [];
    if (isset($el->outbounds) && is_array($el->outbounds)) {
        foreach ($el->outbounds as $ob) {
            if (is_object($ob) && in_array((string) ($ob->protocol ?? ''), ['freedom', 'blackhole', 'dns'], true)) $term[] = $ob;
        }
    }
    $el->outbounds = array_merge(array_values($members), $term); // members впереди, терминальные — в конце
    unset($el->remnawave, $el->meta); // observatory/burstObservatory сохраняем
    if (!isset($el->routing) || !is_object($el->routing)) $el->routing = (object) [];
    $balTag = 'balancer';
    $hasBal = false;
    if (isset($el->routing->balancers) && is_array($el->routing->balancers)) {
        foreach ($el->routing->balancers as $b) {
            if (is_object($b) && trim((string) ($b->tag ?? '')) !== '') { $balTag = (string) $b->tag; $b->selector = [$prefix]; $hasBal = true; break; }
        }
    }
    if (!$hasBal) $el->routing->balancers = [(object) ['tag' => $balTag, 'selector' => [$prefix], 'strategy' => (object) ['type' => 'random']]];
    $rules = (isset($el->routing->rules) && is_array($el->routing->rules)) ? $el->routing->rules : [];
    // Правила скелета, зашитые на outboundTag=proxy, переводим на балансер.
    foreach ($rules as $r) { if (is_object($r) && ($r->outboundTag ?? '') === 'proxy') { unset($r->outboundTag); $r->balancerTag = $balTag; } }
    $hasRule = false;
    foreach ($rules as $r) { if (is_object($r) && ($r->balancerTag ?? '') === $balTag) { $hasRule = true; break; } }
    if (!$hasRule) $rules[] = (object) ['type' => 'field', 'network' => 'tcp,udp', 'balancerTag' => $balTag];
    $el->routing->rules = $rules;
    // Нормализация: balancerTag на НЕсуществующий балансер (в шаблоне панели встречается
    // квирк, где outboundTag «direct» записан как balancerTag) → в outboundTag, иначе
    // xray-core отвергнет конфиг («balancer not found»).
    $defined = [];
    foreach ($el->routing->balancers as $b) if (is_object($b) && isset($b->tag)) $defined[(string) $b->tag] = true;
    foreach ($el->routing->rules as $r) {
        if (is_object($r) && isset($r->balancerTag) && !isset($defined[(string) $r->balancerTag])) {
            $r->outboundTag = (string) $r->balancerTag;
            unset($r->balancerTag);
        }
    }
}

// Форк Quazar (R3): по тегу-балансеру найти в панели «дисплей-хост» — хост с этим
// тегом, чей remark содержит плейсхолдер ({{…}}, напр. «Белые списки ↓ [еще {{TRAFFIC_LEFT}}]»),
// в отличие от реальных членов с фиксированным remark. Возвращает
// ['prefix'=>имя до ' ['] для матчинга элемента в подписке и эмита нового.
function squadconf_balancer_display($tag) {
    static $memo = [];
    $tag = trim((string) $tag);
    if ($tag === '') return ['prefix' => ''];
    if (isset($memo[$tag])) return $memo[$tag];
    // Кэш в settings (TTL 600с): без него /api/hosts дёргался бы на каждый запрос
    // подписки. Кэшируем и «не найдено» (prefix=''), чтобы не долбить панель зря.
    $ck = 'sqcfg_lbdisp_' . md5($tag);
    $cached = json_decode((string) setting($ck, ''), true);
    if (is_array($cached) && array_key_exists('prefix', $cached) && (time() - (int) ($cached['ts'] ?? 0) < 600)) {
        return $memo[$tag] = ['prefix' => (string) $cached['prefix'], 'tpl' => (string) ($cached['tpl'] ?? '')];
    }
    $prefix = ''; $tpl = '';
    try {
        if (remnawave_url() !== '' && remnawave_token() !== '') {
            $e = '';
            foreach (remnawave_hosts($e) as $h) {
                $tags = $h['tags'] ?? [];
                if (!is_array($tags) || !in_array($tag, $tags, true)) continue;
                $rm = (string) ($h['remark'] ?? '');
                if (strpos($rm, '{{') === false) continue; // дисплей-хост несёт плейсхолдер ({{TRAFFIC_LEFT}})
                $cut = ($p = strpos($rm, ' [')) !== false ? substr($rm, 0, $p) : preg_replace('/\s*\{\{.*$/s', '', $rm);
                $prefix = trim((string) $cut);
                $tpl = (string) ($h['xray_tpl_uuid'] ?? ''); // шаблон самого хоста-балансера = верный скелет
                break;
            }
        }
    } catch (Throwable $e) {}
    try { set_setting($ck, json_encode(['prefix' => $prefix, 'tpl' => $tpl, 'ts' => time()], JSON_UNESCAPED_UNICODE)); } catch (Throwable $e) {}
    return $memo[$tag] = ['prefix' => $prefix, 'tpl' => $tpl];
}

function squadconf_inject_xray_json($body, array $configs) {
    $obj = json_decode((string) $body);
    if (!is_array($obj) && !is_object($obj)) return $body;
    $types = array_merge(squadconf_uri_protos(), ['wireguard']);

    if (is_array($obj)) {
        // Массив конфигов (Happ). Каждый элемент — самостоятельный конфиг с remarks.
        foreach ($obj as $el) {
            if (!is_object($el) || !isset($el->outbounds) || !is_array($el->outbounds)) return $body;
        }
        $ex_names = [];
        foreach ($obj as $el) $ex_names[] = (string) ($el->remarks ?? '');
        $cands = squadconf_candidates($configs, $ex_names, $types, 'squadconf_default_name');
        // Фолбэк-шаблон (глобальный) — если у строки конфига свой шаблон не задан/не получен.
        $global_tpl = null;
        $gdef = squadconf_xray_tpl();
        if (is_array($gdef) && $gdef) $global_tpl = json_decode(json_encode($gdef));
        if (!is_object($global_tpl)) {
            foreach ($obj as $el) { if (is_object($el) && isset($el->outbounds) && is_array($el->outbounds)) { $global_tpl = $el; break; } }
        }
        $built = [];
        foreach ($cands as $cd) {
            $ob = xray_outbound_any($cd['pn'], 'proxy');
            if (!$ob) continue; // hy2/tuic и т.п. — xray их не собирает, пропускаем
            // per-host шаблон (п.5): uuid из строки конфига переопределяет глобальный.
            $tpl = null;
            $tk = squadconf_tpl_of($cd['c']);
            if ($tk !== '') { $t = squadconf_xray_tpl_by($tk); if (is_array($t) && $t) $tpl = json_decode(json_encode($t)); }
            if (!is_object($tpl)) $tpl = $global_tpl;
            if (!is_object($tpl)) continue;
            $el = json_decode(json_encode($tpl));
            xray_tpl_make_single($el, $ob);
            $el->remarks = $cd['name'];
            $sd = trim((string) ($cd['pn']['serverDescription'] ?? ''));
            if ($sd !== '') $el->meta = (object) ['serverDescription' => $sd]; // п.3: Happ serverDescription
            $built[] = ['name' => $cd['name'], 'pos' => squadconf_position_of($cd['c']), 'payload' => $el];
        }
        // Форк Quazar (R3): тег-балансер. Кандидаты с lb_tag ДОПОЛНИТЕЛЬНО (сверх своих
        // отдельных элементов выше — «N хостов + балансер») сводятся в один клиентский
        // балансер: либо дописываются members в уже присутствующий панельный элемент-
        // балансер («↓»), либо (если его в теле нет) эмитится новый из скелета шаблона.
        try {
            $groups = [];
            foreach ($cands as $cd) { $lt = squadconf_lbtag_of($cd['c']); if ($lt !== '') $groups[$lt][] = $cd; }
            foreach ($groups as $lt => $members) {
                $outs = [];
                foreach ($members as $cd) {
                    $mo = xray_outbound_any($cd['pn'], 'proxy_sq' . (int) ($cd['c']['id'] ?? 0));
                    if ($mo) $outs[] = $mo; // xray не собрал транспорт (напр. tuic) — пропускаем члена
                }
                if (!$outs) continue;
                $disp = squadconf_balancer_display($lt);
                $prefix = (string) ($disp['prefix'] ?? '');
                $dtpl = (string) ($disp['tpl'] ?? '');
                // 1) элемент-балансер уже в теле → дописываем members + расширяем selector.
                $target = null;
                if ($prefix !== '') {
                    $pn = squadconf_name_norm($prefix);
                    foreach ($obj as $el) {
                        if (!is_object($el)) continue;
                        $rn = squadconf_name_norm((string) ($el->remarks ?? ''));
                        if ($rn !== '' && strpos($rn, $pn) === 0) { $target = $el; break; }
                    }
                }
                if (is_object($target)) {
                    if (!isset($target->outbounds) || !is_array($target->outbounds)) $target->outbounds = [];
                    foreach ($outs as $mo) $target->outbounds[] = $mo;
                    if (isset($target->routing->balancers) && is_array($target->routing->balancers)) {
                        foreach ($target->routing->balancers as $b) {
                            if (!is_object($b)) continue;
                            $sel = (isset($b->selector) && is_array($b->selector)) ? $b->selector : [];
                            foreach ($outs as $mo) { $t = (string) ($mo['tag'] ?? ''); if ($t !== '' && !in_array($t, $sel, true)) $sel[] = $t; }
                            $b->selector = $sel;
                        }
                    }
                    continue;
                }
                // 2) «↓» в теле нет → эмитим новый элемент-балансер из скелета шаблона.
                // Приоритет скелета: шаблон самого хоста-балансера в панели (верная
                // «обход»-маршрутизация) → per-config xray_tpl → глобальный.
                $tpl = null;
                foreach ([$dtpl, squadconf_tpl_of($members[0]['c'])] as $tk) {
                    if (trim((string) $tk) === '') continue;
                    $t = squadconf_xray_tpl_by($tk);
                    if (is_array($t) && $t) { $tpl = json_decode(json_encode($t)); break; }
                }
                if (!is_object($tpl)) $tpl = $global_tpl;
                if (!is_object($tpl)) continue;
                $el = json_decode(json_encode($tpl));
                xray_tpl_make_balancer($el, $outs, 'proxy');
                $el->remarks = ($prefix !== '' ? $prefix : $lt);
                $built[] = ['name' => $el->remarks, 'pos' => ['mode' => 'end', 'anchor' => ''], 'payload' => $el];
            }
        } catch (Throwable $e) { error_log('submw squadconf balancer: ' . $e->getMessage()); }
        if (!$built) return $body;
        $items = squadconf_plan_order($ex_names, $built);
        $seqOut = [];
        foreach ($items as $it) $seqOut[] = ($it['kind'] === 'existing') ? $obj[$it['orig']] : $it['payload'];
        $obj = $seqOut;
    } else {
        // Одиночный конфиг: дедуп по tag, дописываем аутбаунды в конец.
        if (!isset($obj->outbounds) || !is_array($obj->outbounds)) return $body;
        $tags = [];
        foreach ($obj->outbounds as $o) if (is_object($o) && isset($o->tag)) $tags[] = (string) $o->tag;
        $cands = squadconf_candidates($configs, $tags, $types, 'squadconf_default_name');
        $any = false;
        foreach ($cands as $cd) { $ob = xray_outbound_any($cd['pn'], $cd['name']); if ($ob) { $obj->outbounds[] = $ob; $any = true; } }
        if (!$any) return $body;
    }
    $enc = json_encode($obj, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return $enc === false ? $body : $enc;
}

function clash_insert_proxies($body, array $blocks, array $names) {
    $nl = (strpos($body, "\r\n") !== false) ? "\r\n" : "\n";
    $lines = preg_split('/\r\n|\r|\n/', (string) $body);
    $out = [];
    $injected = false;
    $seen_top = false;
    $in_list = false;
    $item_indent = null;
    $key_indent = 0;
    foreach ($lines as $line) {
        if ($in_list) {
            if (preg_match('/^(\s*)-\s/', $line, $mm) && strlen($mm[1]) >= $key_indent) {
                if ($item_indent === null) $item_indent = $mm[1];
                $out[] = $line;
                continue;
            }
            $ind = ($item_indent !== null) ? $item_indent : str_repeat(' ', $key_indent);
            foreach ($names as $n) $out[] = $ind . '- ' . yaml_q($n);
            $in_list = false;
        }
        if (!$injected && preg_match('/^proxies:\s*\[\s*\]\s*$/', $line)) {
            $out[] = 'proxies:';
            foreach ($blocks as $b) foreach (explode("\n", $b) as $bl) $out[] = $bl;
            $injected = true; $seen_top = true;
            continue;
        }
        if (!$injected && preg_match('/^proxies:\s*$/', $line)) {
            $out[] = $line;
            foreach ($blocks as $b) foreach (explode("\n", $b) as $bl) $out[] = $bl;
            $injected = true; $seen_top = true;
            continue;
        }
        if (preg_match('/^proxies:/', $line)) $seen_top = true;
        if (preg_match('/^(\s+)proxies:\s*$/', $line, $m)) {
            $out[] = $line;
            $in_list = true;
            $item_indent = null;
            $key_indent = strlen($m[1]);
            continue;
        }
        $out[] = $line;
    }
    if ($in_list) {
        $ind = ($item_indent !== null) ? $item_indent : str_repeat(' ', $key_indent);
        foreach ($names as $n) $out[] = $ind . '- ' . yaml_q($n);
    }
    if (!$injected && !$seen_top) {
        $out[] = 'proxies:';
        foreach ($blocks as $b) foreach (explode("\n", $b) as $bl) $out[] = $bl;
    }
    return implode($nl, $out);
}

// Диспетчер парсеров по схеме ссылки. URI-протоколы (кроме vless) разбираются
// парсерами <scheme>_parse() из lib/proto/*.php; при их отсутствии — awg-фолбэк.
function squadconf_uri_scheme_map() {
    return [
        'vless://'     => 'vless',
        'trojan://'    => 'trojan',
        'ss://'        => 'shadowsocks',
        'hysteria2://' => 'hysteria2',
        'hy2://'       => 'hysteria2',
        'tuic://'      => 'tuic',
    ];
}

function squadconf_parse_any($raw) {
    $raw = (string) $raw;
    $l = ltrim($raw);
    foreach (squadconf_uri_scheme_map() as $scheme => $type) {
        if (stripos($l, $scheme) === 0) {
            if ($type === 'vless') return vless_parse($raw);
            $fn = $type . '_parse';
            if (function_exists($fn)) return $fn($raw);
            return ['ok' => false, 'type' => $type, 'warnings' => ['Парсер протокола ' . $type . ' недоступен.'], 'notes' => [], 'clients' => []];
        }
    }
    return awg_parse_conf($raw);
}

function squadconf_summary($parsed) {
    if (is_array($parsed)) {
        $t = $parsed['type'] ?? '';
        if ($t === 'vless') return vless_summary($parsed);
        if (squadconf_is_uri_proto($t)) {
            $fn = $t . '_summary';
            if (function_exists($fn)) return (string) $fn($parsed);
            return squadconf_default_name($t);
        }
    }
    return awg_summary($parsed);
}
