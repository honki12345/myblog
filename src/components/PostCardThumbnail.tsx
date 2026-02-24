"use client";

import { useCallback, useMemo, useState } from "react";

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

export default function PostCardThumbnail({
  src,
  alt,
}: PostCardThumbnailProps) {
  const normalizedSrc = useMemo(() => normalizeThumbnailSrc(src), [src]);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [errorSrc, setErrorSrc] = useState<string | null>(null);

  const isFallback =
    normalizedSrc === PLACEHOLDER_SRC || errorSrc === normalizedSrc;
  const state: ThumbnailState = isFallback
    ? "fallback"
    : loadedSrc === normalizedSrc
      ? "loaded"
      : "loading";
  const renderedSrc = isFallback ? PLACEHOLDER_SRC : normalizedSrc;
  const imgRef = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node) {
        return;
      }

      // If the image loaded (or errored) before hydration, onLoad/onError won't fire.
      // `complete + naturalWidth` lets us derive a settled state without a useEffect.
      if (renderedSrc === PLACEHOLDER_SRC || !node.complete) {
        return;
      }

      if (node.naturalWidth > 0) {
        setLoadedSrc((prev) => (prev === normalizedSrc ? prev : normalizedSrc));
        return;
      }

      setErrorSrc((prev) => (prev === normalizedSrc ? prev : normalizedSrc));
    },
    [normalizedSrc, renderedSrc],
  );

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800"
      data-post-thumbnail
      data-post-thumbnail-state={state}
    >
      {/* `next/image` requires configuring allowed remote hosts, but thumbnails may be arbitrary HTTPS URLs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={renderedSrc}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
        draggable={false}
        onLoad={() => {
          if (renderedSrc !== PLACEHOLDER_SRC) {
            setLoadedSrc(normalizedSrc);
          }
        }}
        onError={() => {
          if (normalizedSrc !== PLACEHOLDER_SRC) {
            setErrorSrc(normalizedSrc);
          }
        }}
      />
    </div>
  );
}
