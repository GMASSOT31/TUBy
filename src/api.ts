// Tous les échanges avec la base passent par /api/* (cookies de session HttpOnly).

export class ApiError extends Error {
  constructor(public status: number, message: string, public data: unknown = null) {
    super(message)
  }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api/${path}`, {
      method: options.method ?? (options.body !== undefined ? 'POST' : 'GET'),
      headers: options.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError(0, 'Pas de connexion. Vérifie ton internet et réessaie.')
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error || 'Une erreur est survenue.', data)
  return data as T
}

export const POLL_MS = 20_000
