"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-client";

type ScheduleItem = {
  id: number;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  isDone: boolean;
  createdAt: string;
  updatedAt: string;
};

type ViewMode = "list" | "calendar";

type ScheduleForm = {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
};

function toLocalDateTimeInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function createInitialForm(): ScheduleForm {
  const now = new Date();
  const start = new Date(now.getTime() + 30 * 60 * 1000);
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  return {
    title: "",
    description: "",
    startAt: toLocalDateTimeInputValue(start),
    endAt: toLocalDateTimeInputValue(end),
  };
}

function toIso(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function toDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createMonthCells(anchorDate: Date): Date[] {
  const monthStart = new Date(
    anchorDate.getFullYear(),
    anchorDate.getMonth(),
    1,
  );
  const startWeekday = monthStart.getDay();
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - startWeekday);

  const cells: Date[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    cells.push(date);
  }
  return cells;
}

export default function AdminSchedulesClient() {
  const router = useRouter();
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [form, setForm] = useState<ScheduleForm>(createInitialForm());
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [calendarAnchor] = useState(new Date());

  const groupedByDay = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const item of items) {
      const key = toDateKey(item.startAt);
      const current = map.get(key) ?? [];
      current.push(item);
      map.set(key, current);
    }
    return map;
  }, [items]);

  const monthCells = useMemo(
    () => createMonthCells(calendarAnchor),
    [calendarAnchor],
  );

  const loadSchedules = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await adminFetch("/api/admin/schedules");
      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/schedules");
        return;
      }
      if (!response.ok) {
        throw new Error("일정 목록을 불러오지 못했습니다.");
      }
      const data = (await response.json()) as { items: ScheduleItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "일정 목록 조회 중 오류가 발생했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadSchedules().catch(() => undefined);
  }, [loadSchedules]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    const title = form.title.trim();
    const startAtIso = toIso(form.startAt);
    const endAtIso = toIso(form.endAt);
    if (!title || !startAtIso || !endAtIso) {
      setErrorMessage("제목/시작/종료 시간을 확인해 주세요.");
      return;
    }
    if (new Date(startAtIso).getTime() >= new Date(endAtIso).getTime()) {
      setErrorMessage("시작 시각은 종료 시각보다 빨라야 합니다.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await adminFetch("/api/admin/schedules", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          description: form.description.trim(),
          startAt: startAtIso,
          endAt: endAtIso,
          isDone: false,
        }),
      });

      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/schedules");
        return;
      }
      if (!response.ok) {
        throw new Error("일정 생성에 실패했습니다.");
      }

      setForm(createInitialForm());
      await loadSchedules();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "일정 생성 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleDone = async (item: ScheduleItem) => {
    setErrorMessage("");
    try {
      const response = await adminFetch(`/api/admin/schedules/${item.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          isDone: !item.isDone,
        }),
      });
      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/schedules");
        return;
      }
      if (!response.ok) {
        throw new Error("일정 상태 변경에 실패했습니다.");
      }
      await loadSchedules();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "일정 상태 변경 중 오류가 발생했습니다.",
      );
    }
  };

  const deleteSchedule = async (id: number) => {
    setErrorMessage("");
    try {
      const response = await adminFetch(`/api/admin/schedules/${id}`, {
        method: "DELETE",
      });
      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/schedules");
        return;
      }
      if (!response.ok) {
        throw new Error("일정 삭제에 실패했습니다.");
      }
      await loadSchedules();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "일정 삭제 중 오류가 발생했습니다.",
      );
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">관리자 일정</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          리스트/캘린더를 함께 제공하는 일정 워크스페이스입니다.
        </p>
      </header>

      <form
        onSubmit={handleCreate}
        className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2 dark:border-slate-700 dark:bg-slate-900"
      >
        <label className="grid gap-1 text-sm font-medium text-slate-700 md:col-span-2 dark:text-slate-200">
          제목
          <input
            type="text"
            value={form.title}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, title: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
            disabled={isSubmitting}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          시작
          <input
            type="datetime-local"
            value={form.startAt}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, startAt: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
            disabled={isSubmitting}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700 dark:text-slate-200">
          종료
          <input
            type="datetime-local"
            value={form.endAt}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, endAt: event.target.value }))
            }
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
            disabled={isSubmitting}
          />
        </label>
        <label className="grid gap-1 text-sm font-medium text-slate-700 md:col-span-2 dark:text-slate-200">
          메모
          <textarea
            value={form.description}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, description: event.target.value }))
            }
            className="min-h-24 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600"
            disabled={isSubmitting}
          />
        </label>
        <div className="md:col-span-2">
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting ? "추가 중..." : "일정 추가"}
          </button>
        </div>
      </form>

      {errorMessage ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
          {errorMessage}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            viewMode === "list"
              ? "bg-slate-900 text-white"
              : "border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          }`}
          onClick={() => setViewMode("list")}
        >
          리스트
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
            viewMode === "calendar"
              ? "bg-slate-900 text-white"
              : "border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          }`}
          onClick={() => setViewMode("calendar")}
        >
          캘린더
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          일정 목록을 불러오는 중입니다...
        </p>
      ) : viewMode === "list" ? (
        <section className="space-y-3">
          {items.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              등록된 일정이 없습니다.
            </p>
          ) : (
            items.map((item) => (
              <article
                key={item.id}
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      {item.title}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {new Date(item.startAt).toLocaleString("ko-KR")} -{" "}
                      {new Date(item.endAt).toLocaleString("ko-KR")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                      onClick={() => {
                        toggleDone(item).catch(() => undefined);
                      }}
                    >
                      {item.isDone ? "미완료로" : "완료로"}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/40"
                      onClick={() => {
                        deleteSchedule(item.id).catch(() => undefined);
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </div>
                {item.description ? (
                  <p className="mt-3 text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-200">
                    {item.description}
                  </p>
                ) : null}
              </article>
            ))
          )}
        </section>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              {calendarAnchor.getFullYear()}년 {calendarAnchor.getMonth() + 1}월
            </h2>
          </div>
          <div className="grid grid-cols-7 gap-2 text-xs text-slate-500 dark:text-slate-400">
            {["일", "월", "화", "수", "목", "금", "토"].map((label) => (
              <div key={label} className="px-1 py-1 text-center font-medium">
                {label}
              </div>
            ))}
            {monthCells.map((date) => {
              const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
              const dayItems = groupedByDay.get(key) ?? [];
              const isCurrentMonth =
                date.getMonth() === calendarAnchor.getMonth();
              return (
                <div
                  key={key}
                  className={`min-h-20 rounded-md border p-1 ${
                    isCurrentMonth
                      ? "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
                      : "border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60"
                  }`}
                >
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {date.getDate()}
                  </p>
                  <div className="mt-1 space-y-1">
                    {dayItems.slice(0, 3).map((item) => (
                      <p
                        key={item.id}
                        className={`truncate rounded px-1 py-0.5 text-[10px] ${
                          item.isDone
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/45 dark:text-emerald-300"
                            : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                        }`}
                      >
                        {item.title}
                      </p>
                    ))}
                    {dayItems.length > 3 ? (
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">
                        +{dayItems.length - 3} more
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
