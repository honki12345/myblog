import { redirect } from "next/navigation";
import AdminWriteClient from "./AdminWriteClient";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";

type AdminWritePageProps = {
  searchParams: Promise<{ id?: string }>;
};

export default async function AdminWritePage({ searchParams }: AdminWritePageProps) {
  const params = await searchParams;
  const session = await getAdminSessionFromServerCookies();
  if (!session) {
    const nextPath = params.id ? `/admin/write?id=${params.id}` : "/admin/write";
    redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`);
  }

  return <AdminWriteClient />;
}
