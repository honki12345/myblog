import { redirect } from "next/navigation";
import AdminSchedulesClient from "./AdminSchedulesClient";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";

export default async function AdminSchedulesPage() {
  const session = await getAdminSessionFromServerCookies();
  if (!session) {
    redirect("/admin/login?next=/admin/schedules");
  }

  return <AdminSchedulesClient />;
}
