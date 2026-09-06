<?php

// Разбор host:port с поддержкой IPv6 в скобках; общий помощник для lib/proto/*.
if (!function_exists('proto_hostport')) {
    function proto_hostport($hp) {
        $hp = (string) $hp;
        if (isset($hp[0]) && $hp[0] === '[') {
            $rb = strpos($hp, ']');
            if ($rb === false) return ['', 0];
            $host = substr($hp, 1, $rb - 1);
            $tail = substr($hp, $rb + 1);
            $port = (isset($tail[0]) && $tail[0] === ':') ? (int) substr($tail, 1) : 0;
            return [$host, $port];
        }
        $cp = strrpos($hp, ':');
        if ($cp === false) return [$hp, 0];
        return [substr($hp, 0, $cp), (int) substr($hp, $cp + 1)];
    }
}

// Разбивает URI вида <scheme>://<userinfo>@host:port?query#frag на части.
// Возвращает [userinfo, hostport, query, remark]; userinfo/remark rawurldecode'ятся.
if (!function_exists('proto_uri_split')) {
    function proto_uri_split($s) {
        $remark = '';
        $hash = strpos($s, '#');
        if ($hash !== false) { $remark = rawurldecode(substr($s, $hash + 1)); $s = substr($s, 0, $hash); }
        $query = '';
        $qp = strpos($s, '?');
        if ($qp !== false) { $query = substr($s, $qp + 1); $s = substr($s, 0, $qp); }
        $userinfo = '';
        $at = strrpos($s, '@');
        if ($at !== false) { $userinfo = rawurldecode(substr($s, 0, $at)); $s = substr($s, $at + 1); }
        return [$userinfo, $s, $query, $remark];
    }
}

function trojan_core_ok($p, $core) {
    if (!is_array($p) || empty($p['ok'])) return false;
    $net = vless_net_norm($p['net'] ?? 'tcp');
    if ($core === 'clash') return in_array($net, ['tcp', 'ws', 'grpc', 'httpupgrade'], true);
    if ($core === 'singbox') return in_array($net, ['tcp', 'ws', 'grpc', 'httpupgrade'], true);
    if ($core === 'xray') return in_array($net, ['tcp', 'ws', 'grpc', 'httpupgrade', 'xhttp'], true);
    return false;
}

function trojan_clients($p) {
    $out = ['base64 (v2rayNG, Streisand, Happ)'];
    if (trojan_core_ok($p, 'clash')) $out[] = 'Mihomo / Clash.Meta';
    if (trojan_core_ok($p, 'singbox')) $out[] = 'sing-box (Hiddify и др.)';
    if (trojan_core_ok($p, 'xray')) $out[] = 'Xray JSON';
    return $out;
}

function trojan_core_notes($p) {
    $out = [];
    $net = vless_net_norm($p['net'] ?? 'tcp');
    if (!trojan_core_ok($p, 'clash') && !trojan_core_ok($p, 'singbox') && !trojan_core_ok($p, 'xray')) {
        $out[] = 'Транспорт «' . $net . '» не собирается ни одним ядром — конфиг уйдёт только в base64-подписку как ссылка.';
        return $out;
    }
    if ($net === 'xhttp') $out[] = 'XHTTP для Trojan умеет только Xray — в Clash и sing-box конфиг не появится.';
    if ($p['security'] === 'reality' && !in_array($net, ['tcp', 'grpc', 'xhttp'], true)) $out[] = 'REALITY у Trojan Xray разрешает только для RAW, gRPC и XHTTP.';
    return $out;
}

function trojan_summary($p) {
    if (!is_array($p)) return '';
    $sec = ($p['security'] ?? '') === 'reality' ? 'Reality' : (($p['security'] ?? '') === 'tls' ? 'TLS' : 'no-TLS');
    $net = vless_net_norm($p['net'] ?? 'tcp');
    return 'Trojan ' . strtoupper($net) . ' + ' . $sec;
}

