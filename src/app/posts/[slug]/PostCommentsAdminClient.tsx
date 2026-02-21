"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { adminFetch } from "@/lib/admin-client";
import { buildWikiPathHref } from "@/lib/comment-tags";

type AdminCommentItem = {
  id: number;
  postId: number;
  content: string;
  tagPath: string;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
};

type AdminCommentsApiResponse = {
  items: AdminCommentItem[];
};

type PostCommentsAdminClientProps = {
  postId: number;
};

function parseErrorMessage(data: unknown, fallback: string): string {
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    data.error &&
    typeof data.error === "object" &&
    "message" in data.error &&
    typeof data.error.message === "string" &&
    data.error.message.trim().length > 0
  ) {
    return data.error.message;
  }
  return fallback;
}

function formatDateTime(value: string): string {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
    ? `${value.replace(" ", "T")}Z`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function PostCommentsAdminClient({
  postId,
}: PostCommentsAdminClientProps) {
  const router = useRouter();
  const [items, setItems] = useState<AdminCommentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [content, setContent] = useState("");
  const [tagPath, setTagPath] = useState("");
  const [isHidden, setIsHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const editingItem = useMemo(
    () => items.find((item) => item.id === editingId) ?? null,
    [editingId, items],
  );

  const loadComments = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await adminFetch(`/api/admin/posts/${postId}/comments`, {
        method: "GET",
      });

      if (response.status === 401) {
        router.replace(
          `/admin/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        );
        return;
      }

      const data = (await response.json().catch(() => null)) as
        | AdminCommentsApiResponse
        | { error?: { message?: string } }
        | null;
      if (!response.ok || !data || !("items" in data)) {
        setError(parseErrorMessage(data, "댓글 목록을 불러오지 못했습니다."));
        return;
      }

      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setError("네트워크 오류로 댓글 목록을 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadComments().catch(() => {
      setIsLoading(false);
      setError("댓글 목록을 불러오지 못했습니다.");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const resetForm = () => {
    setEditingId(null);
    setContent("");
    setTagPath("");
    setIsHidden(false);
  };

  const beginEdit = (item: AdminCommentItem) => {
    setEditingId(item.id);
    setContent(item.content);
    setTagPath(item.tagPath);
    setIsHidden(item.isHidden);
    setError(null);
    setNotice(null);
  };

  const cancelEdit = () => {
    resetForm();
    setError(null);
    setNotice(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedContent = content.trim();
    const normalizedTagPath = tagPath.trim();
    if (!normalizedContent || !normalizedTagPath) {
      setError("댓글 내용과 태그 경로는 필수입니다.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);

    const endpoint = editingId
      ? `/api/admin/posts/${postId}/comments/${editingId}`
      : `/api/admin/posts/${postId}/comments`;
    const method = editingId ? "PATCH" : "POST";

    try {
      const response = await adminFetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: normalizedContent,
          tagPath: normalizedTagPath,
          isHidden,
        }),
      });

      if (response.status === 401) {
        router.replace(
          `/admin/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        );
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(parseErrorMessage(data, "댓글 저장에 실패했습니다."));
        return;
      }

      await loadComments();
      router.refresh();
      resetForm();
      setNotice(editingId ? "댓글을 수정했습니다." : "댓글을 추가했습니다.");
    } catch {
      setError("네트워크 오류로 댓글 저장에 실패했습니다.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (commentId: number) => {
    if (deletingId !== null) {
      return;
    }

    const confirmed = window.confirm("이 댓글을 삭제할까요?");
    if (!confirmed) {
      return;
    }

    setDeletingId(commentId);
    setError(null);
    setNotice(null);

    try {
      const response = await adminFetch(
        `/api/admin/posts/${postId}/comments/${commentId}`,
        { method: "DELETE" },
      );

      if (response.status === 401) {
        router.replace(
          `/admin/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
        );
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(parseErrorMessage(data, "댓글 삭제에 실패했습니다."));
        return;
      }

      await loadComments();
      router.refresh();
      if (editingId === commentId) {
        resetForm();
      }
      setNotice("댓글을 삭제했습니다.");
    } catch {
      setError("네트워크 오류로 댓글 삭제에 실패했습니다.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section
      className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      data-post-comments-admin
    >
      <header className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">댓글 위키 관리</h2>
        <p className="text-sm text-slate-600">
          댓글은 관리자만 수정할 수 있고, 태그 경로는 단일 값만 허용됩니다.
        </p>
      </header>

      {error ? (
        <p
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {notice}
        </p>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
        data-comment-form
      >
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          댓글 내용
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="댓글 내용을 입력하세요"
            className="min-h-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            disabled={isSaving}
          />
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          태그 경로
          <input
            value={tagPath}
            onChange={(event) => setTagPath(event.target.value)}
            placeholder="예: ai/nextjs/app-router"
            className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm"
            disabled={isSaving}
          />
        </label>

        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={isHidden}
            onChange={(event) => setIsHidden(event.target.checked)}
            disabled={isSaving}
          />
          숨김 처리
        </label>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {editingItem ? (
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
              disabled={isSaving}
            >
              취소
            </button>
          ) : null}
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            disabled={isSaving}
          >
            {isSaving ? "저장 중…" : editingItem ? "댓글 저장" : "댓글 추가"}
          </button>
        </div>
      </form>

      {isLoading ? (
        <p className="text-sm text-slate-600">댓글 목록을 불러오는 중입니다…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center">
          <p className="text-sm text-slate-600">등록된 댓글이 없습니다.</p>
        </div>
      ) : (
        <ul className="space-y-3" data-comment-list>
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-slate-200 bg-white p-3"
              data-comment-id={String(item.id)}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Link
                  href={buildWikiPathHref(item.tagPath)}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
                >
                  /{item.tagPath}
                </Link>
                {item.isHidden ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                    hidden
                  </span>
                ) : (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                    visible
                  </span>
                )}
                <span className="text-xs text-slate-500">
                  {formatDateTime(item.updatedAt)}
                </span>
              </div>

              <p className="text-sm leading-6 whitespace-pre-wrap text-slate-800">
                {item.content}
              </p>

              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => beginEdit(item)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  disabled={isSaving || deletingId !== null}
                >
                  수정
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                  disabled={isSaving || deletingId !== null}
                >
                  {deletingId === item.id ? "삭제 중…" : "삭제"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
