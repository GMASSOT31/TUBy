export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message)
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  })
}

export async function body<T = Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const data = await request.json()
    if (data && typeof data === 'object') return data as T
  } catch { /* corps invalide */ }
  throw new HttpError(400, 'Requête invalide.')
}

export const str = (v: unknown, max = 5000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
export const int = (v: unknown): number => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new HttpError(400, 'Identifiant invalide.')
  return n
}
