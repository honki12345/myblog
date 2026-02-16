"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-client";

type NoteItem = {
  id: number;
  title: string;
  content: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
};

type NotePayload = {
  title: string;
  content: string;
  isPinned: boolean;
};

function createInitialPayload(): NotePayload {
  return {
    title: "",
    content: "",
    isPinned: false,
  };
}

export default function AdminNotesClient() {
  const router = useRouter();
  const [items, setItems] = useState<NoteItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState<NotePayload>(createInitialPayload());
  const [editingId, setEditingId] = useState<number | null>(null);

  const loadNotes = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await adminFetch("/api/admin/notes");
      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/notes");
        return;
      }
      if (!response.ok) {
        throw new Error("메모 목록을 불러오지 못했습니다.");
      }
      const data = (await response.json()) as { items: NoteItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "메모 목록 조회 중 오류가 발생했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadNotes().catch(() => undefined);
  }, [loadNotes]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    const normalizedTitle = form.title.trim();
    if (!normalizedTitle) {
      setErrorMessage("제목을 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      const endpoint =
        editingId === null
          ? "/api/admin/notes"
          : `/api/admin/notes/${editingId}`;
      const method = editingId === null ? "POST" : "PATCH";

      const response = await adminFetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: normalizedTitle,
          content: form.content,
          isPinned: form.isPinned,
        }),
      });

      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/notes");
        return;
      }
      if (!response.ok) {
        throw new Error("메모 저장에 실패했습니다.");
      }

      setForm(createInitialPayload());
      setEditingId(null);
      await loadNotes();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "메모 저장 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEdit = (item: NoteItem) => {
    setEditingId(item.id);
    setForm({
      title: item.title,
      content: item.content,
      isPinned: item.isPinned,
    });
    setErrorMessage("");
  };

  const handleDelete = async (id: number) => {
    setErrorMessage("");
    try {
      const response = await adminFetch(`/api/admin/notes/${id}`, {
        method: "DELETE",
      });
      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/notes");
        return;
      }
      if (!response.ok) {
        throw new Error("메모 삭제에 실패했습니다.");
      }

      if (editingId === id) {
        setEditingId(null);
        setForm(createInitialPayload());
      }
      await loadNotes();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "메모 삭제 중 오류가 발생했습니다.",
      );
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">관리자 메모</h1>
        <p className="text-sm text-slate-600">
          메모는 핀 우선, 최근 업데이트 순으로 정렬됩니다.
        </p>
      </header>

      <form
        onSubmit={handleSubmit}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          제목
          <input
            type="text"
            value={form.title}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, title: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </label>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          내용
          <textarea
            value={form.content}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, content: event.target.value }))
            }
            className="min-h-28 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.isPinned}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, isPinned: event.target.checked }))
            }
            disabled={isSubmitting}
          />
          핀 고정
        </label>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting
              ? "저장 중..."
              : editingId === null
                ? "메모 추가"
                : "메모 수정"}
          </button>
          {editingId !== null ? (
            <button
              type="button"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => {
                setEditingId(null);
                setForm(createInitialPayload());
              }}
              disabled={isSubmitting}
            >
              수정 취소
            </button>
          ) : null}
        </div>
      </form>

      {errorMessage ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      <section className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-slate-600">메모를 불러오는 중입니다...</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-600">등록된 메모가 없습니다.</p>
        ) : (
          items.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-slate-900">
                    {item.isPinned ? "[PIN] " : ""}
                    {item.title}
                  </h2>
                  <p className="text-xs text-slate-500">
                    updated: {new Date(item.updatedAt).toLocaleString("ko-KR")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    onClick={() => startEdit(item)}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    onClick={() => {
                      handleDelete(item.id).catch(() => undefined);
                    }}
                  >
                    삭제
                  </button>
                </div>
              </div>
              <p className="mt-3 text-sm whitespace-pre-wrap text-slate-700">
                {item.content}
              </p>
            </article>
          ))
        )}
      </section>
    </main>
  );
}
