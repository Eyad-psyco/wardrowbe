// Curated icon set for clothing-type categories. Keep this list in sync with
// ALLOWED_TYPE_ICONS in backend/app/utils/clothing.py.
import {
  Shirt,
  ShoppingBag,
  Footprints,
  Watch,
  Glasses,
  Crown,
  Gem,
  Umbrella,
  Scissors,
  Palette,
  Star,
  Heart,
  Tag,
  Layers,
  Package,
  Sparkles,
  Backpack,
  Briefcase,
  Gift,
  CircleDot,
  type LucideIcon,
} from 'lucide-react';

export const TYPE_ICON_OPTIONS: { name: string; Icon: LucideIcon }[] = [
  { name: 'Shirt', Icon: Shirt },
  { name: 'ShoppingBag', Icon: ShoppingBag },
  { name: 'Footprints', Icon: Footprints },
  { name: 'Watch', Icon: Watch },
  { name: 'Glasses', Icon: Glasses },
  { name: 'Crown', Icon: Crown },
  { name: 'Gem', Icon: Gem },
  { name: 'Umbrella', Icon: Umbrella },
  { name: 'Scissors', Icon: Scissors },
  { name: 'Palette', Icon: Palette },
  { name: 'Star', Icon: Star },
  { name: 'Heart', Icon: Heart },
  { name: 'Tag', Icon: Tag },
  { name: 'Layers', Icon: Layers },
  { name: 'Package', Icon: Package },
  { name: 'Sparkles', Icon: Sparkles },
  { name: 'Backpack', Icon: Backpack },
  { name: 'Briefcase', Icon: Briefcase },
  { name: 'Gift', Icon: Gift },
  { name: 'CircleDot', Icon: CircleDot },
];

const ICON_MAP = new Map(TYPE_ICON_OPTIONS.map((o) => [o.name, o.Icon]));

export const DEFAULT_TYPE_ICON = 'Shirt';

export function getTypeIcon(name?: string | null): LucideIcon {
  return ICON_MAP.get(name || '') ?? Shirt;
}
