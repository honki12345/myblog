"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { adminFetch, getAdminCsrfToken } from "@/lib/admin-client";

function buildNextPath(pathname: string, search: string): string {
  if (!pathname) {
    return "/";
  }
  if (!search) {
    return pathname;
  }
  return `${pathname}?${search}`;
}

export default function AdminAuthNavButton() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = useMemo(() => searchParams.toString(), [searchParams]);
  const nextPath = useMemo(
    () => buildNextPath(pathname, search),
    [pathname, search],
  );

  // NOTE: We intentionally start as "logged out" to avoid SSR/CSR hydration
  // mismatches (server cannot read cookies).
  const [csrfToken, setCsrfToken] = useState<string | null>(null);

  // The root header persists across navigations (including login -> redirect),
  // so we re-sync cookie-derived auth state on route changes.
  useEffect(() => {
    setCsrfToken(getAdminCsrfToken());
  }, [pathname, search]);

  const isAuthenticated = Boolean(csrfToken);

  if (!isAuthenticated) {
    const href = `/admin/login?next=${encodeURIComponent(nextPath)}`;
    return (
      <Link
        href={href}
        className="rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
      >
        로그인
      </Link>
    );
  }

  const handleLogout = async () => {
    // Redirect regardless of API outcome: the user's intent is to leave the admin UI.
    // Server-side session/cookie cleanup is best-effort via the logout endpoint.
    try {
      const response = await adminFetch("/api/admin/auth/logout", {
        method: "POST",
      });

      if (!response.ok && process.env.NODE_ENV !== "production") {
        console.error("Admin logout API failed.", { status: response.status });
      }
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Admin logout API failed.", error);
      }
    } finally {
      setCsrfToken(null);
      router.replace("/admin/login");
      router.refresh();
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
      aria-label="관리자 로그아웃"
    >
      로그아웃
    </button>
  );
}
