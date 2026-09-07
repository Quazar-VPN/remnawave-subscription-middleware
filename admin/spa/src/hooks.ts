import { useCallback, useEffect, useState } from 'react';
import { ApiError } from './api';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  unauthorized: boolean;
  reload: () => void;
}

// Загрузка данных с состояниями loading/error и распознаванием 401 (сессия
// протухла) — вызывающий может показать экран логина.
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);
  const [nonce, setNonce] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    run()
      .then((d) => {
        if (alive) {
          setData(d);
          setUnauthorized(false);
        }
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiError && e.status === 401) setUnauthorized(true);
        else setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [run, nonce]);

  return { data, loading, error, unauthorized, reload: () => setNonce((n) => n + 1) };
}

// Активная вкладка живёт в ?tab= — совместимо с легаси-семантикой и переживает
// перезагрузку. Возвращает [tab, setTab].
export function useTab(fallback: string): [string, (t: string) => void] {
  const read = () => new URLSearchParams(window.location.search).get('tab') || fallback;
  const [tab, setTabState] = useState(read);

  useEffect(() => {
    const onPop = () => setTabState(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTab = (t: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', t);
    window.history.pushState({}, '', url);
    setTabState(t);
  };

  return [tab, setTab];
}
