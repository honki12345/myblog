"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type ThumbnailState = "loading" | "loaded" | "fallback";

type PostCardThumbnailProps = {
  src: string;
  alt: string;
};

const PLACEHOLDER_SRC = "/thumbnail-placeholder.svg";

function normalizeThumbnailSrc(src: string): string {
  const trimmed = src.trim();
  return trimmed.length > 0 ? trimmed : PLACEHOLDER_SRC;
}

export default function PostCardThumbnail({ src, alt }: PostCardThumbnailProps) {
  const normalizedSrc = useMemo(() => normalizeThumbnailSrc(src), [src]);
  const initialState: ThumbnailState =
    normalizedSrc === PLACEHOLDER_SRC ? "fallback" : "loading";
  const [currentSrc, setCurrentSrc] = useState(normalizedSrc);
  const [state, setState] = useState<ThumbnailState>(initialState);
  const imgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    setCurrentSrc(normalizedSrc);
    setState(normalizedSrc === PLACEHOLDER_SRC ? "fallback" : "loading");
  }, [normalizedSrc]);

  useEffect(() => {
    if (currentSrc === PLACEHOLDER_SRC) {
      setState("fallback");
      return;
    }

    const img = imgRef.current;
    if (!img || !img.complete) {
      return;
    }

    if (img.naturalWidth > 0) {
      setState("loaded");
    } else {
      setCurrentSrc(PLACEHOLDER_SRC);
      setState("fallback");
    }
  }, [currentSrc]);

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
      data-post-thumbnail
      data-post-thumbnail-state={state}
    >
      <img
        ref={imgRef}
        src={currentSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
        draggable={false}
        onLoad={() => {
          if (currentSrc !== PLACEHOLDER_SRC) {
            setState("loaded");
          }
        }}
        onError={() => {
          if (currentSrc !== PLACEHOLDER_SRC) {
            setCurrentSrc(PLACEHOLDER_SRC);
            setState("fallback");
          }
        }}
      />
    </div>
  );
}

