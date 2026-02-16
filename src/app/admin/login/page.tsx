import { redirect } from "next/navigation";
import AdminLoginClient from "./AdminLoginClient";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";

type AdminLoginPageProps = {
  searchParams: Promise<{ next?: string }>;
};

function normalizeNextPath(rawValue: string | undefined): string {
  if (!rawValue) {
    return "/admin/write";
  }
  if (!rawValue.startsWith("/")) {
    return "/admin/write";
  }
  if (rawValue.startsWith("//")) {
    return "/admin/write";
  }
  return rawValue;
}

export default async function AdminLoginPage({ searchParams }: AdminLoginPageProps) {
  const params = await searchParams;
  const nextPath = normalizeNextPath(params.next);
  const session = await getAdminSessionFromServerCookies();
  if (session) {
    redirect(nextPath);
  }

  return <AdminLoginClient nextPath={nextPath} />;
}

