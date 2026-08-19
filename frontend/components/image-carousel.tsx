'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface CarouselImage {
  id: string;
  url: string;
}

// Only the active slide is mounted, so a 100-item page doesn't fetch 500 images.
export function ImageCarousel({
  images,
  alt,
  className,
  sizes,
  index,
  onIndexChange,
}: {
  images: CarouselImage[];
  alt: string;
  className?: string;
  sizes?: string;
  index?: number;
  onIndexChange?: (index: number) => void;
}) {
  const [internalIndex, setInternalIndex] = useState(0);
  const activeIndex = index ?? internalIndex;
  const setActiveIndex = onIndexChange ?? setInternalIndex;

  if (images.length === 0) return null;

  const current = images[activeIndex] || images[0];

  // The wardrobe card wraps the whole tile in a click target that opens the detail
  // dialog, so arrows and dots must not bubble.
  const stop = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  return (
    <>
      <Image
        key={current.id}
        src={current.url}
        alt={alt}
        fill
        className={className ?? 'object-cover'}
        sizes={sizes}
      />
      {images.length > 1 && (
        <>
          <button
            className="absolute left-1 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full p-1 hover:bg-black/70 z-10"
            onClick={(e) => {
              stop(e);
              setActiveIndex((activeIndex - 1 + images.length) % images.length);
            }}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            className="absolute right-1 top-1/2 -translate-y-1/2 bg-black/50 text-white rounded-full p-1 hover:bg-black/70 z-10"
            onClick={(e) => {
              stop(e);
              setActiveIndex((activeIndex + 1) % images.length);
            }}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 z-10">
            {images.map((img, idx) => (
              <button
                key={img.id}
                className={`w-1.5 h-1.5 rounded-full ${idx === activeIndex ? 'bg-white' : 'bg-white/50'}`}
                onClick={(e) => {
                  stop(e);
                  setActiveIndex(idx);
                }}
              />
            ))}
          </div>
        </>
      )}
    </>
  );
}
