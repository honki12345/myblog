"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback } from "react";

function isPlainLeftClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  if (event.button !== 0) {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  return true;
}

function scrollToTop(): void {
  const prefersReducedMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  )?.matches;

  window.scrollTo({
    top: 0,
    left: 0,
    behavior: prefersReducedMotion ? "auto" : "smooth",
  });
}

type HomeTitleLinkProps = {
  className?: string;
  children: React.ReactNode;
};

export default function HomeTitleLink({
  className,
  children,
}: HomeTitleLinkProps) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!isHome) {
        return;
      }

      if (!isPlainLeftClick(event)) {
        return;
      }

      event.preventDefault();
      scrollToTop();
    },
    [isHome],
  );

  const focusStyles =
    "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white";
  const mergedClassName = className
    ? `${className} ${focusStyles}`
    : focusStyles;

  return (
    <Link
      href="/"
      className={mergedClassName}
      aria-label="홈 (honki12345 블로그)"
      aria-current={isHome ? "page" : undefined}
      onClick={handleClick}
    >
      {children}
    </Link>
  );
}
