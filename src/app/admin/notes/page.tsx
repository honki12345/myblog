import { redirect } from "next/navigation";
import AdminNotesClient from "./AdminNotesClient";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";

export default async function AdminNotesPage() {
  const session = await getAdminSessionFromServerCookies();
  if (!session) {
    redirect("/admin/login?next=/admin/notes");
  }

  return <AdminNotesClient />;
}
