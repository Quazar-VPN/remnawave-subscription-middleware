<?php
    // Форк Quazar (R2): вкладка «Импорт из подписок». Источники чужих подписок,
    // просмотр хостов внутри (под UA клиента), выборочный импорт в squad_configs
    // и сверка дрифта / ре-синк. Бэкенд — lib/extsub.php.
    $es_ua_opts = extsub_ua_options();
    $es_src_id  = (int) ($_GET['src'] ?? 0);
    $es_view    = (string) ($_GET['view'] ?? '');
    $es_cur     = $es_src_id > 0 ? extsub_get($es_src_id) : null;
    // человекочитаемое «когда запрашивался»
    $es_ago = function ($ts) {
        $ts = (int) $ts;
        if ($ts <= 0) return 'не запрашивался';
        $d = max(0, time() - $ts);
        if ($d < 60) return 'только что';
        if ($d < 3600) return intdiv($d, 60) . ' мин назад';
        if ($d < 86400) return intdiv($d, 3600) . ' ч назад';
        return intdiv($d, 86400) . ' дн назад';
    };
?>
    <style>
        .es-badge{display:inline-block;border-radius:6px;padding:.08rem .45rem;font-size:.74rem;white-space:nowrap;border:1px solid var(--line)}
        .es-badge.ok{border-color:var(--accent);color:var(--accent-text)}
        .es-badge.mut{color:var(--muted)}
        .es-badge.warn{border-color:var(--c-warn-fg);color:var(--c-warn-fg)}
        .es-url{font-family:monospace;font-size:.78rem;color:var(--muted);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:inline-block;vertical-align:bottom}
        .es-key{font-family:monospace;font-size:.78rem}
    </style>

