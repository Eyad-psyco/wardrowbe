'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  CLOTHING_TYPES,
  CLOTHING_COLORS,
  OCCASIONS,
} from '@/lib/types';
import { usePreferences } from '@/lib/hooks/use-preferences';

const STYLE_VALUES = ['bold', 'casual', 'formal', 'minimalist', 'sporty'] as const;
const WEATHER_CONDITION_VALUES = ['clear', 'cloudy', 'rain', 'snow'] as const;

export function useClothingTypes() {
  const t = useTranslations('constants.types');
  const { data: preferences } = usePreferences();
  const customTypes = preferences?.custom_item_types;

  // Custom types keep their raw label - there is no i18n key to look up for a name
  // the user typed. Every type dropdown and the wardrobe type filter map over this
  // hook's result, so they pick the new types up with no edits.
  return useMemo(() => [
    ...CLOTHING_TYPES.map((ct) => ({ value: ct.value as string, label: t(ct.value) })),
    ...(customTypes || []).map((ct) => ({ value: ct.value, label: ct.label })),
  ], [t, customTypes]);
}

export function useClothingColors() {
  const t = useTranslations('constants.colors');

  return useMemo(() => CLOTHING_COLORS.map((cc) => ({
    ...cc,
    name: t(cc.value),
  })), [t]);
}

export function useOccasions() {
  const t = useTranslations('constants.occasions');

  return useMemo(() => OCCASIONS.map((o) => ({
    ...o,
    label: t(o.value),
  })), [t]);
}

export function useStyles() {
  const t = useTranslations('constants.styles');

  return useMemo(() => STYLE_VALUES.map((value) => ({
    value,
    label: t(value),
  })), [t]);
}

export function useWeatherConditions() {
  const t = useTranslations('constants.weatherConditions');

  return useMemo(() => WEATHER_CONDITION_VALUES.map((value) => ({
    value,
    label: t(value),
  })), [t]);
}
