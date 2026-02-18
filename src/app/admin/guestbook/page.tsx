import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AdminGuestbookInboxClient from "./AdminGuestbookInboxClient";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";

export const metadata: Metadata = {
  title: "프라이빗 방명록 (관리자)",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminGuestbookPage() {
  const session = await getAdminSessionFromServerCookies();
  if (!session) {
    redirect("/admin/login?next=/admin/guestbook");
  }

  return <AdminGuestbookInboxClient />;
}

