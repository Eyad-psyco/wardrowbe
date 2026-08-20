// Curated icon set for clothing-type categories, plus BUILTIN_TYPE_ICONS mapping
// built-in type values to a matching icon. Keep the icon *names* in sync with
// ALLOWED_TYPE_ICONS in backend/app/utils/clothing.py.
import type { ComponentType } from 'react';
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
} from 'lucide-react';

type IconComponent = ComponentType<{ className?: string }>;

// lucide-react has no literal shapes for these garments, so these are hand-drawn
// to match its conventions: 24x24 grid, currentColor stroke, 2px, round caps/joins.
function createIcon(paths: string[]): IconComponent {
  return function CustomTypeIcon({ className }: { className?: string }) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        {paths.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </svg>
    );
  };
}

const Pants = createIcon(['M5 3h14l-1 18h-4l-1-11-1 11H6L5 3Z']);
const Shorts = createIcon(['M5 3h14l-1 11h-4l-1-2-1 2H6L5 3Z']);
const Skirt = createIcon(['M9 3h6l3 18H6L9 3Z']);
const Dress = createIcon(['M8 3h8l-1 6 3 12H6l3-12-1-6Z']);
const Jacket = createIcon(['M9 3H15L19 9 16 10 16 21H8L8 10 5 9Z']);
const Cardigan = createIcon(['M9 3H15L19 9 16 10 16 21H8L8 10 5 9Z', 'M12 3v18']);
const Sock = createIcon(['M9 2h5v11h6v5H9V2Z']);
const Tie = createIcon(['M10 2h4l-1 4 4 14-5 2-5-2 4-14-1-4Z']);
const Hat = createIcon(['M3 13h18', 'M7 13v-3a5 4 0 0 1 10 0v3']);
const Scarf = createIcon(['M4 8l16 8', 'M4 8l3-2', 'M4 8l1 3', 'M20 16l-3 2', 'M20 16l-1-3']);
const Belt = createIcon(['M2 12h6M16 12h6', 'M8 9h8v6H8Z', 'M12 10v4']);

export const TYPE_ICON_OPTIONS: { name: string; Icon: IconComponent }[] = [
  { name: 'Shirt', Icon: Shirt },
  { name: 'Pants', Icon: Pants },
  { name: 'Shorts', Icon: Shorts },
  { name: 'Skirt', Icon: Skirt },
  { name: 'Dress', Icon: Dress },
  { name: 'Jacket', Icon: Jacket },
  { name: 'Cardigan', Icon: Cardigan },
  { name: 'Sock', Icon: Sock },
  { name: 'Tie', Icon: Tie },
  { name: 'Hat', Icon: Hat },
  { name: 'Scarf', Icon: Scarf },
  { name: 'Belt', Icon: Belt },
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

export function getTypeIcon(name?: string | null): IconComponent {
  return ICON_MAP.get(name || '') ?? Shirt;
}

// Matches CLOTHING_TYPES in lib/types.ts. Several garments share a silhouette
// (e.g. every jacket-like outer layer) rather than getting a bespoke icon each.
export const BUILTIN_TYPE_ICONS: Record<string, string> = {
  accessories: 'Gem',
  bag: 'ShoppingBag',
  belt: 'Belt',
  blazer: 'Jacket',
  blouse: 'Shirt',
  boots: 'Footprints',
  cardigan: 'Cardigan',
  coat: 'Jacket',
  dress: 'Dress',
  hat: 'Hat',
  hoodie: 'Jacket',
  jacket: 'Jacket',
  jeans: 'Pants',
  jumpsuit: 'Dress',
  pants: 'Pants',
  polo: 'Shirt',
  sandals: 'Footprints',
  scarf: 'Scarf',
  shirt: 'Shirt',
  shoes: 'Footprints',
  shorts: 'Shorts',
  skirt: 'Skirt',
  sneakers: 'Footprints',
  socks: 'Sock',
  suit: 'Jacket',
  sweater: 'Shirt',
  't-shirt': 'Shirt',
  'tank-top': 'Shirt',
  tie: 'Tie',
  top: 'Shirt',
  vest: 'Cardigan',
};

export function getBuiltinTypeIcon(value: string): string {
  return BUILTIN_TYPE_ICONS[value] ?? DEFAULT_TYPE_ICON;
}
