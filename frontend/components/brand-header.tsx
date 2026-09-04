'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { APP_VERSION } from '@/lib/app-version';

interface BrandHeaderProps {
  onNavigate?: () => void;
}

export function BrandHeader({ onNavigate }: BrandHeaderProps) {
  const t = useTranslations('nav');

  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-3"
      onClick={onNavigate}
    >
      <img src="/logo.svg" alt={t('brandAlt')} className="h-8 w-8" />
      <span className="text-xl font-bold">{t('brandName')}</span>
      <span
        className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground"
        aria-label={`Version ${APP_VERSION}`}
      >
        v{APP_VERSION}
      </span>
    </Link>
  );
}
