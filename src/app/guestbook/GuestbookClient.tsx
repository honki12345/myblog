"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

type GuestbookMessage = {
  id: number;
  role: "guest" | "admin";
  content: string;
  createdAt: string;
};

type GuestbookThread = {
  threadId: number;
  username: string;
  createdAt: string | null;
  updatedAt: string | null;
  messages: GuestbookMessage[];
};

type CreateThreadForm = {
  username: string;
  password: string;
  content: string;
};

type LoginForm = {
  username: string;
  password: string;
};

function createInitialCreateForm(): CreateThreadForm {
  return { username: "", password: "", content: "" };
}

function createInitialLoginForm(): LoginForm {
  return { username: "", password: "" };
}

export default function GuestbookClient() {
  const [thread, setThread] = useState<GuestbookThread | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [createForm, setCreateForm] = useState<CreateThreadForm>(
    createInitialCreateForm(),
  );
  const [loginForm, setLoginForm] = useState<LoginForm>(
    createInitialLoginForm(),
  );
  const [messageDraft, setMessageDraft] = useState("");

  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [isSubmittingMessage, setIsSubmittingMessage] = useState(false);

  const normalizedUsernameHint = useMemo(() => {
    const raw = createForm.username.trim();
    return raw ? raw.toLowerCase() : "";
  }, [createForm.username]);

  const loadThread = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage("");

    try {
      const response = await fetch("/api/guestbook/thread", {
        method: "GET",
        cache: "no-store",
        credentials: "same-origin",
      });

      if (response.status === 401) {
        setThread(null);
        return;
      }

      if (!response.ok) {
        throw new Error("스레드를 불러오지 못했습니다.");
      }

      const data = (await response.json()) as GuestbookThread;
      setThread(data);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "스레드 조회 중 오류가 발생했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThread().catch(() => undefined);
  }, [loadThread]);

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    const username = createForm.username.trim().toLowerCase();
    const content = createForm.content.trim();

    if (!username) {
      setErrorMessage("아이디를 입력해 주세요.");
      return;
    }
    if (!/^[a-z0-9_]{3,20}$/.test(username)) {
      setErrorMessage("아이디는 3~20자, 소문자/숫자/_ 만 사용할 수 있습니다.");
      return;
    }
    if (createForm.password.length < 8) {
      setErrorMessage("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    if (!content) {
      setErrorMessage("첫 메시지를 입력해 주세요.");
      return;
    }

    setIsSubmittingCreate(true);
    try {
      const response = await fetch("/api/guestbook/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          username,
          password: createForm.password,
          content,
        }),
      });

      if (response.status === 429) {
        throw new Error("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
      }

      if (response.status === 409) {
        throw new Error("이미 사용 중인 아이디입니다.");
      }

      if (!response.ok) {
        throw new Error("스레드 생성에 실패했습니다.");
      }

      const data = (await response.json()) as GuestbookThread;
      setThread(data);
      setCreateForm(createInitialCreateForm());
      setMessageDraft("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "스레드 생성 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    const username = loginForm.username.trim().toLowerCase();
    if (!username) {
      setErrorMessage("아이디를 입력해 주세요.");
      return;
    }
    if (loginForm.password.length < 1) {
      setErrorMessage("비밀번호를 입력해 주세요.");
      return;
    }

    setIsSubmittingLogin(true);
    try {
      const response = await fetch("/api/guestbook/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          username,
          password: loginForm.password,
        }),
      });

      if (response.status === 429) {
        throw new Error("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
      }

      if (response.status === 401) {
        throw new Error("아이디 또는 비밀번호가 올바르지 않습니다.");
      }

      if (!response.ok) {
        throw new Error("로그인에 실패했습니다.");
      }

      setLoginForm(createInitialLoginForm());
      await loadThread();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "로그인 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmittingLogin(false);
    }
  };

  const handleSendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    const content = messageDraft.trim();
    if (!content) {
      setErrorMessage("메시지를 입력해 주세요.");
      return;
    }

    setIsSubmittingMessage(true);
    try {
      const response = await fetch("/api/guestbook/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ content }),
      });

      if (response.status === 401) {
        setThread(null);
        throw new Error("세션이 만료되었습니다. 다시 로그인해 주세요.");
      }

      if (response.status === 429) {
        throw new Error("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.");
      }

      if (!response.ok) {
        throw new Error("메시지 전송에 실패했습니다.");
      }

      setMessageDraft("");
      await loadThread();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "메시지 전송 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmittingMessage(false);
    }
  };

  const handleLogout = async () => {
    setErrorMessage("");
    try {
      await fetch("/api/guestbook/logout", {
        method: "POST",
        credentials: "same-origin",
      });
    } finally {
      setThread(null);
      setMessageDraft("");
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          프라이빗 방명록
        </h1>
        <p className="text-sm text-slate-600">
          게스트와 관리자만 볼 수 있는 1:1 대화 스레드입니다. 검색/크롤링 노출을
          최소화하지만, 절대적인 보안 채널은 아니므로 민감한 정보는 남기지
          마세요.
        </p>
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

      {!isLoading && !thread ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold tracking-tight">
              새 스레드 만들기
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              아이디/비밀번호를 설정하면 같은 스레드로 다시 접속할 수 있습니다.
            </p>
            <form
              data-testid="guestbook-create-form"
              onSubmit={handleCreate}
              className="mt-4 grid gap-3"
            >
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                아이디
                <input
                  type="text"
                  value={createForm.username}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      username: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  disabled={isSubmittingCreate}
                  autoComplete="username"
                  inputMode="text"
                />
                {normalizedUsernameHint ? (
                  <span className="text-xs font-normal text-slate-500">
                    저장 시:{" "}
                    <span className="font-mono">{normalizedUsernameHint}</span>
                  </span>
                ) : null}
              </label>

              <label className="grid gap-1 text-sm font-medium text-slate-700">
                비밀번호
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      password: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  disabled={isSubmittingCreate}
                  autoComplete="new-password"
                />
              </label>

              <label className="grid gap-1 text-sm font-medium text-slate-700">
                메시지
                <textarea
                  value={createForm.content}
                  onChange={(event) =>
                    setCreateForm((prev) => ({
                      ...prev,
                      content: event.target.value,
                    }))
                  }
                  className="min-h-28 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  disabled={isSubmittingCreate}
                />
              </label>

              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmittingCreate}
              >
                스레드 만들고 보내기
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-semibold tracking-tight">
              기존 스레드 로그인
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              다른 기기에서도 같은 아이디/비밀번호로 이어서 대화할 수 있습니다.
            </p>
            <form
              data-testid="guestbook-login-form"
              onSubmit={handleLogin}
              className="mt-4 grid gap-3"
            >
              <label className="grid gap-1 text-sm font-medium text-slate-700">
                아이디
                <input
                  type="text"
                  value={loginForm.username}
                  onChange={(event) =>
                    setLoginForm((prev) => ({
                      ...prev,
                      username: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  disabled={isSubmittingLogin}
                  autoComplete="username"
                  inputMode="text"
                />
              </label>

              <label className="grid gap-1 text-sm font-medium text-slate-700">
                비밀번호
                <input
                  type="password"
                  value={loginForm.password}
                  onChange={(event) =>
                    setLoginForm((prev) => ({
                      ...prev,
                      password: event.target.value,
                    }))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  disabled={isSubmittingLogin}
                  autoComplete="current-password"
                />
              </label>

              <button
                type="submit"
                className="inline-flex items-center justify-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmittingLogin}
              >
                로그인
              </button>
            </form>
          </section>
        </div>
      ) : null}

      {!isLoading && thread ? (
        <section className="rounded-xl border border-slate-200 bg-white">
          <header className="flex flex-col gap-2 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">
                대화
              </h2>
              <p className="text-sm text-slate-600">
                아이디: <span className="font-mono">{thread.username}</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => loadThread()}
                disabled={isSubmittingMessage}
              >
                새로고침
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900 ring-1 ring-slate-300 hover:bg-slate-50"
                onClick={handleLogout}
              >
                로그아웃
              </button>
            </div>
          </header>

          <div className="px-4 py-4">
            <ul
              data-testid="guestbook-message-list"
              className="flex flex-col gap-3"
            >
              {thread.messages.map((message) => {
                const isGuest = message.role === "guest";
                return (
                  <li
                    key={message.id}
                    className={
                      isGuest ? "flex justify-end" : "flex justify-start"
                    }
                  >
                    <div
                      className={
                        isGuest
                          ? "max-w-[85%] rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-sm"
                          : "max-w-[85%] rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 shadow-sm"
                      }
                    >
                      <div className="mb-1 text-xs font-semibold opacity-80">
                        {isGuest ? "나" : "관리자"}
                      </div>
                      <p className="break-words whitespace-pre-wrap">
                        {message.content}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <form
            data-testid="guestbook-message-form"
            onSubmit={handleSendMessage}
            className="flex flex-col gap-3 border-t border-slate-200 px-4 py-4 sm:flex-row sm:items-end"
          >
            <label className="grid flex-1 gap-1 text-sm font-medium text-slate-700">
              새 메시지
              <textarea
                value={messageDraft}
                onChange={(event) => setMessageDraft(event.target.value)}
                className="min-h-20 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm"
                disabled={isSubmittingMessage}
              />
            </label>

            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmittingMessage}
            >
              보내기
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
