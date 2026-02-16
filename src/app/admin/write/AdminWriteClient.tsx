"use client";

import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";
import {
  useMemo,
  useRef,
  useState,
  useEffect,
  type DragEvent,
  type FormEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { adminFetch } from "@/lib/admin-client";

type PostStatus = "draft" | "published";

type PostDetailResponse = {
  id: number;
  title: string;
  slug: string;
  content: string;
  status: PostStatus;
  tags: string[];
};

type SavePostSuccessResponse = {
  id?: number;
  slug?: string;
  status?: PostStatus;
  error?: { message?: string };
};

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

  const html = typeof parsed === "string" ? parsed : "";
  return DOMPurify.sanitize(html);
}

export default function AdminWriteClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editPostId, setEditPostId] = useState<number | null>(null);
  const [isLoadingPost, setIsLoadingPost] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [editorError, setEditorError] = useState("");

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [status, setStatus] = useState<PostStatus>("draft");

  const previewHtml = useMemo(() => buildPreviewHtml(content), [content]);

  useEffect(() => {
    setEditPostId(parsePostId(searchParams.get("id")));
  }, [searchParams]);

  useEffect(() => {
    const loadPost = async (postId: number) => {
      setIsLoadingPost(true);
      setEditorError("");

      try {
        const response = await adminFetch(`/api/admin/posts/${postId}`, {
          method: "GET",
        });

        if (response.status === 401) {
          router.replace(`/admin/login?next=${encodeURIComponent(`/admin/write?id=${postId}`)}`);
          return;
        }

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

    if (!editPostId) {
      return;
    }

    loadPost(editPostId).catch((error) => {
      const message =
        error instanceof Error
          ? error.message
          : "글을 불러오는 중 오류가 발생했습니다.";
      setEditorError(message);
      setIsLoadingPost(false);
    });
  }, [editPostId, router]);

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
    setIsUploading(true);
    setEditorError("");

    try {
      const formData = new FormData();
      formData.set("file", file);

      const response = await adminFetch("/api/admin/uploads", {
        method: "POST",
        body: formData,
      });

      if (response.status === 401) {
        router.replace("/admin/login?next=/admin/write");
        return;
      }

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
        error instanceof Error ? error.message : "업로드 중 오류가 발생했습니다.";
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

      const endpoint = editPostId ? `/api/admin/posts/${editPostId}` : "/api/admin/posts";
      const method = editPostId ? "PATCH" : "POST";

      const response = await adminFetch(endpoint, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401) {
        router.replace(`/admin/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }

      const data = (await response.json()) as SavePostSuccessResponse;
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

      const nextId =
        typeof data.id === "number" && Number.isInteger(data.id) && data.id > 0
          ? data.id
          : editPostId;

      if (status === "published") {
        router.push(`/posts/${slug}`);
      } else {
        if (!nextId) {
          throw new Error("저장 응답에 id가 없습니다.");
        }
        setEditPostId(nextId);
        router.push(`/admin/write?id=${nextId}`);
      }
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "글 저장 중 오류가 발생했습니다.";
      setEditorError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    try {
      await adminFetch("/api/admin/auth/logout", { method: "POST" });
    } finally {
      router.replace("/admin/login");
      router.refresh();
    }
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {editPostId ? `글 수정 #${editPostId}` : "새 글 작성"}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            관리자 세션 기반 편집기입니다. 상태 변경 API는 CSRF 검증이 적용됩니다.
          </p>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          로그아웃
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
            <h2 className="text-sm font-semibold text-slate-700">실시간 프리뷰</h2>
            <article
              className="markdown-preview min-h-[420px] rounded-xl border border-slate-200 bg-white p-4"
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
          <h2 className="text-sm font-semibold text-slate-700">이미지 업로드</h2>
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