function trojan_parse($raw) {
    $res = [
        'ok' => false, 'type' => 'trojan',
        'clients' => [], 'warnings' => [], 'notes' => [],
        'password' => '', 'host' => '', 'port' => 0,
        'net' => 'tcp', 'security' => 'tls',
        'sni' => '', 'alpn' => [], 'fp' => '', 'pbk' => '', 'sid' => '', 'allowInsecure' => false,
        'path' => '', 'hostHeader' => '', 'serviceName' => '', 'grpcMode' => '', 'remark' => '',
    ];
    $raw = trim((string) $raw);
    if (stripos($raw, 'trojan://') !== 0) {
        $res['warnings'][] = 'Не похоже на trojan:// ссылку.';
        return $res;
    }
    [$userinfo, $hp, $query, $remark] = proto_uri_split(substr($raw, 9));
    $res['remark'] = $remark;
    $res['password'] = $userinfo;
    [$res['host'], $res['port']] = proto_hostport($hp);

    $p = [];
    parse_str($query, $p);
    $g = function ($k, $d = '') use ($p) { return (isset($p[$k]) && !is_array($p[$k])) ? (string) $p[$k] : $d; };

    $res['net'] = vless_net_norm($g('type', 'tcp'));
    $sec = strtolower($g('security', 'tls'));
    if ($sec === '') $sec = 'none';
    $res['security'] = $sec;
    $res['sni'] = $g('sni', $g('peer', $g('serverName', '')));
    $alpn = $g('alpn', '');
    if ($alpn !== '') $res['alpn'] = array_values(array_filter(array_map('trim', explode(',', $alpn)), fn($x) => $x !== ''));
    $res['fp'] = $g('fp', '');
    $res['pbk'] = $g('pbk', '');
    $res['sid'] = $g('sid', '');
    $ai = strtolower($g('allowInsecure', ''));
    $res['allowInsecure'] = ($ai === '1' || $ai === 'true');
    $res['path'] = $g('path', '');
    $res['hostHeader'] = $g('host', '');
    $res['serviceName'] = $g('serviceName', '');
    $res['grpcMode'] = strtolower($g('mode', ''));
    if ($res['security'] === 'reality' && $res['fp'] === '') $res['fp'] = 'chrome';

    if ($res['password'] === '') $res['warnings'][] = 'В ссылке нет пароля.';
    if ($res['host'] === '') $res['warnings'][] = 'В ссылке нет адреса сервера.';
    if ((int) $res['port'] <= 0) $res['warnings'][] = 'В ссылке нет порта.';
    if ($res['security'] === 'reality' && $res['pbk'] === '') $res['warnings'][] = 'Reality без pbk (publicKey) — узел нерабочий.';

    $reality_ok = ($res['security'] !== 'reality' || $res['pbk'] !== '');
    $res['ok'] = ($res['password'] !== '' && $res['host'] !== '' && (int) $res['port'] > 0 && $reality_ok);
    if ($res['ok']) {
        $res['clients'] = trojan_clients($res);
        $res['notes'] = trojan_core_notes($res);
    }
    return $res;
}

function trojan_to_clash($p, $name) {
    if (!trojan_core_ok($p, 'clash')) return '';
    $net = vless_net_norm($p['net'] ?? 'tcp');
    $L = [];
    $L[] = '  - name: ' . yaml_q($name);
    $L[] = '    type: trojan';
    $L[] = '    server: ' . $p['host'];
    $L[] = '    port: ' . (int) $p['port'];
    $L[] = '    password: ' . yaml_q($p['password']);
    $L[] = '    udp: true';
    if (($p['sni'] ?? '') !== '') $L[] = '    sni: ' . yaml_q($p['sni']);
    if (!empty($p['alpn'])) $L[] = '    alpn: [' . implode(', ', array_map('yaml_q', $p['alpn'])) . ']';
    if (($p['fp'] ?? '') !== '') $L[] = '    client-fingerprint: ' . yaml_q($p['fp']);
    if (!empty($p['allowInsecure'])) $L[] = '    skip-cert-verify: true';
    if (($p['security'] ?? '') === 'reality') {
        $L[] = '    reality-opts:';
        $L[] = '      public-key: ' . yaml_q($p['pbk']);
        if (($p['sid'] ?? '') !== '') $L[] = '      short-id: ' . yaml_q($p['sid']);
    }
    if ($net === 'ws' || $net === 'httpupgrade') {
        $L[] = '    network: ws';
        $ws = [];
        if (($p['path'] ?? '') !== '') $ws['path'] = (string) $p['path'];
        if (($p['hostHeader'] ?? '') !== '') $ws['headers'] = ['Host' => (string) $p['hostHeader']];
        if ($net === 'httpupgrade') $ws['v2ray-http-upgrade'] = true;
        if ($ws) { $L[] = '    ws-opts:'; foreach (vless_yaml_block($ws, 6) as $l) $L[] = $l; }
    } elseif ($net === 'grpc') {
        $L[] = '    network: grpc';
        $L[] = '    grpc-opts:';
        $L[] = '      grpc-service-name: ' . yaml_q((string) ($p['serviceName'] ?? ''));
    }
    return implode("\n", $L);
}

