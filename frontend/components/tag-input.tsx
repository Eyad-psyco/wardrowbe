'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;

// Mirrors the backend normalizer (schemas/item.py) so a chip reads the same before
// and after the round trip.
function normalize(raw: string): string {
  return raw.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
}

export function TagInput({
  value,
  onChange,
  suggestions = [],
  placeholder,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  // Batched, not one onChange per tag: a pasted "a, b, c" would otherwise fire three
  // updates against the same stale `value` and keep only the last.
  const commitMany = (raws: string[]) => {
    const next = [...value];
    for (const raw of raws) {
      const tag = normalize(raw);
      if (tag && !next.includes(tag) && next.length < MAX_TAGS) next.push(tag);
    }
    setDraft('');
    if (next.length !== value.length) onChange(next);
  };

  const matches = draft
    ? suggestions
        .filter((s) => s.includes(normalize(draft)) && !value.includes(s))
        .slice(0, 6)
    : [];

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button type="button" onClick={() => onChange(value.filter((t) => t !== tag))}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => {
          // A pasted "a, b, c" commits every complete tag and leaves the tail in the draft.
          if (e.target.value.includes(',')) {
            const parts = e.target.value.split(',');
            commitMany(parts.slice(0, -1));
            setDraft(parts[parts.length - 1]);
            return;
          }
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitMany([draft]);
          } else if (e.key === 'Backspace' && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => commitMany([draft])}
      />
      {matches.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {matches.map((tag) => (
            <Badge
              key={tag}
              variant="outline"
              className="cursor-pointer hover:bg-accent"
              // Keeps focus on the input so onBlur doesn't first commit the partial
              // draft as a tag of its own.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commitMany([tag])}
            >
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
