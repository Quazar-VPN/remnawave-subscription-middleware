<?php

function tuic_core_ok($p, $core) {
    if (!is_array($p) || empty($p['ok'])) return false;
    // Xray-core не умеет tuic вовсе.
    return in_array($core, ['clash', 'singbox'], true);
}

function tuic_clients($p) {
    $out = ['base64 (v2rayNG, Streisand, Happ)'];
    if (tuic_core_ok($p, 'clash')) $out[] = 'Mihomo / Clash.Meta';
    if (tuic_core_ok($p, 'singbox')) $out[] = 'sing-box (Hiddify и др.)';
    return $out;
}

function tuic_core_notes($p) {
    return ['TUIC собирают только Clash.Meta и sing-box; в Xray JSON этого протокола нет — там конфиг не появится.'];
}

function tuic_summary($p) {
    if (!is_array($p)) return '';
    return 'TUIC v5';
}

function tuic_parse($raw) {
    $res = [
        'ok' => false, 'type' => 'tuic',
        'clients' => [], 'warnings' => [], 'notes' => [],
        'uuid' => '', 'password' => '', 'host' => '', 'port' => 0,
        'sni' => '', 'alpn' => [], 'allowInsecure' => false,
        'congestion' => '', 'udpRelayMode' => '', 'remark' => '',
    ];
    $raw = trim((string) $raw);
    if (stripos($raw, 'tuic://') !== 0) {
        $res['warnings'][] = 'Не похоже на tuic:// ссылку.';
        return $res;
    }
    [$userinfo, $hp, $query, $remark] = proto_uri_split(substr($raw, 7));
    $res['remark'] = $remark;
    $cp = strpos($userinfo, ':');
    if ($cp !== false) { $res['uuid'] = substr($userinfo, 0, $cp); $res['password'] = substr($userinfo, $cp + 1); }
    else { $res['uuid'] = $userinfo; }
    [$res['host'], $res['port']] = proto_hostport($hp);

    $p = [];
    parse_str($query, $p);
    $g = function ($k, $d = '') use ($p) { return (isset($p[$k]) && !is_array($p[$k])) ? (string) $p[$k] : $d; };

    $res['sni'] = $g('sni', $g('peer', ''));
    $alpn = $g('alpn', '');
    if ($alpn !== '') $res['alpn'] = array_values(array_filter(array_map('trim', explode(',', $alpn)), fn($x) => $x !== ''));
    $ins = strtolower($g('insecure', $g('allow_insecure', $g('allowInsecure', ''))));
    $res['allowInsecure'] = ($ins === '1' || $ins === 'true');
    $res['congestion'] = $g('congestion_control', $g('congestion', ''));
    $res['udpRelayMode'] = $g('udp_relay_mode', $g('udp-relay-mode', ''));

    if ($res['uuid'] === '') $res['warnings'][] = 'В ссылке нет UUID.';
    if ($res['password'] === '') $res['warnings'][] = 'В ссылке нет пароля.';
    if ($res['host'] === '') $res['warnings'][] = 'В ссылке нет адреса сервера.';
    if ((int) $res['port'] <= 0) $res['warnings'][] = 'В ссылке нет порта.';

    $res['ok'] = ($res['uuid'] !== '' && $res['password'] !== '' && $res['host'] !== '' && (int) $res['port'] > 0);
    if ($res['ok']) {
        $res['clients'] = tuic_clients($res);
        $res['notes'] = tuic_core_notes($res);
    }
    return $res;
}

function tuic_to_clash($p, $name) {
    if (!tuic_core_ok($p, 'clash')) return '';
    $L = [];
    $L[] = '  - name: ' . yaml_q($name);
    $L[] = '    type: tuic';
    $L[] = '    server: ' . $p['host'];
    $L[] = '    port: ' . (int) $p['port'];
    $L[] = '    uuid: ' . yaml_q($p['uuid']);
    $L[] = '    password: ' . yaml_q($p['password']);
    if (($p['sni'] ?? '') !== '') $L[] = '    sni: ' . yaml_q($p['sni']);
    if (!empty($p['alpn'])) $L[] = '    alpn: [' . implode(', ', array_map('yaml_q', $p['alpn'])) . ']';
    if (($p['congestion'] ?? '') !== '') $L[] = '    congestion-controller: ' . yaml_q($p['congestion']);
    if (($p['udpRelayMode'] ?? '') !== '') $L[] = '    udp-relay-mode: ' . yaml_q($p['udpRelayMode']);
    if (!empty($p['allowInsecure'])) $L[] = '    skip-cert-verify: true';
    return implode("\n", $L);
}

function tuic_to_singbox($p, $tag) {
    if (!tuic_core_ok($p, 'singbox')) return null;
    $o = [
        'type' => 'tuic',
        'tag' => ($tag !== '' ? $tag : 'tuic-squad'),
        'server' => $p['host'],
        'server_port' => (int) $p['port'],
        'uuid' => $p['uuid'],
        'password' => $p['password'],
    ];
    if (($p['congestion'] ?? '') !== '') $o['congestion_control'] = $p['congestion'];
    if (($p['udpRelayMode'] ?? '') !== '') $o['udp_relay_mode'] = $p['udpRelayMode'];
    $tls = ['enabled' => true];
    if (($p['sni'] ?? '') !== '') $tls['server_name'] = $p['sni'];
    if (!empty($p['allowInsecure'])) $tls['insecure'] = true;
    if (!empty($p['alpn'])) $tls['alpn'] = $p['alpn'];
    $o['tls'] = $tls;
    return $o;
}

// Xray-core не поддерживает tuic.
function tuic_to_xray($p, $tag) {
    return null;
}
