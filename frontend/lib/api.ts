const API_BASE_PATH = '/api/v1';

interface FetchOptions extends RequestInit {
  params?: Record<string, string>;
}

class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

class NetworkError extends Error {
  constructor(message: string = 'Network error. Please check your connection.') {
    super(message);
    this.name = 'NetworkError';
  }
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

async function fetchApi<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;

  let url = `${API_BASE_PATH}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams(params);
    url += `?${searchParams.toString()}`;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...fetchOptions,
      headers,
      credentials: 'include',
    });
  } catch (err) {
    if (!navigator.onLine) {
      throw new NetworkError('You appear to be offline. Please check your connection.');
    }
    throw new NetworkError('Unable to connect to server. Please try again.');
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(errorMessageFrom(data, 'An error occurred'), response.status, data);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

export const api = {
  get: <T>(endpoint: string, options?: FetchOptions) =>
    fetchApi<T>(endpoint, { ...options, method: 'GET' }),

  post: <T>(endpoint: string, data?: unknown, options?: FetchOptions) =>
    fetchApi<T>(endpoint, {
      ...options,
      method: 'POST',
      body: data ? JSON.stringify(data) : undefined,
    }),

  patch: <T>(endpoint: string, data?: unknown, options?: FetchOptions) =>
    fetchApi<T>(endpoint, {
      ...options,
      method: 'PATCH',
      body: data ? JSON.stringify(data) : undefined,
    }),

  delete: <T>(endpoint: string, options?: FetchOptions) =>
    fetchApi<T>(endpoint, { ...options, method: 'DELETE' }),
};

/**
 * Pull a human message out of a FastAPI error body.
 *
 * `detail` is a plain string for most endpoints but an object for the ones that
 * hand back structured data (duplicate uploads), and dropping the object straight
 * into `new Error()` renders it as "[object Object]".
 */
export function errorMessageFrom(
  data: { detail?: string | { message?: string }; error?: { message?: string } } | undefined,
  fallback: string
): string {
  return (
    (typeof data?.detail === 'string' ? data.detail : data?.detail?.message) ||
    data?.error?.message ||
    fallback
  );
}

const handledErrors = new WeakSet<object>();

export function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') handledErrors.add(error);
  if (error instanceof ApiError && error.status < 500) return error.message;
  return fallback;
}

export function isErrorHandled(error: unknown): boolean {
  return error !== null && typeof error === 'object' && handledErrors.has(error);
}

export { ApiError, NetworkError };
