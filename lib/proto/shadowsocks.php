<?php

// base64url/base64 декодер, терпимый к отсутствию паддинга.
if (!function_exists('proto_b64_decode')) {
    function proto_b64_decode($s) {
        $s = strtr(trim((string) $s), '-_', '+/');
        $pad = strlen($s) % 4;
        if ($pad) $s .= str_repeat('=', 4 - $pad);
        $d = base64_decode($s, true);
        return $d === false ? '' : $d;
    }
}

function shadowsocks_core_ok($p, $core) {
    if (!is_array($p) || empty($p['ok'])) return false;
    return in_array($core, ['clash', 'singbox', 'xray'], true);
}

function shadowsocks_clients($p) {
    $out = ['base64 (v2rayNG, Streisand, Happ)'];
    if (shadowsocks_core_ok($p, 'clash')) $out[] = 'Mihomo / Clash.Meta';
    if (shadowsocks_core_ok($p, 'singbox')) $out[] = 'sing-box (Hiddify и др.)';
    if (shadowsocks_core_ok($p, 'xray')) $out[] = 'Xray JSON';
    return $out;
}

function shadowsocks_core_notes($p) {
    $out = [];
    if (($p['plugin'] ?? '') !== '') {
        $out[] = 'Плагин «' . $p['plugin'] . '» переносится только в base64-ссылку; в Clash/sing-box/Xray выводится базовый SS-узел без обфускации плагина.';
    }
    return $out;
}

function shadowsocks_summary($p) {
    if (!is_array($p)) return '';
    return 'Shadowsocks ' . ($p['method'] !== '' ? $p['method'] : '?');
}

function shadowsocks_parse($raw) {
    $res = [
        'ok' => false, 'type' => 'shadowsocks',
        'clients' => [], 'warnings' => [], 'notes' => [],
        'method' => '', 'password' => '', 'host' => '', 'port' => 0,
        'plugin' => '', 'pluginOpts' => '', 'remark' => '',
    ];
    $raw = trim((string) $raw);
    if (stripos($raw, 'ss://') !== 0) {
        $res['warnings'][] = 'Не похоже на ss:// ссылку.';
        return $res;
    }
    $s = substr($raw, 5);
    $hash = strpos($s, '#');
    if ($hash !== false) { $res['remark'] = rawurldecode(substr($s, $hash + 1)); $s = substr($s, 0, $hash); }
    $query = '';
    $qp = strpos($s, '?');
    if ($qp !== false) { $query = substr($s, $qp + 1); $s = substr($s, 0, $qp); }

    $at = strrpos($s, '@');
    if ($at !== false) {
        // SIP002: ss://base64(method:password)@host:port  (userinfo может быть и открытым текстом)
        $userinfo = substr($s, 0, $at);
        $hp = substr($s, $at + 1);
        $creds = $userinfo;
        if (strpos($userinfo, ':') === false) {
            $dec = proto_b64_decode($userinfo);
            if ($dec !== '') $creds = $dec;
        } else {
            $creds = rawurldecode($userinfo);
        }
        $cp = strpos($creds, ':');
        if ($cp !== false) { $res['method'] = substr($creds, 0, $cp); $res['password'] = substr($creds, $cp + 1); }
        [$res['host'], $res['port']] = proto_hostport($hp);
    } else {
        // Legacy: ss://base64(method:password@host:port)
        $dec = proto_b64_decode($s);
        if ($dec === '') { $res['warnings'][] = 'Не удалось декодировать base64 тело ss:// ссылки.'; return $res; }
        $a2 = strrpos($dec, '@');
        if ($a2 === false) { $res['warnings'][] = 'В ss:// ссылке нет method:password@host:port.'; return $res; }
        $creds = substr($dec, 0, $a2);
        $hp = substr($dec, $a2 + 1);
        $cp = strpos($creds, ':');
        if ($cp !== false) { $res['method'] = substr($creds, 0, $cp); $res['password'] = substr($creds, $cp + 1); }
        [$res['host'], $res['port']] = proto_hostport($hp);
    }

    if ($query !== '') {
        $p = [];
        parse_str($query, $p);
        if (isset($p['plugin']) && !is_array($p['plugin'])) {
            $plug = (string) $p['plugin'];
            $sc = strpos($plug, ';');
            if ($sc !== false) { $res['plugin'] = substr($plug, 0, $sc); $res['pluginOpts'] = substr($plug, $sc + 1); }
            else $res['plugin'] = $plug;
        }
    }

    if ($res['method'] === '') $res['warnings'][] = 'В ссылке нет метода шифрования.';
    if ($res['password'] === '') $res['warnings'][] = 'В ссылке нет пароля.';
    if ($res['host'] === '') $res['warnings'][] = 'В ссылке нет адреса сервера.';
    if ((int) $res['port'] <= 0) $res['warnings'][] = 'В ссылке нет порта.';

    $res['ok'] = ($res['method'] !== '' && $res['password'] !== '' && $res['host'] !== '' && (int) $res['port'] > 0);
    if ($res['ok']) {
        $res['clients'] = shadowsocks_clients($res);
        $res['notes'] = shadowsocks_core_notes($res);
    }
    return $res;
}

function shadowsocks_to_clash($p, $name) {
    if (!shadowsocks_core_ok($p, 'clash')) return '';
    $L = [];
    $L[] = '  - name: ' . yaml_q($name);
    $L[] = '    type: ss';
    $L[] = '    server: ' . $p['host'];
    $L[] = '    port: ' . (int) $p['port'];
    $L[] = '    cipher: ' . yaml_q($p['method']);
    $L[] = '    password: ' . yaml_q($p['password']);
    $L[] = '    udp: true';
    return implode("\n", $L);
}

function shadowsocks_to_singbox($p, $tag) {
    if (!shadowsocks_core_ok($p, 'singbox')) return null;
    return [
        'type' => 'shadowsocks',
        'tag' => ($tag !== '' ? $tag : 'ss-squad'),
        'server' => $p['host'],
        'server_port' => (int) $p['port'],
        'method' => $p['method'],
        'password' => $p['password'],
    ];
}

function shadowsocks_to_xray($p, $tag) {
    if (!shadowsocks_core_ok($p, 'xray')) return null;
    $server = [
        'address' => $p['host'],
        'port' => (int) $p['port'],
        'method' => $p['method'],
        'password' => $p['password'],
    ];
    $o = ['protocol' => 'shadowsocks', 'settings' => ['servers' => [$server]]];
    $stream = ['network' => 'tcp'];
    if (!empty($p['sockopt']) && is_array($p['sockopt'])) $stream['sockopt'] = $p['sockopt'];
    if (isset($stream['sockopt'])) $o['streamSettings'] = $stream;
    if ($tag !== '') $o['tag'] = $tag;
    if (!empty($p['mux']) && is_array($p['mux'])) $o['mux'] = $p['mux'];
    return $o;
}
