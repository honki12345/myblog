"use client";

import { useMemo, useState } from "react";

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

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
      data-post-thumbnail
      data-post-thumbnail-state={state}
    >
      {/* `next/image` requires configuring allowed remote hosts, but thumbnails may be arbitrary HTTPS URLs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
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
