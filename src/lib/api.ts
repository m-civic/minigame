declare global {
  interface Window {
    __MINIGAME_CONFIG__?: { apiBaseUrl?: string };
  }
}

export function apiUrl(path: string): string {
  const runtimeBase = typeof window === 'undefined' ? undefined : window.__MINIGAME_CONFIG__?.apiBaseUrl;
  const base = (runtimeBase || import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/+$/, '');
  return `${base}${path.replace(/^\/api(?=\/|$)/, '')}`;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), init);
}
