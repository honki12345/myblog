"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { adminFetch } from "@/lib/admin-client";

type PostAdminActionsClientProps = {
  postId: number;
  isRead: boolean;
};

export default function PostAdminActionsClient({
  postId,
  isRead: initialIsRead,
}: PostAdminActionsClientProps) {
  const router = useRouter();
  const [isRead, setIsRead] = useState(initialIsRead);
  const [error, setError] = useState<string | null>(null);
  const [isUpdatingRead, setIsUpdatingRead] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    setIsRead(initialIsRead);
  }, [initialIsRead]);

  const handleToggleRead = async () => {
    if (isUpdatingRead || isDeleting) {
      return;
    }

    setError(null);
    setIsUpdatingRead(true);
    const nextIsRead = !isRead;

    try {
      const response = await adminFetch(`/api/admin/posts/${postId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isRead: nextIsRead }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null
          | undefined;
        setError(data?.error?.message ?? "읽음 상태 변경에 실패했습니다.");
        return;
      }

      setIsRead(nextIsRead);
      router.refresh();
    } catch (cause) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to toggle post read state.", { cause, postId });
      }
      setError("네트워크 오류로 읽음 상태 변경에 실패했습니다.");
    } finally {
      setIsUpdatingRead(false);
    }
  };

  const handleDelete = async () => {
    if (isDeleting || isUpdatingRead) {
      return;
    }

    setError(null);

    const confirmed = window.confirm(
      "이 글을 삭제할까요? 삭제하면 되돌릴 수 없습니다.",
    );
    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    let navigated = false;

    try {
      const response = await adminFetch(`/api/admin/posts/${postId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null
          | undefined;
        setError(data?.error?.message ?? "삭제에 실패했습니다.");
        return;
      }

      navigated = true;
      router.push("/posts");
      router.refresh();
    } catch (cause) {
      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to delete post from detail page.", { cause });
      }
      setError("네트워크 오류로 삭제에 실패했습니다.");
    } finally {
      if (!navigated) {
        setIsDeleting(false);
      }
    }
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {error ? (
        <p className="text-sm font-medium text-rose-600" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={handleToggleRead}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        disabled={isDeleting || isUpdatingRead}
      >
        {isUpdatingRead
          ? "변경 중…"
          : isRead
            ? "읽지 않음으로 표시"
            : "읽음으로 표시"}
      </button>
      <button
        type="button"
        onClick={handleDelete}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        disabled={isDeleting || isUpdatingRead}
      >
        {isDeleting ? "삭제 중…" : "삭제"}
      </button>
    </div>
  );
}
