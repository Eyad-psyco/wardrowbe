'use client';

import { Suspense, useState } from 'react';
import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

function RegisterContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const t = useTranslations('auth');

  // Accounts are invite-only; the email is carried inside the signed token, so
  // there is nothing useful to show without one.
  if (!token) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm">
        <p className="font-medium text-destructive">{t('register.missingInvite')}</p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError(t('register.passwordMismatch'));
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invite_token: token,
          password,
          display_name: displayName,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.detail || t('register.failed'));
        setIsLoading(false);
        return;
      }

      // The account exists now; sign in with it to establish the session.
      await signIn('password', {
        email: data.email,
        password,
        callbackUrl: '/dashboard',
      });
    } catch {
      setError(t('register.failed'));
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-md bg-destructive/15 p-4 text-sm text-destructive">{error}</div>
      )}
      <div className="space-y-2">
        <label htmlFor="display-name" className="block text-sm font-medium">
          {t('displayName')}
        </label>
        <input
          id="display-name"
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          maxLength={100}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={t('namePlaceholder')}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="new-password" className="block text-sm font-medium">
          {t('password')}
        </label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={5}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="text-xs text-muted-foreground">{t('register.passwordHint')}</p>
      </div>
      <div className="space-y-2">
        <label htmlFor="confirm-password" className="block text-sm font-medium">
          {t('register.confirmPassword')}
        </label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <button
        type="submit"
        disabled={isLoading}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-3 text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('register.creating')}
          </>
        ) : (
          t('register.submit')
        )}
      </button>
    </form>
  );
}

export default function RegisterPage() {
  const t = useTranslations('auth');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold">{t('register.title')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('register.subtitle')}</p>
        </div>
        <Suspense
          fallback={
            <div className="space-y-4 animate-pulse">
              <div className="h-12 bg-muted rounded-md" />
            </div>
          }
        >
          <RegisterContent />
        </Suspense>
      </div>
    </main>
  );
}
