<?php

function hysteria2_core_ok($p, $core) {
    if (!is_array($p) || empty($p['ok'])) return false;
    // Xray-core v26+ умеет hysteria2 (protocol: "hysteria", version 2).
    return in_array($core, ['clash', 'singbox', 'xray'], true);
}

function hysteria2_clients($p) {
    $out = ['base64 (v2rayNG, Streisand, Happ)'];
    if (hysteria2_core_ok($p, 'clash')) $out[] = 'Mihomo / Clash.Meta';
    if (hysteria2_core_ok($p, 'singbox')) $out[] = 'sing-box (Hiddify и др.)';
    if (hysteria2_core_ok($p, 'xray')) $out[] = 'Xray JSON (Happ, v2rayN)';
    return $out;
}

function hysteria2_core_notes($p) {
    $out = ['Hysteria2 собирается для Clash.Meta, sing-box и Xray JSON (v26+ ядро). В base64 уходит как ссылка.'];
    if (strtolower((string) ($p['obfs'] ?? '')) === 'salamander') {
        $out[] = 'Salamander-обфускация в Xray JSON выводится как finalmask; проверьте, что версия ядра клиента её поддерживает.';
    }
    return $out;
}

function hysteria2_summary($p) {
    if (!is_array($p)) return '';
    $tls = empty($p['allowInsecure']) ? '+ TLS' : '+ TLS (insecure)';
    $obfs = ($p['obfs'] ?? '') !== '' ? ' + obfs' : '';
    return 'Hysteria2 ' . $tls . $obfs;
}

function hysteria2_parse($raw) {
    $res = [
        'ok' => false, 'type' => 'hysteria2',
        'clients' => [], 'warnings' => [], 'notes' => [],
        'password' => '', 'host' => '', 'port' => 0,
        'sni' => '', 'alpn' => [], 'allowInsecure' => false, 'fp' => '',
        'obfs' => '', 'obfsPassword' => '', 'pinSHA256' => '', 'remark' => '',
    ];
    $raw = trim((string) $raw);
    $off = 0;
    if (stripos($raw, 'hysteria2://') === 0) $off = 12;
    elseif (stripos($raw, 'hy2://') === 0) $off = 6;
    else { $res['warnings'][] = 'Не похоже на hysteria2:// / hy2:// ссылку.'; return $res; }

    [$userinfo, $hp, $query, $remark] = proto_uri_split(substr($raw, $off));
    $res['remark'] = $remark;
    $res['password'] = $userinfo; // auth
    [$res['host'], $res['port']] = proto_hostport($hp);

    $p = [];
    parse_str($query, $p);
    $g = function ($k, $d = '') use ($p) { return (isset($p[$k]) && !is_array($p[$k])) ? (string) $p[$k] : $d; };

    $res['sni'] = $g('sni', $g('peer', ''));
    $alpn = $g('alpn', '');
    if ($alpn !== '') $res['alpn'] = array_values(array_filter(array_map('trim', explode(',', $alpn)), fn($x) => $x !== ''));
    $ins = strtolower($g('insecure', $g('allowInsecure', '')));
    $res['allowInsecure'] = ($ins === '1' || $ins === 'true');
    $res['fp'] = $g('fp', $g('fingerprint', ''));
    $res['obfs'] = $g('obfs', '');
    $res['obfsPassword'] = $g('obfs-password', $g('obfs_password', ''));
    $res['pinSHA256'] = $g('pinSHA256', $g('pinsha256', ''));

    if ($res['password'] === '') $res['warnings'][] = 'В ссылке нет auth (пароля).';
    if ($res['host'] === '') $res['warnings'][] = 'В ссылке нет адреса сервера.';
    if ((int) $res['port'] <= 0) $res['warnings'][] = 'В ссылке нет порта.';

    $res['ok'] = ($res['password'] !== '' && $res['host'] !== '' && (int) $res['port'] > 0);
    if ($res['ok']) {
        $res['clients'] = hysteria2_clients($res);
        $res['notes'] = hysteria2_core_notes($res);
    }
    return $res;
}

function hysteria2_to_clash($p, $name) {
    if (!hysteria2_core_ok($p, 'clash')) return '';
    $L = [];
    $L[] = '  - name: ' . yaml_q($name);
    $L[] = '    type: hysteria2';
    $L[] = '    server: ' . $p['host'];
    $L[] = '    port: ' . (int) $p['port'];
    $L[] = '    password: ' . yaml_q($p['password']);
    if (($p['sni'] ?? '') !== '') $L[] = '    sni: ' . yaml_q($p['sni']);
    if (!empty($p['alpn'])) $L[] = '    alpn: [' . implode(', ', array_map('yaml_q', $p['alpn'])) . ']';
    if (!empty($p['allowInsecure'])) $L[] = '    skip-cert-verify: true';
    if (($p['obfs'] ?? '') !== '') {
        $L[] = '    obfs: ' . yaml_q($p['obfs']);
        if (($p['obfsPassword'] ?? '') !== '') $L[] = '    obfs-password: ' . yaml_q($p['obfsPassword']);
    }
    return implode("\n", $L);
}

