import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import LoginPage from '@/app/login/page';
import { getProviders } from 'next-auth/react';

// Which providers NextAuth reports decides which form the page shows. Exactly
// one credential form must ever be visible: before this test the dev shortcut
// and the real password form rendered together in development.
const mockProviders = vi.mocked(getProviders);

vi.mock('next-auth/react', () => ({
  getProviders: vi.fn(),
  signIn: vi.fn(),
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('next-intl', () => ({
  // Return the key so assertions do not depend on copy.
  useTranslations: () => {
    const t = (key: string) => key;
    t.rich = (key: string) => key;
    return t;
  },
}));

const providers = (...ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, { id, name: id }]));

// The page calls /auth/status (backend health) and /auth/config (self-signup
// flag) with plain fetch, distinct from the NextAuth provider mock above.
function mockBackend({ selfSignupEnabled = false } = {}) {
  global.fetch = vi.fn((url: string) => {
    if (url.includes('/auth/config')) {
      return Promise.resolve({ json: async () => ({ self_signup_enabled: selfSignupEnabled }) });
    }
    return Promise.resolve({ json: async () => ({ configured: true, mode: 'password' }) });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBackend();
});

const passwordFields = () => screen.queryAllByLabelText('password');
const devOnlyField = () => screen.queryByLabelText('displayName');

describe('login page form selection', () => {
  it('shows only the password form when dev login is also registered', async () => {
    mockProviders.mockResolvedValue(providers('password', 'dev-credentials') as never);

    render(<LoginPage />);

    await waitFor(() => expect(passwordFields().length).toBe(1));
    // The dev form is distinguishable by its display-name field.
    expect(devOnlyField()).toBeNull();
  });

  it('falls back to the dev form when password auth is off', async () => {
    mockProviders.mockResolvedValue(providers('dev-credentials') as never);

    render(<LoginPage />);

    await waitFor(() => expect(devOnlyField()).not.toBeNull());
    expect(passwordFields().length).toBe(0);
  });

  it('shows the password form alongside SSO without a second credential form', async () => {
    mockProviders.mockResolvedValue(
      providers('password', 'oidc', 'dev-credentials') as never
    );

    render(<LoginPage />);

    await waitFor(() => expect(passwordFields().length).toBe(1));
    expect(devOnlyField()).toBeNull();
  });

  it('reports nothing configured when no provider is registered', async () => {
    mockProviders.mockResolvedValue({} as never);

    render(<LoginPage />);

    await waitFor(() => expect(screen.getByText('unconfigured.title')).toBeDefined());
    expect(passwordFields().length).toBe(0);
    expect(devOnlyField()).toBeNull();
  });
});

describe('login page signup link', () => {
  it('is hidden when self-signup is off', async () => {
    mockProviders.mockResolvedValue(providers('password') as never);
    mockBackend({ selfSignupEnabled: false });

    render(<LoginPage />);

    await waitFor(() => expect(passwordFields().length).toBe(1));
    expect(screen.queryByText('signUp')).toBeNull();
  });

  it('appears when self-signup is on', async () => {
    mockProviders.mockResolvedValue(providers('password') as never);
    mockBackend({ selfSignupEnabled: true });

    render(<LoginPage />);

    await waitFor(() => expect(screen.queryByText('signUp')).not.toBeNull());
  });

  it('is hidden when only OIDC is configured, even if self-signup is on', async () => {
    mockProviders.mockResolvedValue(providers('oidc') as never);
    mockBackend({ selfSignupEnabled: true });

    render(<LoginPage />);

    await waitFor(() => expect(screen.getByRole('button')).toBeDefined());
    expect(screen.queryByText('signUp')).toBeNull();
  });
});
