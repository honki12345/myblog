"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-client";

type TodoStatus = "todo" | "doing" | "done";
type TodoPriority = "low" | "medium" | "high";

type TodoItem = {
  id: number;
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TodoForm = {
  title: string;
  description: string;
  priority: TodoPriority;
  dueAt: string;
};

function createInitialForm(): TodoForm {
  return {
    title: "",
    description: "",
    priority: "medium",
    dueAt: "",
  };
}

function toIsoOrNull(localDateTime: string): string | null {
  if (!localDateTime.trim()) {
    return null;
  }
  const date = new Date(localDateTime);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function getNextStatus(status: TodoStatus): TodoStatus {
  if (status === "todo") {
    return "doing";
  }
  if (status === "doing") {
    return "done";
  }
  return "done";
}

export default function AdminTodosClient() {
  const router = useRouter();
  const [items, setItems] = useState<TodoItem[]>([]);
  const [form, setForm] = useState<TodoForm>(createInitialForm());
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const loadTodos = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await adminFetch("/api/admin/todos");
      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/todos");
        return;
      }
      if (!response.ok) {
        throw new Error("TODO 목록을 불러오지 못했습니다.");
      }
      const data = (await response.json()) as { items: TodoItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "TODO 목록 조회 중 오류가 발생했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadTodos().catch(() => undefined);
  }, [loadTodos]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    const normalizedTitle = form.title.trim();
    if (!normalizedTitle) {
      setErrorMessage("제목을 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await adminFetch("/api/admin/todos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: normalizedTitle,
          description: form.description.trim(),
          priority: form.priority,
          status: "todo",
          dueAt: toIsoOrNull(form.dueAt) ?? undefined,
        }),
      });

      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/todos");
        return;
      }
      if (!response.ok) {
        throw new Error("TODO 생성에 실패했습니다.");
      }

      setForm(createInitialForm());
      await loadTodos();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "TODO 생성 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateTodo = async (
    id: number,
    payload: Partial<{
      status: TodoStatus;
      priority: TodoPriority;
      dueAt: string | null;
      title: string;
      description: string;
    }>,
  ) => {
    setErrorMessage("");
    try {
      const response = await adminFetch(`/api/admin/todos/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/todos");
        return;
      }
      if (!response.ok) {
        throw new Error("TODO 수정에 실패했습니다.");
      }
      await loadTodos();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "TODO 수정 중 오류가 발생했습니다.",
      );
    }
  };

  const deleteTodo = async (id: number) => {
    setErrorMessage("");
    try {
      const response = await adminFetch(`/api/admin/todos/${id}`, {
        method: "DELETE",
      });
      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/todos");
        return;
      }
      if (!response.ok) {
        throw new Error("TODO 삭제에 실패했습니다.");
      }
      await loadTodos();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "TODO 삭제 중 오류가 발생했습니다.",
      );
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">관리자 TODO</h1>
        <p className="text-sm text-slate-600">
          상태(`todo`, `doing`, `done`)와 우선순위/마감일을 함께 관리합니다.
        </p>
      </header>

      <form
        onSubmit={handleCreate}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2"
      >
        <label className="grid gap-1 text-sm font-medium text-slate-700 md:col-span-2">
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
          우선순위
          <select
            value={form.priority}
            onChange={(event) =>
              setForm((prev) => ({
                ...prev,
                priority: event.target.value as TodoPriority,
              }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            disabled={isSubmitting}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700">
          마감일
          <input
            type="datetime-local"
            value={form.dueAt}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, dueAt: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700 md:col-span-2">
          설명
          <textarea
            value={form.description}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, description: event.target.value }))
            }
            className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm"
            disabled={isSubmitting}
          />
        </label>
        <div className="md:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting ? "추가 중..." : "TODO 추가"}
          </button>
        </div>
      </form>

      {errorMessage ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}

      <section className="space-y-3">
        {isLoading ? (
          <p className="text-sm text-slate-600">
            TODO 목록을 불러오는 중입니다...
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-600">등록된 TODO가 없습니다.</p>
        ) : (
          items.map((item) => (
            <article
              key={item.id}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">
                    {item.title}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    status: {item.status} | priority: {item.priority}
                  </p>
                  {item.dueAt ? (
                    <p className="text-xs text-slate-500">
                      due: {new Date(item.dueAt).toLocaleString("ko-KR")}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                    onClick={() => {
                      updateTodo(item.id, {
                        status: getNextStatus(item.status),
                      }).catch(() => undefined);
                    }}
                  >
                    다음 상태
                  </button>
                  <select
                    value={item.priority}
                    aria-label={`${item.title} 우선순위`}
                    onChange={(event) => {
                      updateTodo(item.id, {
                        priority: event.target.value as TodoPriority,
                      }).catch(() => undefined);
                    }}
                    className="rounded-md border border-slate-300 px-2 py-1.5 text-xs text-slate-700"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                  <button
                    type="button"
                    className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    onClick={() => {
                      deleteTodo(item.id).catch(() => undefined);
                    }}
                  >
                    삭제
                  </button>
                </div>
              </div>
              {item.description ? (
                <p className="mt-3 text-sm whitespace-pre-wrap text-slate-700">
                  {item.description}
                </p>
              ) : null}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
