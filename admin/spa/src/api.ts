// Тонкий клиент к admin/api.php. Сессия — тот же cookie submw_admin, что и у
// легаси-админки, поэтому логин общий в обе стороны. CSRF-токен берём из
// bootstrap и шлём в заголовке X-CSRF на всех POST.

export const API = '/admin/api.php';

let csrf = '';
export function setCsrf(token: string) {
  csrf = token;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(method: 'GET' | 'POST', params: Record<string, string>, body?: unknown): Promise<T> {
  const url = API + '?' + new URLSearchParams(params).toString();
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (method === 'POST') {
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
    (init.headers as Record<string, string>)['X-CSRF'] = csrf;
    init.body = JSON.stringify(body ?? {});
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new ApiError('Сеть недоступна', 0);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError('Некорректный ответ сервера', res.status);
  }
  if (res.status === 401) {
    throw new ApiError('unauthorized', 401);
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error || `Ошибка ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export function apiGet<T>(resource: string, extra: Record<string, string> = {}): Promise<T> {
  return call<T>('GET', { r: resource, ...extra });
}

export function apiPost<T>(resource: string, body: unknown = {}): Promise<T> {
  return call<T>('POST', { r: resource }, body);
}

// --- Типы ответов ---

export interface Bootstrap {
  installed: boolean;
  authed: boolean;
  csrf: string;
  version: string;
  php: string;
  mode: 'panel' | 'mirror';
  panel_url: string;
  legacy_url: string;
}

export function fetchBootstrap(): Promise<Bootstrap> {
  return apiGet<Bootstrap>('bootstrap');
}

export function login(user: string, pass: string): Promise<{ ok: boolean; error?: string; locked?: boolean }> {
  return apiPost('login', { user, pass });
}

export function logout(): Promise<{ ok: boolean }> {
  return apiPost('logout');
}
