"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

type Stage = "primary" | "verify";

type ApiError = {
  error?: {
    code?: string;
    message?: string;
  };
};

type LoginResponse = {
  requiresTwoFactor: boolean;
  totpEnabled?: boolean;
};

type TotpSetupResponse = {
  issuer: string;
  accountName: string;
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
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
  const [isLoadingTotpSetup, setIsLoadingTotpSetup] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetupError, setTotpSetupError] = useState("");
  const [totpSetup, setTotpSetup] = useState<TotpSetupResponse | null>(null);

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

      const data = (await response.json().catch(() => null)) as
        | LoginResponse
        | ApiError
        | null;
      if (!response.ok) {
        const message =
          data && "error" in data && data.error?.message
            ? data.error.message
            : "로그인에 실패했습니다.";
        throw new Error(message);
      }

      const nextTotpEnabled =
        data &&
        typeof data === "object" &&
        "totpEnabled" in data &&
        typeof data.totpEnabled === "boolean"
          ? data.totpEnabled
          : false;

      setStage("verify");
      setCode("");
      setTotpEnabled(nextTotpEnabled);
      setTotpSetup(null);
      setTotpSetupError("");
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

  const handleLoadTotpSetup = async () => {
    setTotpSetupError("");
    if (totpEnabled) {
      setTotpSetupError("이미 2FA가 활성화되어 있습니다.");
      return;
    }
    setIsLoadingTotpSetup(true);

    try {
      const response = await fetch("/api/admin/auth/totp-setup", {
        method: "GET",
        credentials: "same-origin",
      });

      const data = (await response.json().catch(() => null)) as
        | TotpSetupResponse
        | ApiError
        | null;

      if (!response.ok) {
        if (
          response.status === 409 &&
          data &&
          "error" in data &&
          data.error?.code === "TOTP_ALREADY_ENABLED"
        ) {
          throw new Error("이미 2FA가 활성화되어 있습니다.");
        }

        const message =
          data && "error" in data && data.error?.message
            ? data.error.message
            : "QR 정보를 불러오지 못했습니다.";
        throw new Error(message);
      }

      if (
        !data ||
        !("qrDataUrl" in data) ||
        typeof data.qrDataUrl !== "string" ||
        typeof data.secret !== "string" ||
        typeof data.issuer !== "string" ||
        typeof data.accountName !== "string" ||
        typeof data.otpauthUrl !== "string"
      ) {
        throw new Error("QR 응답 형식이 올바르지 않습니다.");
      }

      setTotpSetup(data);
    } catch (error) {
      setTotpSetupError(
        error instanceof Error
          ? error.message
          : "QR 정보를 준비하는 중 오류가 발생했습니다.",
      );
    } finally {
      setIsLoadingTotpSetup(false);
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
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 py-8 sm:px-6 lg:px-8">
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
                setTotpEnabled(false);
                setTotpSetup(null);
                setTotpSetupError("");
              }}
              disabled={isSubmitting}
            >
              이전 단계로
            </button>

            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              {totpEnabled ? (
                <p className="text-xs text-slate-700">
                  이미 2FA가 활성화되어 있어 QR을 다시 표시할 수 없습니다.
                </p>
              ) : (
                <>
                  <p className="text-xs text-slate-700">
                    Google Authenticator 등록이 아직 안 되어 있으면 QR을 먼저
                    스캔해 주세요.
                  </p>
                  <button
                    type="button"
                    className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                    onClick={handleLoadTotpSetup}
                    disabled={isSubmitting || isLoadingTotpSetup}
                  >
                    {isLoadingTotpSetup
                      ? "QR 준비 중..."
                      : "Authenticator 등록 QR 보기"}
                  </button>

                  {totpSetupError ? (
                    <p className="mt-2 text-xs text-red-700">
                      {totpSetupError}
                    </p>
                  ) : null}

                  {totpSetup ? (
                    <div className="mt-3 space-y-2">
                      <Image
                        src={totpSetup.qrDataUrl}
                        alt="Authenticator 앱 등록 QR 코드"
                        width={192}
                        height={192}
                        unoptimized
                        className="mx-auto h-48 w-48 rounded border border-slate-300 bg-white p-2"
                      />
                      <p className="text-xs text-slate-700">
                        수동 등록 키:{" "}
                        <code className="rounded bg-slate-200 px-1 py-0.5">
                          {totpSetup.secret}
                        </code>
                      </p>
                      <p className="text-xs text-slate-600">
                        Issuer: {totpSetup.issuer} / Account:{" "}
                        {totpSetup.accountName}
                      </p>
                    </div>
                  ) : null}
                </>
              )}
            </div>
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