<?php if ($es_cur && ($es_view === 'hosts' || $es_view === 'drift')): ?>

    <p style="margin:0 0 1rem"><a class="sqcfg-btn" href="index.php?tab=ext_import">← Все источники</a></p>

    <?php if ($es_view === 'hosts'): ?>
        <?php
            $es_err = '';
            $es_hosts = extsub_fetch_hosts($es_src_id, $es_err);
        ?>
        <div class="card">
            <div class="loghead"><h2>Хосты источника: <?= h((string) $es_cur['name']) ?></h2></div>
            <?php if ($es_err !== ''): ?>
                <div class="warn">Не удалось получить хосты: <?= h($es_err) ?>. Проверьте URL источника и доступность сети.</div>
            <?php elseif (!$es_hosts): ?>
                <p class="muted">В подписке источника не найдено ни одного хоста.</p>
            <?php else: ?>
                <form method="post" autocomplete="off">
                    <input type="hidden" name="csrf" value="<?= h($token) ?>">
                    <input type="hidden" name="action" value="extsub_import">
                    <input type="hidden" name="id" value="<?= (int) $es_cur['id'] ?>">

                    <label style="display:block;margin-bottom:.35rem;font-weight:600;font-size:.85rem">Куда импортировать <span class="muted" style="font-weight:400">— ручная привязка или сквады</span></label>
                    <div class="sq-grid">
                        <label class="sq-item sq-manual"><input type="checkbox" name="squads[]" value="__manual__" checked><span class="sq-mtxt"><span class="sq-n">🔧 Ручная привязка</span><span class="muted" style="font-size:.72rem">в обход сквадов</span></span></label>
                        <?php foreach ($extsub_squads as $s): ?>
                            <label class="sq-item"><input type="checkbox" name="squads[]" value="<?= h($s['uuid']) ?>"><span class="sq-n"><?= h($s['name']) ?></span><span class="muted" style="font-size:.78rem"><?= (int) $s['members'] ?></span></label>
                        <?php endforeach; ?>
                    </div>

                    <div style="margin-top:1rem;max-width:260px">
                        <label for="es_position" style="display:block;margin-bottom:.3rem;font-weight:600;font-size:.82rem">Позиция в подписке</label>
                        <select id="es_position" name="position" class="sqcfg-sel" style="width:100%;box-sizing:border-box">
                            <option value="end">В конец (по умолчанию)</option>
                            <option value="start">В начало</option>
                        </select>
                    </div>

                    <table class="logtbl" style="margin-top:1.1rem">
                        <thead><tr>
                            <th style="width:1%"><input type="checkbox" id="es_all" title="Выбрать все"></th>
                            <th>Метка</th><th>Тип</th><th>Хост</th><th>Статус</th>
                        </tr></thead>
                        <tbody>
                        <?php foreach ($es_hosts as $ho): $imp = !empty($ho['imported']); $drift = !empty($ho['drift']); $ok = !empty($ho['ok']); ?>
                            <tr>
                                <td><input type="checkbox" class="es-row" name="keys[]" value="<?= h($ho['key']) ?>"<?= $ok ? '' : ' disabled' ?>></td>
                                <td><?= ((string) $ho['remark'] !== '') ? h($ho['remark']) : '<span class="muted">—</span>' ?></td>
                                <td><span class="tag normal"><?= h((string) $ho['type']) ?></span></td>
                                <td class="es-key"><?= h($ho['key']) ?></td>
                                <td style="white-space:nowrap">
                                    <?php if ($ok): ?><span class="es-badge ok">импортируемый</span><?php else: ?><span class="es-badge warn">не распознан</span><?php endif; ?>
                                    <?php if ($imp): ?> <span class="es-badge mut">уже импортирован</span><?php endif; ?>
                                    <?php if ($drift): ?> <span class="es-badge warn">дрифт</span><?php endif; ?>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>

                    <div style="margin-top:1rem;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
                        <button type="submit" class="btn">Импортировать выбранные</button>
                        <span class="muted" style="font-size:.8rem">Импортируются только распознанные и ещё не привязанные хосты.</span>
                    </div>
                </form>
                <script>
                (function () {
                    var all = document.getElementById('es_all');
                    if (!all) return;
                    all.addEventListener('change', function () {
                        document.querySelectorAll('input.es-row:not([disabled])').forEach(function (cb) { cb.checked = all.checked; });
                    });
                })();
                </script>
            <?php endif; ?>
        </div>

    <?php else: /* view=drift */ ?>
        <?php
            $es_err = '';
            $es_diff = extsub_diff($es_src_id, $es_err);
            $es_sec = [
                ['new',       'Новые',        $es_diff['new']],
                ['changed',   'Изменились',   $es_diff['changed']],
                ['removed',   'Пропали',      $es_diff['removed']],
                ['unchanged', 'Без изменений',$es_diff['unchanged']],
            ];
        ?>
        <div class="card">
            <div class="loghead"><h2>Дрифт источника: <?= h((string) $es_cur['name']) ?></h2></div>
            <?php if ($es_err !== ''): ?>
                <div class="warn">Не удалось получить источник: <?= h($es_err) ?>.</div>
            <?php endif; ?>
            <form method="post" style="margin:.2rem 0 1rem" onsubmit="return uiConfirmForm(this,'Обновить привязанные хосты из источника?')">
                <input type="hidden" name="csrf" value="<?= h($token) ?>">
                <input type="hidden" name="action" value="extsub_resync">
                <input type="hidden" name="id" value="<?= (int) $es_cur['id'] ?>">
                <button type="submit" class="btn">Синхронизировать изменившиеся</button>
            </form>

            <?php foreach ($es_sec as $sec): [$sk, $slabel, $srows] = $sec; ?>
                <h2 style="font-size:.95rem;margin:1.2rem 0 .5rem"><?= h($slabel) ?> (<?= count($srows) ?>)</h2>
                <?php if (!$srows): ?>
                    <p class="muted">Пусто.</p>
                <?php else: ?>
                    <table class="logtbl">
                        <thead><tr><th>Метка</th><th>Тип</th><th>Хост</th></tr></thead>
                        <tbody>
                        <?php foreach ($srows as $ho): ?>
                            <tr>
                                <td><?= ((string) ($ho['remark'] ?? '') !== '') ? h($ho['remark']) : '<span class="muted">—</span>' ?></td>
                                <td><?php if ($sk === 'removed'): ?><span class="muted">—</span><?php else: ?><span class="tag normal"><?= h((string) ($ho['type'] ?? '')) ?></span><?php endif; ?></td>
                                <td class="es-key"><?= h((string) ($ho['key'] ?? '')) ?></td>
                            </tr>
                        <?php endforeach; ?>
                        </tbody>
                    </table>
                <?php endif; ?>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

