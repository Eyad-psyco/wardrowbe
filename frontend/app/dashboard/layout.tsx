'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Sidebar } from '@/components/sidebar';
import { MobileSidebar } from '@/components/mobile-sidebar';
import { MobileNav } from '@/components/mobile-nav';
import { Header } from '@/components/header';
import { OfflineIndicator } from '@/components/offline-indicator';
import { UploadQueueIndicator } from '@/components/upload-queue-indicator';
import { ImageLightbox } from '@/components/image-lightbox';
import { LightboxProvider } from '@/lib/lightbox-context';
import { useAuth } from '@/lib/hooks/use-auth';

// If auth resolution hangs (stale session cookie, a wedged fetch), this is the
// only way out of the spinner otherwise offered to the user.
const STUCK_LOADING_MS = 8000;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const t = useTranslations('dashboard');

  const { user, isAuthenticated, isLoading, error } = useAuth();
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    // If auth check completed and user is not authenticated, redirect to login
    if (!isLoading && !isAuthenticated) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  // Check onboarding status from API user
  useEffect(() => {
    if (user && user.onboarding_completed === false) {
      router.push('/onboarding');
    }
  }, [user, router]);

  useEffect(() => {
    if (!isLoading) {
      setStuck(false);
      return;
    }
    const timer = setTimeout(() => setStuck(true), STUCK_LOADING_MS);
    return () => clearTimeout(timer);
  }, [isLoading]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('layout.loading')}</p>
          {stuck && (
            <div className="flex flex-col items-center gap-2 pt-2 text-center">
              <p className="text-sm text-muted-foreground">{t('layout.stuckMessage')}</p>
              <button
                type="button"
                onClick={() => signOut({ callbackUrl: '/login' })}
                className="text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('layout.stuckSignIn')}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <LightboxProvider>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <MobileSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="lg:pl-72">
          <Header onMenuClick={() => setSidebarOpen(true)} />
          <main className="py-6 px-4 sm:px-6 lg:px-8 pb-20 lg:pb-6 overflow-x-hidden">
            {children}
          </main>
        </div>
        <MobileNav />
        <OfflineIndicator />
        <UploadQueueIndicator />
        <ImageLightbox />
      </div>
    </LightboxProvider>
  );
}
