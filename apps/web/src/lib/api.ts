export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api/v1'
).replace(/\/$/u, '');

export interface ApiErrorEnvelope {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly requestId?: string;
  };
}
export async function apiData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { readonly data?: T } & ApiErrorEnvelope;
  if (!response.ok || body.data === undefined) {
    const error = new Error(body.error?.message ?? 'The request could not be completed');
    Object.assign(error, {
      status: response.status,
      code: body.error?.code ?? 'REQUEST_FAILED',
      requestId: body.error?.requestId,
    });
    throw error;
  }
  return body.data;
}

export function requestError(error: unknown): {
  readonly status: number;
  readonly message: string;
  readonly requestId?: string;
} {
  if (!error || typeof error !== 'object') {
    return { status: 0, message: 'Something went wrong.' };
  }
  const candidate = error as { status?: unknown; message?: unknown; requestId?: unknown };
  return {
    status: typeof candidate.status === 'number' ? candidate.status : 0,
    message:
      typeof candidate.message === 'string' ? candidate.message : 'Something went wrong.',
    ...(typeof candidate.requestId === 'string' ? { requestId: candidate.requestId } : {}),
  };
}
