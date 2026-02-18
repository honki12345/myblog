"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-client";

type ThreadListItem = {
  id: number;
  guestUsername: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessageAt: string | null;
  lastMessageRole: "guest" | "admin" | null;
  lastMessagePreview: string | null;
};

export default function AdminGuestbookInboxClient() {
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const loadThreads = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const response = await adminFetch("/api/admin/guestbook/threads", {
        method: "GET",
        cache: "no-store",
      });

      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/guestbook");
        return;
      }

      if (!response.ok) {
        throw new Error("스레드 목록을 불러오지 못했습니다.");
      }

      const data = (await response.json()) as { items: ThreadListItem[] };
      setThreads(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "스레드 목록 조회 중 오류가 발생했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadThreads().catch(() => undefined);
  }, [loadThreads]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            프라이빗 방명록 인박스
          </h1>
          <p className="text-sm text-slate-600">
            게스트별 1:1 스레드 목록입니다.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50"
          onClick={() => loadThreads()}
        >
          새로고침
        </button>
      </header>

      {errorMessage ? (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
        >
          {errorMessage}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">
          불러오는 중...
        </div>
      ) : null}

      {!isLoading ? (
        <section className="rounded-xl border border-slate-200 bg-white">
          {threads.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-600">
              아직 생성된 스레드가 없습니다.
            </div>
          ) : (
            <ul className="divide-y divide-slate-200">
              {threads.map((thread) => {
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      data-testid="admin-guestbook-thread-item"
                      onClick={() =>
                        router.push(`/admin/guestbook/${thread.id}`)
                      }
                      className="flex w-full flex-col gap-2 px-4 py-4 text-left hover:bg-slate-50"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">
                            <span className="font-mono">
                              {thread.guestUsername}
                            </span>
                          </div>
                          <div className="text-xs text-slate-500">
                            메시지 {thread.messageCount}개
                          </div>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                          {thread.lastMessageRole === "admin"
                            ? "관리자 답장"
                            : "게스트 메시지"}
                        </span>
                      </div>
                      {thread.lastMessagePreview ? (
                        <p className="line-clamp-2 text-sm text-slate-600">
                          {thread.lastMessagePreview}
                        </p>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}
