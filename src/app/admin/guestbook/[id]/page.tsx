import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AdminGuestbookThreadClient from "./AdminGuestbookThreadClient";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";

type AdminGuestbookThreadPageProps = {
  params: Promise<{ id: string }>;
};

export const metadata: Metadata = {
  title: "프라이빗 방명록 스레드 (관리자)",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminGuestbookThreadPage({
  params,
}: AdminGuestbookThreadPageProps) {
  const { id } = await params;
  const session = await getAdminSessionFromServerCookies();
  if (!session) {
    const nextPath = `/admin/guestbook/${encodeURIComponent(id)}`;
    redirect(`/admin/login?next=${encodeURIComponent(nextPath)}`);
  }

  return <AdminGuestbookThreadClient threadId={id} />;
}

