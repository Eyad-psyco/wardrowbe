import { NextAuthOptions } from 'next-auth';
import type { OAuthConfig } from 'next-auth/providers/oauth';
import CredentialsProvider from 'next-auth/providers/credentials';

interface OIDCProfile {
  sub: string;
  name?: string;
  preferred_username?: string;
  email?: string;
  picture?: string;
}

const OIDCProvider: OAuthConfig<OIDCProfile> = {
  id: 'oidc',
  name: 'SSO',
  type: 'oauth',
  wellKnown: `${process.env.OIDC_ISSUER_URL?.replace(/\/+$/, '')}/.well-known/openid-configuration`,
  clientId: process.env.OIDC_CLIENT_ID!,
  clientSecret: process.env.OIDC_CLIENT_SECRET!,
  authorization: {
    params: {
      scope: 'openid email profile',
    },
  },
  checks: ['pkce', 'state'],
  async profile(profile, tokens) {
    let email = profile.email;
    let name = profile.name || profile.preferred_username;

    if (!email && tokens.access_token && process.env.OIDC_ISSUER_URL) {
      try {
        const issuer = process.env.OIDC_ISSUER_URL.replace(/\/+$/, '');
        const discoveryRes = await fetch(`${issuer}/.well-known/openid-configuration`);
        if (discoveryRes.ok) {
          const discovery = await discoveryRes.json() as { userinfo_endpoint?: string };
          if (discovery.userinfo_endpoint) {
            const infoRes = await fetch(discovery.userinfo_endpoint, {
              headers: { Authorization: `Bearer ${tokens.access_token}` },
            });
            if (infoRes.ok) {
              const info = await infoRes.json() as { email?: string; name?: string; preferred_username?: string };
              email = info.email;
              name = name || info.name || info.preferred_username;
            }
          }
        }
      } catch {}
    }

    return {
      id: profile.sub,
      name,
      email,
      image: profile.picture,
    };
  },
};

// Dev credentials provider - for local development only
const DevCredentialsProvider = CredentialsProvider({
  id: 'dev-credentials',
  name: 'Dev Login',
  credentials: {
    email: { label: 'Email', type: 'email', placeholder: 'dev@example.com' },
    name: { label: 'Name', type: 'text', placeholder: 'Dev User' },
  },
  async authorize(credentials) {
    if (!credentials?.email) {
      return null;
    }

    // In dev mode, accept any email/name combination
    const email = credentials.email;
    const name = credentials.name || email.split('@')[0];
    const id = email.replace(/[^a-z0-9]/gi, '-').toLowerCase();

    return {
      id,
      email,
      name,
      image: null,
    };
  },
});
// Email + password against the backend's own account store. The backend owns
// the credential check and issues the API token, so this provider does not go
// through /auth/sync the way OIDC and dev login do.
const PasswordProvider = CredentialsProvider({
  id: 'password',
  name: 'Email and password',
  credentials: {
    email: { label: 'Email', type: 'email', placeholder: 'you@example.com' },
    password: { label: 'Password', type: 'password' },
  },
  async authorize(credentials) {
    if (!credentials?.email || !credentials?.password) {
      return null;
    }

    const apiUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:8000';

    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: credentials.email,
          password: credentials.password,
        }),
      });

      if (!response.ok) {
        // Wrong credentials, inactive account, or rate limited. Deliberately
        // indistinguishable to the caller.
        return null;
      }

      const data = await response.json();
      return {
        id: data.external_id,
        email: data.email,
        name: data.display_name,
        image: null,
        backendToken: data.access_token,
        onboardingCompleted: data.onboarding_completed,
      };
    } catch (error) {
      console.error('Password sign-in failed:', error);
      return null;
    }
  },
});

// Determine which provider to use
function getProviders() {
  const providers = [];

  if (process.env.OIDC_ISSUER_URL) {
    providers.push(OIDCProvider);
  }

  if (process.env.DEV_MODE === 'true' || process.env.NODE_ENV === 'development') {
    providers.push(DevCredentialsProvider);
  }

  // On unless explicitly disabled, mirroring the backend's PASSWORD_AUTH_ENABLED.
  if (process.env.PASSWORD_AUTH_ENABLED !== 'false') {
    providers.push(PasswordProvider);
  }
  return providers;
}

export const authOptions: NextAuthOptions = {
  providers: getProviders(),
  callbacks: {
    async jwt({ token, user, account, trigger }) {
      const apiUrl = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || 'http://backend:8000';

      // Session update triggered - refresh user data from backend
      if (trigger === 'update' && token.accessToken) {
        try {
          const response = await fetch(`${apiUrl}/api/v1/users/me`, {
            headers: {
              'Authorization': `Bearer ${token.accessToken}`,
            },
          });

          if (response.ok) {
            const userData = await response.json();
            return {
              ...token,
              onboardingCompleted: userData.onboarding_completed,
            };
          }
        } catch (error) {
          console.error('Failed to refresh user data:', error);
        }
        return token;
      }

      // Initial sign in - sync with backend and get API token
      if (user) {
        // Password sign-in already carries a backend token from /auth/login;
        // /auth/sync would reject it (no id_token, not dev mode).
        const passwordToken = (user as { backendToken?: string }).backendToken;
        if (passwordToken) {
          return {
            ...token,
            accessToken: passwordToken,
            sub: user.id,
            backendUserId: user.id,
            isNewUser: false,
            onboardingCompleted:
              (user as { onboardingCompleted?: boolean }).onboardingCompleted ?? false,
          };
        }

        try {
          const response = await fetch(`${apiUrl}/api/v1/auth/sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              external_id: user.id,
              email: user.email,
              display_name: user.name || user.email?.split('@')[0] || 'User',
              avatar_url: user.image,
              id_token: account?.id_token,
            }),
          });

          if (response.ok) {
            const syncData = await response.json();
            return {
              ...token,
              accessToken: syncData.access_token,
              sub: user.id,
              backendUserId: syncData.id,
              isNewUser: syncData.is_new_user,
              onboardingCompleted: syncData.onboarding_completed,
            };
          }

          const errorData = await response.json().catch(() => ({}));
          const syncError = errorData.detail || `Backend sync failed (${response.status})`;
          console.error('Failed to sync user to backend:', syncError);
          return {
            ...token,
            sub: user.id,
            syncError,
          };
        } catch (error) {
          console.error('Failed to sync user to backend:', error);
        }

        return {
          ...token,
          sub: user.id,
          syncError: 'Unable to connect to backend server',
        };
      }
      return token;
    },
    async session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub,
        },
        accessToken: token.accessToken,
        isNewUser: token.isNewUser,
        onboardingCompleted: token.onboardingCompleted,
        syncError: token.syncError,
      };
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  session: {
    strategy: 'jwt',
  },
  secret: process.env.NEXTAUTH_SECRET,
};
