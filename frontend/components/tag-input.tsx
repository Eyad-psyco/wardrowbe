'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 30;
const MAX_SUGGESTIONS = 8;

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
  // Already ordered by frequency server-side (get_tag_distribution), so never re-sort.
  suggestions?: Array<{ tag: string; count: number }>;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);

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

  // An empty draft lists everything, so clicking the field is enough to browse the tags.
  const needle = normalize(draft);
  const matches = suggestions
    .filter((s) => (!needle || s.tag.includes(needle)) && !value.includes(s.tag))
    .slice(0, MAX_SUGGESTIONS);

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
      <div className="relative">
        <Input
          value={draft}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
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
            } else if (e.key === 'Escape') {
              setFocused(false);
            } else if (e.key === 'Backspace' && !draft && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => {
            setFocused(false);
            commitMany([draft]);
          }}
        />
        {focused && matches.length > 0 && (
          // Floating so opening the list doesn't reflow the filter row underneath it.
          <div className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-md border bg-popover shadow-md">
            {matches.map(({ tag, count }) => (
              <button
                key={tag}
                type="button"
                className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent"
                // Keeps focus on the input so onBlur doesn't first commit the partial
                // draft as a tag of its own.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commitMany([tag])}
              >
                <span className="truncate">{tag}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
