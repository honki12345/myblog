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

function buildHomeAriaLabel(children: React.ReactNode): string {
  if (typeof children === "string") {
    const trimmed = children.trim();
    if (trimmed.length > 0) {
      return `홈 (${trimmed})`;
    }
  }

  return "홈";
}

type HomeTitleLinkProps = {
  ariaLabel?: string;
  className?: string;
  children: React.ReactNode;
};

export default function HomeTitleLink({
  ariaLabel,
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
      aria-label={ariaLabel ?? buildHomeAriaLabel(children)}
      aria-current={isHome ? "page" : undefined}
      onClick={handleClick}
    >
      {children}
    </Link>
  );
}
