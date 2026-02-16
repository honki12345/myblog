import { redirect } from "next/navigation";
import AdminTodosClient from "./AdminTodosClient";
import { getAdminSessionFromServerCookies } from "@/lib/admin-auth";

export default async function AdminTodosPage() {
  const session = await getAdminSessionFromServerCookies();
  if (!session) {
    redirect("/admin/login?next=/admin/todos");
  }

  return <AdminTodosClient />;
}