function trojan_to_singbox($p, $tag) {
    if (!trojan_core_ok($p, 'singbox')) return null;
    $net = vless_net_norm($p['net'] ?? 'tcp');
    $o = [
        'type' => 'trojan',
        'tag' => ($tag !== '' ? $tag : 'trojan-squad'),
        'server' => $p['host'],
        'server_port' => (int) $p['port'],
        'password' => $p['password'],
    ];
    if (in_array($p['security'], ['tls', 'reality'], true)) {
        $tls = ['enabled' => true];
        if (($p['sni'] ?? '') !== '') $tls['server_name'] = $p['sni'];
        if (!empty($p['allowInsecure'])) $tls['insecure'] = true;
        if (!empty($p['alpn'])) $tls['alpn'] = $p['alpn'];
        if (($p['fp'] ?? '') !== '') $tls['utls'] = ['enabled' => true, 'fingerprint' => $p['fp']];
        if ($p['security'] === 'reality') {
            if (!isset($tls['utls'])) $tls['utls'] = ['enabled' => true, 'fingerprint' => (($p['fp'] ?? '') !== '' ? $p['fp'] : 'chrome')];
            $r = ['enabled' => true, 'public_key' => $p['pbk']];
            if (($p['sid'] ?? '') !== '') $r['short_id'] = $p['sid'];
            $tls['reality'] = $r;
        }
        $o['tls'] = $tls;
    }
    if ($net === 'ws') {
        $t = ['type' => 'ws'];
        if (($p['path'] ?? '') !== '') $t['path'] = $p['path'];
        if (($p['hostHeader'] ?? '') !== '') $t['headers'] = ['Host' => $p['hostHeader']];
        $o['transport'] = $t;
    } elseif ($net === 'grpc') {
        $o['transport'] = ['type' => 'grpc', 'service_name' => (string) $p['serviceName']];
    } elseif ($net === 'httpupgrade') {
        $t = ['type' => 'httpupgrade'];
        if (($p['hostHeader'] ?? '') !== '') $t['host'] = $p['hostHeader'];
        if (($p['path'] ?? '') !== '') $t['path'] = $p['path'];
        $o['transport'] = $t;
    }
    return $o;
}

function trojan_to_xray($p, $tag) {
    if (!trojan_core_ok($p, 'xray')) return null;
    $net = vless_net_norm($p['net'] ?? 'tcp');
    $server = ['address' => $p['host'], 'port' => (int) $p['port'], 'password' => $p['password']];
    $sec = $p['security'] === 'reality' ? 'reality' : ($p['security'] === 'tls' ? 'tls' : 'none');
    $stream = ['network' => $net, 'security' => $sec];
    if ($sec === 'tls') {
        $t = [];
        if (($p['sni'] ?? '') !== '') $t['serverName'] = $p['sni'];
        if (!empty($p['alpn'])) $t['alpn'] = $p['alpn'];
        if (($p['fp'] ?? '') !== '') $t['fingerprint'] = $p['fp'];
        if ($t) $stream['tlsSettings'] = $t;
    } elseif ($sec === 'reality') {
        $r = [];
        if (($p['sni'] ?? '') !== '') $r['serverName'] = $p['sni'];
        if (($p['fp'] ?? '') !== '') $r['fingerprint'] = $p['fp'];
        if (($p['pbk'] ?? '') !== '') $r['publicKey'] = $p['pbk'];
        if (($p['sid'] ?? '') !== '') $r['shortId'] = $p['sid'];
        $stream['realitySettings'] = $r;
    }
    if ($net === 'ws') {
        $w = [];
        if (($p['path'] ?? '') !== '') $w['path'] = $p['path'];
        if (($p['hostHeader'] ?? '') !== '') $w['host'] = $p['hostHeader'];
        if ($w) $stream['wsSettings'] = $w;
    } elseif ($net === 'grpc') {
        $gs = ['serviceName' => (string) ($p['serviceName'] ?? '')];
        if (strtolower((string) ($p['grpcMode'] ?? '')) === 'multi') $gs['multiMode'] = true;
        $stream['grpcSettings'] = $gs;
    } elseif ($net === 'httpupgrade') {
        $h = [];
        if (($p['path'] ?? '') !== '') $h['path'] = $p['path'];
        if (($p['hostHeader'] ?? '') !== '') $h['host'] = $p['hostHeader'];
        if ($h) $stream['httpupgradeSettings'] = $h;
    } elseif ($net === 'xhttp') {
        $x = [];
        if (($p['path'] ?? '') !== '') $x['path'] = $p['path'];
        if (($p['hostHeader'] ?? '') !== '') $x['host'] = $p['hostHeader'];
        $stream['xhttpSettings'] = $x;
    }
    if (!empty($p['sockopt']) && is_array($p['sockopt'])) $stream['sockopt'] = $p['sockopt'];
    $o = [
        'protocol' => 'trojan',
        'settings' => ['servers' => [$server]],
        'streamSettings' => $stream,
    ];
    if ($tag !== '') $o['tag'] = $tag;
    if (!empty($p['mux']) && is_array($p['mux'])) $o['mux'] = $p['mux'];
    return $o;
}
