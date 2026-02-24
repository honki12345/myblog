"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  MAX_SEARCH_QUERY_LENGTH,
  POSTS_SUGGEST_MIN_QUERY_LENGTH,
} from "@/lib/posts-search";

type SuggestItem = {
  id: number;
  slug: string;
  title: string;
  status: "draft" | "published";
  publishedAt: string | null;
};

type SuggestResponse = {
  items: SuggestItem[];
  meta: { q: string; truncated: boolean };
};

type Props = {
  inputId: string;
  name: string;
  defaultValue: string;
  placeholder?: string;
  className?: string;
};

const DEBOUNCE_MS = 200;

function getHrefForItem(item: SuggestItem): string {
  if (item.status === "published") {
    return `/posts/${item.slug}`;
  }
  return `/admin/write?id=${item.id}`;
}

export default function PostsSearchTypeahead({
  inputId,
  name,
  defaultValue,
  placeholder,
  className,
}: Props) {
  const router = useRouter();
  const reactId = useId();
  const listboxId = `posts-suggest-listbox-${reactId}`;
  const optionIdPrefix = `posts-suggest-option-${reactId}`;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const requestIdRef = useRef(0);

  const [value, setValue] = useState(defaultValue);
  const [items, setItems] = useState<SuggestItem[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  const query = useMemo(() => value.trim(), [value]);

  useEffect(() => {
    setValue(defaultValue);
  }, [defaultValue]);

  useEffect(() => {
    const handler = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (rootRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
      setActiveIndex(-1);
    };

    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, []);

  useEffect(() => {
    if (!isFocused || isComposing) {
      return;
    }

    if (query.length < POSTS_SUGGEST_MIN_QUERY_LENGTH) {
      setItems([]);
      setActiveIndex(-1);
      setIsLoading(false);
      setError(null);
      setIsOpen(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const requestId = ++requestIdRef.current;

    setItems([]);
    setActiveIndex(-1);
    setIsLoading(false);
    setError(null);
    setIsOpen(false);

    const timeout = window.setTimeout(async () => {
      if (cancelled || requestId !== requestIdRef.current) {
        return;
      }

      setIsLoading(true);
      setIsOpen(true);

      try {
        const response = await fetch(
          `/api/posts/suggest?q=${encodeURIComponent(query)}`,
          {
            signal: controller.signal,
          },
        );

        if (cancelled || requestId !== requestIdRef.current) {
          return;
        }

        if (!response.ok) {
          setItems([]);
          setActiveIndex(-1);
          setError("추천을 불러오지 못했습니다");
          setIsOpen(true);
          return;
        }

        const payload = (await response.json()) as SuggestResponse;
        if (cancelled || requestId !== requestIdRef.current) {
          return;
        }

        const nextItems = Array.isArray(payload.items) ? payload.items : [];
        setItems(nextItems);
        setActiveIndex(-1);
        setError(null);
        setIsOpen(nextItems.length > 0);
      } catch (thrown) {
        if (
          thrown &&
          typeof thrown === "object" &&
          "name" in thrown &&
          thrown.name === "AbortError"
        ) {
          return;
        }

        setItems([]);
        setActiveIndex(-1);
        setError("추천을 불러오지 못했습니다");
        setIsOpen(true);
      } finally {
        if (!cancelled && requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, isFocused, isComposing]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) {
      return;
    }

    const option = document.getElementById(`${optionIdPrefix}-${activeIndex}`);
    option?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen, optionIdPrefix]);

  const selectItem = (item: SuggestItem) => {
    const href = getHrefForItem(item);
    setIsOpen(false);
    setActiveIndex(-1);
    router.push(href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
        setActiveIndex(-1);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      if (items.length === 0) {
        return;
      }
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((prev) => {
        if (prev < 0) {
          return 0;
        }
        return Math.min(items.length - 1, prev + 1);
      });
      return;
    }

    if (event.key === "ArrowUp") {
      if (items.length === 0) {
        return;
      }
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((prev) => {
        if (prev < 0) {
          return items.length - 1;
        }
        return Math.max(0, prev - 1);
      });
      return;
    }

    if (event.key === "Enter") {
      if (isOpen && activeIndex >= 0 && activeIndex < items.length) {
        event.preventDefault();
        selectItem(items[activeIndex]);
      }
    }
  };

  const optionId =
    isOpen && activeIndex >= 0 ? `${optionIdPrefix}-${activeIndex}` : undefined;

  return (
    <div
      ref={rootRef}
      data-posts-search-typeahead="true"
      className="grid gap-2"
      onBlurCapture={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && rootRef.current?.contains(next)) {
          return;
        }

        setIsOpen(false);
        setActiveIndex(-1);
        setIsFocused(false);
      }}
      onFocusCapture={() => {
        setIsFocused(true);
      }}
    >
      <input
        id={inputId}
        name={name}
        value={value}
        maxLength={MAX_SEARCH_QUERY_LENGTH}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={optionId}
        aria-haspopup="listbox"
        className={className}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={onKeyDown}
      />

      <ul
        id={listboxId}
        role="listbox"
        aria-label="검색 추천"
        hidden={!isOpen}
        className="max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
      >
        {isLoading ? (
          <li
            role="option"
            aria-disabled="true"
            aria-selected={false}
            className="px-3 py-2 text-sm text-slate-600 dark:text-slate-300"
          >
            검색 중...
          </li>
        ) : null}

        {error ? (
          <li
            role="option"
            aria-disabled="true"
            aria-selected={false}
            className="px-3 py-2 text-sm text-rose-700 dark:text-rose-300"
          >
            {error}
          </li>
        ) : null}

        {!isLoading && !error
          ? items.map((item, index) => {
              const isActive = index === activeIndex;

              return (
                <li
                  key={`${item.status}-${item.id}-${item.slug}`}
                  id={`${optionIdPrefix}-${index}`}
                  role="option"
                  aria-selected={isActive}
                  tabIndex={-1}
                  className={
                    isActive
                      ? "cursor-pointer bg-slate-100 dark:bg-slate-800"
                      : "cursor-pointer bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/70"
                  }
                  onMouseMove={() => {
                    if (activeIndex !== index) {
                      setActiveIndex(index);
                    }
                  }}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectItem(item);
                  }}
                >
                  <div className="flex w-full items-start gap-2 px-3 py-2 text-sm text-slate-900 dark:text-slate-100">
                    <span className="min-w-0 flex-1 break-words">
                      {item.title}
                    </span>
                    {item.status === "draft" ? (
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/45 dark:text-amber-200">
                        draft
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })
          : null}
      </ul>
    </div>
  );
}
