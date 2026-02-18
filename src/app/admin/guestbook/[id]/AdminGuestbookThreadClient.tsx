"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { adminFetch } from "@/lib/admin-client";

type ThreadDetail = {
  thread: {
    id: number;
    guestUsername: string;
    createdAt: string;
    updatedAt: string;
  };
  messages: Array<{
    id: number;
    role: "guest" | "admin";
    content: string;
    createdAt: string;
  }>;
};

export default function AdminGuestbookThreadClient({
  threadId,
}: {
  threadId: string;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [replyDraft, setReplyDraft] = useState("");

  const nextLoginPath = useMemo(
    () => `/admin/login?next=${encodeURIComponent(`/admin/guestbook/${threadId}`)}`,
    [threadId],
  );

  const loadThread = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const response = await adminFetch(`/api/admin/guestbook/threads/${threadId}`, {
        method: "GET",
        cache: "no-store",
      });

      if (response.status === 401) {
        router.replace(nextLoginPath);
        return;
      }

      if (response.status === 404) {
        setDetail(null);
        throw new Error("스레드를 찾을 수 없습니다.");
      }

      if (!response.ok) {
        throw new Error("스레드를 불러오지 못했습니다.");
      }

      const data = (await response.json()) as ThreadDetail;
      setDetail(data);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "스레드 조회 중 오류가 발생했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [nextLoginPath, router, threadId]);

  useEffect(() => {
    loadThread().catch(() => undefined);
  }, [loadThread]);

  const handleReply = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    const content = replyDraft.trim();
    if (!content) {
      setErrorMessage("답장을 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await adminFetch(
        `/api/admin/guestbook/threads/${threadId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
        },
      );

      if (response.status === 401) {
        router.replace(nextLoginPath);
        return;
      }

      if (response.status === 403) {
        throw new Error(
          "CSRF 검증에 실패했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.",
        );
      }

      if (!response.ok) {
        throw new Error("답장 전송에 실패했습니다.");
      }

      setReplyDraft("");
      await loadThread();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "답장 전송 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">스레드 상세</h1>
          {detail ? (
            <p className="text-sm text-slate-600">
              아이디: <span className="font-mono">{detail.thread.guestUsername}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/guestbook"
            className="inline-flex items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50"
          >
            목록으로
          </Link>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50"
            onClick={() => loadThread()}
          >
            새로고침
          </button>
        </div>
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

      {!isLoading && detail ? (
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="px-4 py-4">
            <ul className="flex flex-col gap-3">
              {detail.messages.map((message) => {
                const isAdmin = message.role === "admin";
                return (
                  <li
                    key={message.id}
                    className={isAdmin ? "flex justify-end" : "flex justify-start"}
                  >
                    <div
                      className={
                        isAdmin
                          ? "max-w-[85%] rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-sm"
                          : "max-w-[85%] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 shadow-sm"
                      }
                    >
                      <div className="mb-1 text-xs font-semibold opacity-80">
                        {isAdmin ? "관리자" : "게스트"}
                      </div>
                      <p className="whitespace-pre-wrap break-words">
                        {message.content}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <form
            data-testid="admin-guestbook-reply-form"
            onSubmit={handleReply}
            className="flex flex-col gap-3 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-end"
          >
            <label className="grid flex-1 gap-1 text-sm font-medium text-slate-700">
              답장
              <textarea
                value={replyDraft}
                onChange={(event) => setReplyDraft(event.target.value)}
                className="min-h-20 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm"
                disabled={isSubmitting}
              />
            </label>

            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting}
            >
              보내기
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}

