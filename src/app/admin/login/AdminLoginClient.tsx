"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Stage = "primary" | "verify";

type ApiError = {
  error?: {
    message?: string;
  };
};

type AdminLoginClientProps = {
  nextPath: string;
};

export default function AdminLoginClient({ nextPath }: AdminLoginClientProps) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("primary");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handlePrimarySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    if (!username.trim() || !password.trim()) {
      setErrorMessage("아이디와 비밀번호를 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      const data = (await response.json().catch(() => null)) as ApiError | null;
      if (!response.ok) {
        const message = data?.error?.message ?? "로그인에 실패했습니다.";
        throw new Error(message);
      }

      setStage("verify");
      setCode("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "로그인 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    if (!code.trim()) {
      setErrorMessage("인증 코드를 입력해 주세요.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/admin/auth/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({
          code: code.trim(),
        }),
      });

      const data = (await response.json().catch(() => null)) as ApiError | null;
      if (!response.ok) {
        const message = data?.error?.message ?? "2차 인증에 실패했습니다.";
        throw new Error(message);
      }

      router.replace(nextPath);
      router.refresh();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "2차 인증 처리 중 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-10 sm:px-6 lg:px-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">관리자 로그인</h1>
        <p className="text-sm text-slate-600">
          비밀번호 인증 후 TOTP 또는 복구코드로 2차 인증을 완료해 주세요.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {stage === "primary" ? (
          <form onSubmit={handlePrimarySubmit} className="space-y-3">
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              아이디
              <input
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                autoComplete="username"
                disabled={isSubmitting}
              />
            </label>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              비밀번호
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                autoComplete="current-password"
                disabled={isSubmitting}
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
              disabled={isSubmitting}
            >
              {isSubmitting ? "확인 중..." : "1차 인증"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifySubmit} className="space-y-3">
            <p className="text-sm text-slate-600">
              6자리 TOTP 또는 복구코드를 입력해 주세요.
            </p>
            <label className="grid gap-1 text-sm font-medium text-slate-700">
              인증 코드
              <input
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                autoComplete="one-time-code"
                placeholder="123456 또는 복구코드"
                disabled={isSubmitting}
              />
            </label>
            <button
              type="submit"
              className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
              disabled={isSubmitting}
            >
              {isSubmitting ? "검증 중..." : "2차 인증 완료"}
            </button>
            <button
              type="button"
              className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              onClick={() => {
                setStage("primary");
                setCode("");
              }}
              disabled={isSubmitting}
            >
              이전 단계로
            </button>
          </form>
        )}
      </section>

      {errorMessage ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </p>
      ) : null}
    </main>
  );
}
