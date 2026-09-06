<?php

function hysteria2_core_ok($p, $core) {
    if (!is_array($p) || empty($p['ok'])) return false;
    // Xray-core не умеет hysteria2 вовсе.
    return in_array($core, ['clash', 'singbox'], true);
}

function hysteria2_clients($p) {
    $out = ['base64 (v2rayNG, Streisand, Happ)'];
    if (hysteria2_core_ok($p, 'clash')) $out[] = 'Mihomo / Clash.Meta';
    if (hysteria2_core_ok($p, 'singbox')) $out[] = 'sing-box (Hiddify и др.)';
    return $out;
}

function hysteria2_core_notes($p) {
    return ['Hysteria2 собирают только Clash.Meta и sing-box; в Xray JSON этого протокола нет — там конфиг не появится.'];
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
        'sni' => '', 'alpn' => [], 'allowInsecure' => false,
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

// Xray-core не поддерживает hysteria2.
function hysteria2_to_xray($p, $tag) {
    return null;
}
