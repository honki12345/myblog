"use client";

import { marked } from "marked";
import {
  useMemo,
  useRef,
  useState,
  useEffect,
  type DragEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

type AuthStatus = "checking" | "required" | "ready";

type PostStatus = "draft" | "published";

type PostDetailResponse = {
  id: number;
  title: string;
  slug: string;
  content: string;
  status: PostStatus;
  tags: string[];
};

const API_KEY_STORAGE_KEY = "honki12345.blog.api_key";

const previewRenderer = new marked.Renderer();
previewRenderer.html = () => "";

function parsePostId(rawValue: string | null): number | null {
  if (!rawValue) {
    return null;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseTags(input: string): string[] {
  const values = input
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return Array.from(new Set(values));
}

function buildPreviewHtml(markdown: string): string {
  const parsed = marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true,
    renderer: previewRenderer,
  });

  return typeof parsed === "string" ? parsed : "";
}

export default function WritePage() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [editPostId, setEditPostId] = useState<number | null>(null);
  const [isClientHydrated, setIsClientHydrated] = useState(false);

  const [authStatus, setAuthStatus] = useState<AuthStatus>("required");
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [authError, setAuthError] = useState("");

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [status, setStatus] = useState<PostStatus>("draft");

  const [isLoadingPost, setIsLoadingPost] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [editorError, setEditorError] = useState("");

  const previewHtml = useMemo(() => buildPreviewHtml(content), [content]);

  const verifyApiKey = async (key: string): Promise<boolean> => {
    const response = await fetch("/api/health", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    return response.ok;
  };

  useEffect(() => {
    setIsClientHydrated(true);
    const initializeAuth = async () => {
      try {
        const storedKey = window.localStorage.getItem(API_KEY_STORAGE_KEY);

        if (!storedKey) {
          setAuthStatus("required");
          return;
        }

        setAuthStatus("checking");
        const isValid = await verifyApiKey(storedKey);
        if (!isValid) {
          window.localStorage.removeItem(API_KEY_STORAGE_KEY);
          setApiKey(null);
          setAuthStatus("required");
          return;
        }

        setApiKey(storedKey);
        setAuthStatus("ready");
      } catch {
        setAuthStatus("required");
      }
    };

    initializeAuth().catch(() => {
      setAuthStatus("required");
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setEditPostId(parsePostId(params.get("id")));
  }, []);

  useEffect(() => {
    const loadPost = async (postId: number, currentApiKey: string) => {
      setIsLoadingPost(true);
      setEditorError("");

      try {
        const response = await fetch(`/api/posts/${postId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${currentApiKey}`,
          },
        });

        if (!response.ok) {
          throw new Error("글을 불러오지 못했습니다.");
        }

        const data = (await response.json()) as PostDetailResponse;
        setTitle(data.title ?? "");
        setContent(data.content ?? "");
        setTagsInput(Array.isArray(data.tags) ? data.tags.join(", ") : "");
        setStatus(data.status ?? "draft");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "글을 불러오는 중 오류가 발생했습니다.";
        setEditorError(message);
      } finally {
        setIsLoadingPost(false);
      }
    };

    if (!editPostId || authStatus !== "ready" || !apiKey) {
      return;
    }

    loadPost(editPostId, apiKey).catch((error) => {
      const message =
        error instanceof Error
          ? error.message
          : "글을 불러오는 중 오류가 발생했습니다.";
      setEditorError(message);
      setIsLoadingPost(false);
    });
  }, [apiKey, authStatus, editPostId]);

  const handleAuthSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalized = apiKeyInput.trim();
    if (!normalized) {
      setAuthError("API Key를 입력해 주세요.");
      return;
    }

    setAuthStatus("checking");
    setAuthError("");

    try {
      const isValid = await verifyApiKey(normalized);
      if (!isValid) {
        setAuthStatus("required");
        setAuthError("API Key가 올바르지 않습니다.");
        return;
      }

      window.localStorage.setItem(API_KEY_STORAGE_KEY, normalized);
      setApiKey(normalized);
      setAuthStatus("ready");
    } catch {
      setAuthStatus("required");
      setAuthError("인증 확인 중 오류가 발생했습니다.");
    }
  };

  const insertSnippetToEditor = (snippet: string) => {
    const textarea = textareaRef.current;

    if (!textarea) {
      setContent(
        (prev) =>
          `${prev}${prev.endsWith("\n") || prev.length === 0 ? "" : "\n"}${snippet}\n`,
      );
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    setContent((prev) => {
      const next = `${prev.slice(0, start)}${snippet}${prev.slice(end)}`;

      requestAnimationFrame(() => {
        textarea.focus();
        const cursor = start + snippet.length;
        textarea.setSelectionRange(cursor, cursor);
      });

      return next;
    });
  };

  const uploadFile = async (file: File) => {
    if (!apiKey) {
      setEditorError("업로드 전에 API Key 인증이 필요합니다.");
      return;
    }

    setIsUploading(true);
    setEditorError("");

    try {
      const formData = new FormData();
      formData.set("file", file);

      const response = await fetch("/api/uploads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      });

      const data = (await response.json()) as
        | { url: string }
        | { error?: { message?: string } };

      if (!response.ok || !("url" in data)) {
        const message =
          "error" in data && data.error?.message
            ? data.error.message
            : "업로드에 실패했습니다.";
        throw new Error(message);
      }

      insertSnippetToEditor(`![image](${data.url})`);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "업로드 중 오류가 발생했습니다.";
      setEditorError(message);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragOver(false);

    const file = event.dataTransfer.files.item(0);
    if (!file) {
      return;
    }

    await uploadFile(file);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!apiKey) {
      setEditorError("API Key 인증이 필요합니다.");
      return;
    }

    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();

    if (!normalizedTitle || !normalizedContent) {
      setEditorError("제목과 본문은 필수입니다.");
      return;
    }

    setIsSaving(true);
    setEditorError("");

    try {
      const payload = {
        title: normalizedTitle,
        content,
        tags: parseTags(tagsInput),
        status,
      };

      const endpoint = editPostId ? `/api/posts/${editPostId}` : "/api/posts";
      const method = editPostId ? "PATCH" : "POST";

      const response = await fetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as
        | { slug?: string; error?: { message?: string } }
        | { error: { message?: string } };

      if (!response.ok) {
        const message =
          "error" in data && data.error?.message
            ? data.error.message
            : "글 저장에 실패했습니다.";
        throw new Error(message);
      }

      const slug =
        "slug" in data && typeof data.slug === "string" ? data.slug : null;
      if (!slug) {
        throw new Error("저장 응답에 slug가 없습니다.");
      }

      router.push(`/posts/${slug}`);
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "글 저장 중 오류가 발생했습니다.";
      setEditorError(message);
    } finally {
      setIsSaving(false);
    }
  };

  if (authStatus === "checking") {
    return (
      <main
        className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8"
        data-hydrated={isClientHydrated ? "true" : "false"}
      >
        <p className="text-sm text-slate-600">API Key 확인 중입니다...</p>
      </main>
    );
  }

  if (authStatus === "required") {
    return (
      <main
        className="mx-auto w-full max-w-md px-4 py-8 sm:px-6 lg:px-8"
        data-hydrated={isClientHydrated ? "true" : "false"}
      >
        <h1 className="text-2xl font-semibold tracking-tight">글쓰기 인증</h1>
        <p className="mt-2 text-sm text-slate-600">
          API Key를 입력하면 브라우저 localStorage에 저장됩니다.
        </p>
        <form
          onSubmit={handleAuthSubmit}
          className="mt-6 space-y-3 rounded-xl border border-slate-200 bg-white p-4"
        >
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            API Key
            <input
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="BLOG_API_KEY"
              autoComplete="off"
            />
          </label>
          {authError ? (
            <p className="text-sm text-red-600">{authError}</p>
          ) : null}
          <button
            type="submit"
            className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            인증 후 편집기 열기
          </button>
        </form>
      </main>
    );
  }

  return (
    <main
      className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8"
      data-hydrated={isClientHydrated ? "true" : "false"}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {editPostId ? `글 수정 #${editPostId}` : "새 글 작성"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            프리뷰는 경량 렌더러(`marked`)를 사용합니다. 코드/수식의 최종
            렌더링은 저장 후 상세 페이지에서 확인하세요.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            window.localStorage.removeItem(API_KEY_STORAGE_KEY);
            setApiKey(null);
            setApiKeyInput("");
            setAuthStatus("required");
          }}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          API Key 초기화
        </button>
      </header>

      {editorError ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {editorError}
        </p>
      ) : null}

      <form onSubmit={handleSave} className="mt-6 space-y-4">
        <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-sm font-medium text-slate-700 sm:col-span-2">
            제목
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="제목을 입력하세요"
              disabled={isLoadingPost || isSaving}
            />
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            상태
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as PostStatus)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              disabled={isLoadingPost || isSaving}
            >
              <option value="draft">draft</option>
              <option value="published">published</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium text-slate-700 lg:col-span-3">
            태그 (콤마 구분)
            <input
              type="text"
              value={tagsInput}
              onChange={(event) => setTagsInput(event.target.value)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="nextjs, react"
              disabled={isLoadingPost || isSaving}
            />
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">Markdown</h2>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="min-h-[420px] w-full rounded-xl border border-slate-300 bg-white px-3 py-3 font-mono text-sm leading-6"
              placeholder="마크다운 본문을 입력하세요"
              disabled={isLoadingPost || isSaving}
            />
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-slate-700">
              실시간 프리뷰
            </h2>
            <article
              className="prose min-h-[420px] max-w-none rounded-xl border border-slate-200 bg-white p-4"
              dangerouslySetInnerHTML={{
                __html:
                  previewHtml.length > 0
                    ? previewHtml
                    : "<p>미리보기를 표시할 내용이 없습니다.</p>",
              }}
            />
          </section>
        </div>

        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">
            이미지 업로드
          </h2>
          <label
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={(event) => {
              handleDrop(event).catch(() => {
                setIsDragOver(false);
              });
            }}
            className={`flex cursor-pointer items-center justify-center rounded-lg border border-dashed px-4 py-6 text-sm ${
              isDragOver
                ? "border-slate-900 bg-slate-100"
                : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {isUploading
              ? "업로드 중..."
              : "이미지를 드래그&드롭하거나 클릭해서 선택하세요"}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.item(0);
                if (!file) {
                  return;
                }

                uploadFile(file).catch((error) => {
                  const message =
                    error instanceof Error
                      ? error.message
                      : "업로드 중 오류가 발생했습니다.";
                  setEditorError(message);
                });
              }}
              disabled={isUploading || isSaving}
            />
          </label>
        </section>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            disabled={isUploading || isSaving}
          >
            파일 선택
          </button>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-5 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
            disabled={isSaving || isLoadingPost || isUploading}
          >
            {isSaving
              ? "저장 중..."
              : editPostId
                ? "수정 내용 저장"
                : status === "published"
                  ? "게시하기"
                  : "초안 저장"}
          </button>
        </div>
      </form>
    </main>
  );
}