<?php else: /* default: список источников + добавление */ ?>

    <section class="<?= coll_cls('extsub_about') ?>" data-coll="extsub_about">
        <button type="button" class="coll-head" onclick="collToggle(this)"><span>Что это</span>
            <span class="coll-hr"><svg width="30" height="30" class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
        </button>
        <div class="coll-body">
            <p class="muted" style="margin-top:0">Сохраните чужую подписку как источник — прослойка запросит её под UA реального клиента (Happ / v2rayNG / INCY), покажет хосты внутри, а выбранные можно импортировать в доп. конфиги, привязав к источнику. Позже — сверка дрифта и ре-синк изменившихся.</p>
        </div>
    </section>

    <section class="<?= coll_cls('extsub_add') ?>" data-coll="extsub_add">
        <button type="button" class="coll-head" onclick="collToggle(this)"><span>Добавить источник</span>
            <span class="coll-hr"><svg width="30" height="30" class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg></span>
        </button>
        <div class="coll-body">
            <form method="post" autocomplete="off">
                <input type="hidden" name="csrf" value="<?= h($token) ?>">
                <input type="hidden" name="action" value="extsub_add">
                <div class="sqcfg-grid">
                    <div>
                        <label for="es_name">Название</label>
                        <input type="text" id="es_name" name="name" maxlength="191" required placeholder="напр.: Резервный провайдер" style="width:100%;box-sizing:border-box">
                    </div>
                    <div>
                        <label for="es_url">URL подписки</label>
                        <input type="text" id="es_url" name="url" required placeholder="https://…" spellcheck="false" style="width:100%;box-sizing:border-box;font-family:monospace;font-size:.82rem">
                    </div>
                    <div>
                        <label for="es_ua">User-Agent (клиент)</label>
                        <select id="es_ua" name="ua" class="sqcfg-sel" style="width:100%;box-sizing:border-box">
                            <?php foreach ($es_ua_opts as $k => $disp): ?>
                                <option value="<?= h($k) ?>"><?= h($disp) ?></option>
                            <?php endforeach; ?>
                        </select>
                    </div>
                </div>
                <div style="margin-top:1rem">
                    <button type="submit" class="btn">Добавить источник</button>
                </div>
            </form>
        </div>
    </section>

    <div class="card">
        <div class="loghead"><h2>Источники (<?= count($extsub_list) ?>)</h2></div>
        <?php if (!$extsub_list): ?>
            <p class="muted">Пока нет источников. Добавьте первый выше.</p>
        <?php else: ?>
        <table class="logtbl">
            <thead><tr><th>Название</th><th>URL</th><th>UA</th><th>Последний запрос</th><th>Хостов</th><th></th></tr></thead>
            <tbody>
            <?php foreach ($extsub_list as $es):
                $es_status = (string) ($es['last_status'] ?? '');
                $es_error  = (string) ($es['last_error'] ?? '');
            ?>
            <tr>
                <td><?= h((string) $es['name']) ?></td>
                <td><span class="es-url" title="<?= h((string) $es['url']) ?>"><?= h((string) $es['url']) ?></span></td>
                <td><span class="es-badge mut"><?= h($es_ua_opts[strtolower((string) $es['ua'])] ?? (string) $es['ua']) ?></span></td>
                <td style="white-space:nowrap">
                    <?= h($es_ago($es['last_fetch_ts'] ?? 0)) ?>
                    <?php if ($es_status === 'ok'): ?> <span class="es-badge ok">ok</span><?php elseif ($es_status === 'error'): ?> <span class="es-badge warn" title="<?= h($es_error) ?>">ошибка</span><?php endif; ?>
                    <?php if ($es_status === 'error' && $es_error !== ''): ?><div class="muted" style="font-size:.74rem;margin-top:.2rem"><?= h($es_error) ?></div><?php endif; ?>
                </td>
                <td><?= (int) ($es['host_count'] ?? 0) ?></td>
                <td style="text-align:right;white-space:nowrap">
                    <a class="sqcfg-btn" href="index.php?tab=ext_import&src=<?= (int) $es['id'] ?>&view=hosts">Хосты</a>
                    <a class="sqcfg-btn" href="index.php?tab=ext_import&src=<?= (int) $es['id'] ?>&view=drift">Дрифт</a>
                    <form method="post" style="margin:0;display:inline" onsubmit="return uiConfirmForm(this,'Удалить источник? Импортированные хосты будут отвязаны.')">
                        <input type="hidden" name="csrf" value="<?= h($token) ?>">
                        <input type="hidden" name="action" value="extsub_del">
                        <input type="hidden" name="id" value="<?= (int) $es['id'] ?>">
                        <button type="submit" class="danger">🗑 Удалить</button>
                    </form>
                </td>
            </tr>
            <?php endforeach; ?>
            </tbody>
        </table>
        <?php endif; ?>
    </div>

<?php endif; ?>