function hysteria2_to_singbox($p, $tag) {
    if (!hysteria2_core_ok($p, 'singbox')) return null;
    $o = [
        'type' => 'hysteria2',
        'tag' => ($tag !== '' ? $tag : 'hy2-squad'),
        'server' => $p['host'],
        'server_port' => (int) $p['port'],
        'password' => $p['password'],
    ];
    if (($p['obfs'] ?? '') !== '') {
        $ob = ['type' => $p['obfs']];
        if (($p['obfsPassword'] ?? '') !== '') $ob['password'] = $p['obfsPassword'];
        $o['obfs'] = $ob;
    }
    $tls = ['enabled' => true];
    if (($p['sni'] ?? '') !== '') $tls['server_name'] = $p['sni'];
    if (!empty($p['allowInsecure'])) $tls['insecure'] = true;
    if (!empty($p['alpn'])) $tls['alpn'] = $p['alpn'];
    $o['tls'] = $tls;
    return $o;
}

// Xray-core v26+: protocol "hysteria" c version 2. Схема — streamSettings.method
// = "hysteria" + hysteriaSettings{version,auth}, TLS в tlsSettings.
function hysteria2_to_xray($p, $tag) {
    if (!hysteria2_core_ok($p, 'xray')) return null;
    $tls = ['serverName' => (($p['sni'] ?? '') !== '' ? (string) $p['sni'] : (string) $p['host'])];
    if (!empty($p['alpn'])) $tls['alpn'] = $p['alpn'];
    if (!empty($p['allowInsecure'])) $tls['allowInsecure'] = true;
    if (($p['pinSHA256'] ?? '') !== '') $tls['pinnedPeerCertSha256'] = (string) $p['pinSHA256'];
    if (($p['fp'] ?? '') !== '') $tls['fingerprint'] = (string) $p['fp'];
    // Форма как в реальном xray-json от панели (проверено): network "hysteria" +
    // hysteriaSettings{version,auth}, TLS в tlsSettings.
    $stream = [
        'network'          => 'hysteria',
        'hysteriaSettings' => ['version' => 2, 'auth' => (string) $p['password']],
        'security'         => 'tls',
        'tlsSettings'      => $tls,
    ];
    // Salamander-обфускация (Hysteria2) → UDP-маска finalmask.
    if (strtolower((string) ($p['obfs'] ?? '')) === 'salamander' && ($p['obfsPassword'] ?? '') !== '') {
        $stream['finalmask'] = ['type' => 'salamander', 'settings' => ['password' => (string) $p['obfsPassword']]];
    }
    if (!empty($p['sockopt']) && is_array($p['sockopt'])) $stream['sockopt'] = $p['sockopt'];
    $o = [
        'protocol'       => 'hysteria',
        'settings'       => ['version' => 2, 'address' => (string) $p['host'], 'port' => (int) $p['port']],
        'streamSettings' => $stream,
    ];
    if ($tag !== '') $o['tag'] = $tag;
    return $o;
}

// Реверс: xray-outbound (protocol "hysteria" v2) → hysteria2:// URI. Для импорта
// из чужих xray-json подписок. Возвращает '' если это не hysteria2-аутбаунд.
function hysteria2_from_xray($ob, $remark = '') {
    if (!is_array($ob) || ($ob['protocol'] ?? '') !== 'hysteria') return '';
    $st = $ob['settings'] ?? [];
    if ((int) ($st['version'] ?? 0) !== 2) return ''; // hysteria v1 не поддерживаем
    $host = (string) ($st['address'] ?? ''); $port = (int) ($st['port'] ?? 0);
    $ss = $ob['streamSettings'] ?? [];
    $auth = (string) ($ss['hysteriaSettings']['auth'] ?? '');
    if ($host === '' || $port <= 0 || $auth === '') return '';
    $tls = $ss['tlsSettings'] ?? [];
    $q = [];
    if (($tls['serverName'] ?? '') !== '') $q[] = 'sni=' . rawurlencode((string) $tls['serverName']);
    if (!empty($tls['alpn']) && is_array($tls['alpn'])) $q[] = 'alpn=' . rawurlencode(implode(',', $tls['alpn']));
    if (($tls['fingerprint'] ?? '') !== '') $q[] = 'fp=' . rawurlencode((string) $tls['fingerprint']);
    if (!empty($tls['allowInsecure'])) $q[] = 'insecure=1';
    if (isset($ss['finalmask']['type']) && $ss['finalmask']['type'] === 'salamander') {
        $q[] = 'obfs=salamander';
        $pw = (string) ($ss['finalmask']['settings']['password'] ?? '');
        if ($pw !== '') $q[] = 'obfs-password=' . rawurlencode($pw);
    }
    $uri = 'hysteria2://' . rawurlencode($auth) . '@' . $host . ':' . $port;
    if ($q) $uri .= '?' . implode('&', $q);
    if ($remark !== '') $uri .= '#' . rawurlencode($remark);
    return $uri;
}
