"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildWikiPathHref,
  normalizeWikiPathFromSegments,
} from "@/lib/comment-tags";
import { formatDate } from "@/lib/date";
import type {
  WikiCategory,
  WikiPathOverview,
  WikiRootOverview,
} from "@/lib/wiki";

const ROOT_WIKI_HREF = "/wiki";
const DEFAULT_COMMENT_LIMIT = 120;
const ROOT_SCROLL_KEY = "__root__";

type HistoryMode = "push" | "replace";
type MobilePanel = "tree" | "detail";
type NavigationSource = "user" | "popstate" | "initial";
type PathValue = string | null;

type WikiExplorerClientProps = {
  initialRootOverview: WikiRootOverview;
  initialPath: PathValue;
  initialPathOverview: WikiPathOverview | null;
  enableInPlaceNavigation?: boolean;
  isAdmin?: boolean;
};

function isPlainLeftClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  if (event.button !== 0) {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  return true;
}

function encodeWikiPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildWikiApiPathHref(path: string): string {
  const encodedPath = encodeWikiPath(path);
  return `/api/wiki/${encodedPath}?limit=${DEFAULT_COMMENT_LIMIT}`;
}

function buildWikiHref(path: PathValue): string {
  if (!path) {
    return ROOT_WIKI_HREF;
  }
  return buildWikiPathHref(path);
}

function getPathKey(path: PathValue): string {
  return path ?? ROOT_SCROLL_KEY;
}

function getAncestorPaths(path: string): string[] {
  const segments = path.split("/");
  const ancestors: string[] = [];
  let current = "";

  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    ancestors.push(current);
  }

  return ancestors;
}

function getParentPath(path: string): PathValue {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash < 0) {
    return null;
  }
  return path.slice(0, lastSlash);
}

function parseWikiPathFromLocation(pathname: string): PathValue | "outside" {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  if (normalizedPathname === ROOT_WIKI_HREF) {
    return null;
  }
  if (!normalizedPathname.startsWith(`${ROOT_WIKI_HREF}/`)) {
    return "outside";
  }

  const rawSegments = normalizedPathname
    .slice(ROOT_WIKI_HREF.length + 1)
    .split("/")
    .filter((segment) => segment.length > 0);

  const normalizedPath = normalizeWikiPathFromSegments(rawSegments);
  if (!normalizedPath) {
    return "outside";
  }

  return normalizedPath;
}

function buildBreadcrumbs(
  path: string,
): Array<{ label: string; path: string }> {
  const segments = path.split("/");
  const crumbs: Array<{ label: string; path: string }> = [];
  let current = "";

  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    crumbs.push({ label: segment, path: current });
  }

  return crumbs;
}

function formatLoadError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "경로 데이터를 불러오지 못했습니다.";
}

export default function WikiExplorerClient({
  initialRootOverview,
  initialPath,
  initialPathOverview,
  enableInPlaceNavigation = true,
  isAdmin = false,
}: WikiExplorerClientProps) {
  const [selectedPath, setSelectedPath] = useState<PathValue>(initialPath);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(
    initialPath ? "detail" : "tree",
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => {
    return new Set(initialPath ? getAncestorPaths(initialPath) : []);
  });
  const [pathOverviews, setPathOverviews] = useState<
    Record<string, WikiPathOverview>
  >(() => {
    if (!initialPathOverview) {
      return {};
    }
    return {
      [initialPathOverview.path]: initialPathOverview,
    };
  });
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [pathErrors, setPathErrors] = useState<Record<string, string>>({});

  const inflightRequestsRef = useRef(
    new Map<string, Promise<WikiPathOverview>>(),
  );
  const selectedPathRef = useRef<PathValue>(initialPath);
  const pathOverviewsRef = useRef(pathOverviews);
  const scrollByPathRef = useRef<Record<string, number>>({});

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  useEffect(() => {
    pathOverviewsRef.current = pathOverviews;
  }, [pathOverviews]);

  const setPathLoading = useCallback((path: string, isLoading: boolean) => {
    setLoadingPaths((current) => {
      const next = new Set(current);
      if (isLoading) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }, []);

  const syncBrowserHistory = useCallback(
    (path: PathValue, mode: HistoryMode) => {
      if (!enableInPlaceNavigation) {
        return;
      }
      if (typeof window === "undefined") {
        return;
      }

      const href = buildWikiHref(path);
      const currentPath = parseWikiPathFromLocation(window.location.pathname);
      const resolvedMode: HistoryMode =
        currentPath !== "outside" && currentPath === path ? "replace" : mode;
      const historyState = {
        ...(window.history.state ?? {}),
        wikiPath: path,
      };

      if (resolvedMode === "push") {
        window.history.pushState(historyState, "", href);
        return;
      }

      window.history.replaceState(historyState, "", href);
    },
    [enableInPlaceNavigation],
  );

  const loadPathOverview = useCallback(
    async (path: string): Promise<WikiPathOverview> => {
      const cached = pathOverviewsRef.current[path];
      if (cached) {
        return cached;
      }

      const inflight = inflightRequestsRef.current.get(path);
      if (inflight) {
        return inflight;
      }

      setPathErrors((current) => {
        if (!(path in current)) {
          return current;
        }
        const next = { ...current };
        delete next[path];
        return next;
      });
      setPathLoading(path, true);

      const requestPromise = (async () => {
        const response = await fetch(buildWikiApiPathHref(path), {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error("해당 경로를 찾을 수 없습니다.");
          }
          throw new Error(
            `경로 데이터를 불러오지 못했습니다. (${response.status})`,
          );
        }

        const data = (await response.json()) as WikiPathOverview;
        return data;
      })();

      inflightRequestsRef.current.set(path, requestPromise);

      try {
        const overview = await requestPromise;
        setPathOverviews((current) => {
          if (current[path]) {
            return current;
          }
          return {
            ...current,
            [path]: overview,
          };
        });
        return overview;
      } catch (error) {
        setPathErrors((current) => ({
          ...current,
          [path]: formatLoadError(error),
        }));
        throw error;
      } finally {
        inflightRequestsRef.current.delete(path);
        setPathLoading(path, false);
      }
    },
    [setPathLoading],
  );

  const expandPathChain = useCallback((path: string) => {
    const chain = getAncestorPaths(path);
    setExpandedPaths((current) => {
      const next = new Set(current);
      for (const item of chain) {
        next.add(item);
      }
      return next;
    });
  }, []);

  const rememberCurrentScroll = useCallback(() => {
    if (typeof window === "undefined") {
      return;
    }
    const currentKey = getPathKey(selectedPathRef.current);
    scrollByPathRef.current[currentKey] = window.scrollY;
  }, []);

  const restoreScrollForPath = useCallback(
    (path: PathValue, source: NavigationSource) => {
      if (typeof window === "undefined") {
        return;
      }
      const nextKey = getPathKey(path);
      const savedTop = scrollByPathRef.current[nextKey] ?? 0;
      const top = source === "popstate" ? savedTop : 0;
      const applyScroll = () => {
        window.scrollTo({
          top,
          left: 0,
          behavior: "auto",
        });
      };

      window.requestAnimationFrame(() => {
        applyScroll();
        window.setTimeout(applyScroll, 0);
        window.setTimeout(applyScroll, 60);
      });
    },
    [],
  );

  const preloadPathContext = useCallback(
    (path: string) => {
      const chain = getAncestorPaths(path);
      for (const item of chain) {
        void loadPathOverview(item).catch(() => {
          // failed branch loading is surfaced in the detail panel when selected
        });
      }
    },
    [loadPathOverview],
  );

  const activatePath = useCallback(
    (
      nextPath: PathValue,
      options: { source: NavigationSource; historyMode?: HistoryMode },
    ) => {
      const previousPath = selectedPathRef.current;
      const changed = previousPath !== nextPath;

      if (changed) {
        rememberCurrentScroll();
      }

      setSelectedPath(nextPath);
      selectedPathRef.current = nextPath;

      if (nextPath) {
        expandPathChain(nextPath);
        preloadPathContext(nextPath);
      }

      if (options.source === "user") {
        setMobilePanel("detail");
      }

      if (options.historyMode) {
        syncBrowserHistory(nextPath, options.historyMode);
      }

      if (changed) {
        restoreScrollForPath(nextPath, options.source);
      }
    },
    [
      expandPathChain,
      preloadPathContext,
      rememberCurrentScroll,
      restoreScrollForPath,
      syncBrowserHistory,
    ],
  );

  useEffect(() => {
    if (!initialPath) {
      return;
    }
    expandPathChain(initialPath);
    preloadPathContext(initialPath);
  }, [expandPathChain, initialPath, preloadPathContext]);

  useEffect(() => {
    if (!enableInPlaceNavigation) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    syncBrowserHistory(initialPath, "replace");

    const handlePopState = () => {
      const parsed = parseWikiPathFromLocation(window.location.pathname);
      if (parsed === "outside") {
        return;
      }

      activatePath(parsed, { source: "popstate" });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [activatePath, enableInPlaceNavigation, initialPath, syncBrowserHistory]);

  const breadcrumbs = useMemo(() => {
    if (!selectedPath) {
      return [];
    }
    return buildBreadcrumbs(selectedPath);
  }, [selectedPath]);

  const selectedOverview = selectedPath ? pathOverviews[selectedPath] : null;
  const selectedError = selectedPath ? pathErrors[selectedPath] : null;
  const isSelectedPathLoading = Boolean(
    selectedPath && loadingPaths.has(selectedPath),
  );
  const parentPath = useMemo(() => {
    if (!selectedPath) {
      return null;
    }
    return getParentPath(selectedPath);
  }, [selectedPath]);
  const parentPathHref = useMemo(() => {
    return buildWikiHref(parentPath);
  }, [parentPath]);
  const parentPathLabel = useMemo(() => {
    if (parentPath) {
      return `${ROOT_WIKI_HREF}/${parentPath}`;
    }
    return ROOT_WIKI_HREF;
  }, [parentPath]);

  const collapsePathBranch = useCallback((path: string) => {
    setExpandedPaths((current) => {
      const next = new Set<string>();
      for (const item of current) {
        if (item === path || item.startsWith(`${path}/`)) {
          continue;
        }
        next.add(item);
      }
      return next;
    });
  }, []);

  const handlePathLinkClick = useCallback(
    (
      event: React.MouseEvent<HTMLAnchorElement>,
      path: PathValue,
      options: {
        forceReplace?: boolean;
        collapseActiveBranchOnRepeat?: boolean;
      } = {},
    ) => {
      if (!enableInPlaceNavigation) {
        return;
      }
      if (!isPlainLeftClick(event)) {
        return;
      }

      event.preventDefault();

      if (
        options.collapseActiveBranchOnRepeat &&
        path &&
        selectedPathRef.current === path
      ) {
        collapsePathBranch(path);
        return;
      }

      const currentPath =
        typeof window === "undefined"
          ? selectedPathRef.current
          : parseWikiPathFromLocation(window.location.pathname);
      const historyMode: HistoryMode =
        options.forceReplace ||
        (currentPath !== "outside" && currentPath === path)
          ? "replace"
          : "push";

      activatePath(path, {
        source: "user",
        historyMode,
      });
    },
    [activatePath, collapsePathBranch, enableInPlaceNavigation],
  );

  const handlePathToggle = useCallback(
    (path: string) => {
      setExpandedPaths((current) => {
        const next = new Set(current);
        const wasExpanded = next.has(path);
        if (wasExpanded) {
          next.delete(path);
        } else {
          next.add(path);
          void loadPathOverview(path).catch(() => {
            // keep UI responsive and surface errors only where context is shown
          });
        }
        return next;
      });
    },
    [loadPathOverview],
  );

  const treeRootCategories = initialRootOverview.categories;

  const treePanelClassName = [
    "md:min-h-[48rem] md:max-h-[calc(100vh-18rem)] md:overflow-y-auto",
    mobilePanel === "tree" ? "block" : "hidden md:block",
  ].join(" ");
  const detailPanelClassName = [
    "md:min-h-[48rem] md:max-h-[calc(100vh-18rem)] md:overflow-y-auto",
    mobilePanel === "detail" ? "block" : "hidden md:block",
  ].join(" ");

  const renderTreeNodes = (categories: WikiCategory[], depth: number) => {
    if (categories.length === 0) {
      return null;
    }

    return (
      <ul className="space-y-1" data-wiki-tree-level={depth}>
        {categories.map((category) => {
          const nodePath = category.path;
          const isExpanded = expandedPaths.has(nodePath);
          const isActive = selectedPath === nodePath;
          const isInActiveBranch = Boolean(
            selectedPath?.startsWith(`${nodePath}/`),
          );
          const childCategories = pathOverviews[nodePath]?.categories ?? [];
          const childError = pathErrors[nodePath];
          const childIsLoading = loadingPaths.has(nodePath);

          return (
            <li key={nodePath} data-wiki-tree-node={nodePath}>
              <div
                className={[
                  "flex items-center gap-1 rounded-lg px-1 py-1",
                  isActive
                    ? "bg-slate-900 text-white"
                    : isInActiveBranch
                      ? "bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100"
                      : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
                ].join(" ")}
                style={{ paddingLeft: `${Math.max(0, depth - 1) * 0.5}rem` }}
              >
                {category.hasChildren ? (
                  <button
                    type="button"
                    onClick={() => handlePathToggle(nodePath)}
                    className={[
                      "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-semibold",
                      "focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:ring-offset-slate-900 dark:focus-visible:ring-slate-300",
                      isActive
                        ? "text-white/90 hover:bg-white/10"
                        : "hover:bg-slate-200 dark:hover:bg-slate-700",
                    ].join(" ")}
                    aria-label={`${category.segment} ${isExpanded ? "접기" : "펼치기"}`}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? "−" : "+"}
                  </button>
                ) : (
                  <span
                    className="inline-flex size-6 shrink-0 items-center justify-center text-[10px]"
                    aria-hidden
                  >
                    •
                  </span>
                )}

                <Link
                  href={buildWikiHref(nodePath)}
                  onClick={(event) =>
                    handlePathLinkClick(event, nodePath, {
                      collapseActiveBranchOnRepeat: true,
                    })
                  }
                  aria-current={isActive ? "page" : undefined}
                  className={[
                    "min-w-0 flex-1 truncate rounded-md px-1.5 py-1 text-sm font-medium",
                    "focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:ring-offset-slate-900 dark:focus-visible:ring-slate-300",
                    isActive ? "text-white" : "",
                  ].join(" ")}
                >
                  {category.segment}
                </Link>

                <span
                  className={[
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                    isActive
                      ? "bg-white/20 text-white"
                      : "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200",
                  ].join(" ")}
                >
                  {category.count}
                </span>
              </div>

              {category.hasChildren && isExpanded ? (
                <div className="ml-3 border-l border-slate-200 pl-2 dark:border-slate-700">
                  {childIsLoading ? (
                    <p className="py-2 text-xs text-slate-500 dark:text-slate-400">
                      하위 경로를 불러오는 중...
                    </p>
                  ) : childError ? (
                    <div className="space-y-1 py-2">
                      <p className="text-xs text-red-600 dark:text-rose-300">
                        {childError}
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          void loadPathOverview(nodePath).catch(() => {
                            // retry error is kept in state and shown above
                          });
                        }}
                        className="inline-flex rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:border-slate-600 dark:text-slate-200 dark:ring-offset-slate-900 dark:hover:bg-slate-800/70 dark:focus-visible:ring-slate-300"
                      >
                        다시 시도
                      </button>
                    </div>
                  ) : childCategories.length > 0 ? (
                    renderTreeNodes(childCategories, depth + 1)
                  ) : (
                    <p className="py-2 text-xs text-slate-500 dark:text-slate-400">
                      하위 경로가 없습니다.
                    </p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <section className="space-y-4" data-wiki-explorer>
      <div className="md:hidden">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            data-wiki-mobile-tab="tree"
            onClick={() => setMobilePanel("tree")}
            className={[
              "rounded-lg px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:ring-offset-slate-900 dark:focus-visible:ring-slate-300",
              mobilePanel === "tree"
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
            ].join(" ")}
          >
            트리
          </button>
          <button
            type="button"
            data-wiki-mobile-tab="detail"
            onClick={() => setMobilePanel("detail")}
            className={[
              "rounded-lg px-3 py-2 text-sm font-medium focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:ring-offset-slate-900 dark:focus-visible:ring-slate-300",
              mobilePanel === "detail"
                ? "bg-slate-900 text-white"
                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800",
            ].join(" ")}
          >
            상세
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <aside
          className={[
            "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900",
            treePanelClassName,
          ].join(" ")}
          data-wiki-tree-panel
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold tracking-tight">
              카테고리 트리
            </h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              루트 {treeRootCategories.length}개
            </span>
          </div>

          <div className="space-y-2">
            <Link
              href={buildWikiHref(null)}
              onClick={(event) => handlePathLinkClick(event, null)}
              aria-current={selectedPath === null ? "page" : undefined}
              data-wiki-active-path={selectedPath === null ? "root" : undefined}
              data-wiki-root-card
              className={[
                "flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]",
                "focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:ring-offset-slate-900 dark:focus-visible:ring-slate-300",
                selectedPath === null
                  ? "border-amber-700 bg-amber-900 text-amber-50"
                  : "border-amber-200 bg-linear-to-r from-amber-50 to-white text-amber-900 hover:border-amber-300 hover:from-amber-100 hover:to-white dark:border-amber-700 dark:text-amber-100",
              ].join(" ")}
            >
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">위키 루트</span>
                <span
                  className={[
                    "text-[11px]",
                    selectedPath === null
                      ? "text-amber-100/90"
                      : "text-amber-700 dark:text-amber-200",
                  ].join(" ")}
                >
                  전체 경로 보기
                </span>
              </span>
              <span
                className={[
                  "rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums",
                  selectedPath === null
                    ? "bg-amber-100/20 text-amber-50"
                    : "bg-amber-100 text-amber-900 dark:bg-amber-900/45 dark:text-amber-100",
                ].join(" ")}
              >
                {initialRootOverview.totalPaths}
              </span>
            </Link>

            {treeRootCategories.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-xs text-slate-500 dark:border-slate-600 dark:text-slate-400">
                아직 공개된 위키 데이터가 없습니다.
              </p>
            ) : (
              renderTreeNodes(treeRootCategories, 1)
            )}
          </div>
        </aside>

        <section
          className={[
            "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900",
            detailPanelClassName,
          ].join(" ")}
          data-wiki-detail-panel
        >
          {selectedPath ? (
            <div className="space-y-4">
              <header className="space-y-3">
                <nav aria-label="브레드크럼">
                  <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-600 dark:text-slate-300">
                    <li>
                      <Link
                        href={buildWikiHref(null)}
                        onClick={(event) =>
                          handlePathLinkClick(event, null, {
                            forceReplace: true,
                          })
                        }
                        className="rounded px-1 py-0.5 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:ring-offset-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus-visible:ring-slate-300"
                      >
                        위키
                      </Link>
                    </li>
                    {breadcrumbs.map((item) => (
                      <li key={item.path} className="flex items-center gap-1">
                        <span>/</span>
                        <Link
                          href={buildWikiHref(item.path)}
                          onClick={(event) =>
                            handlePathLinkClick(event, item.path)
                          }
                          className="rounded px-1 py-0.5 hover:bg-slate-100 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:ring-offset-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100 dark:focus-visible:ring-slate-300"
                        >
                          {item.label}
                        </Link>
                      </li>
                    ))}
                  </ol>
                </nav>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2
                    className="text-xl font-semibold tracking-tight"
                    data-wiki-active-path={selectedPath}
                  >
                    위키 경로: /{selectedPath}
                  </h2>
                  <Link
                    href={parentPathHref}
                    onClick={(event) => handlePathLinkClick(event, parentPath)}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:border-slate-600 dark:text-slate-200 dark:ring-offset-slate-900 dark:hover:bg-slate-800 dark:focus-visible:ring-slate-300"
                  >
                    <span className="shrink-0">상위 경로</span>
                    <span className="min-w-0 text-[11px] break-all whitespace-normal text-slate-500 sm:max-w-52 sm:truncate sm:break-normal sm:whitespace-nowrap dark:text-slate-400">
                      ({parentPathLabel})
                    </span>
                  </Link>
                </div>
                {selectedOverview ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    정확히 매칭된 댓글 {selectedOverview.exactCount}개, 하위
                    경로 포함 총 {selectedOverview.totalCount}개
                  </p>
                ) : isSelectedPathLoading ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    경로 데이터를 불러오는 중입니다...
                  </p>
                ) : selectedError ? (
                  <p className="text-sm text-red-600 dark:text-rose-300">
                    {selectedError}
                  </p>
                ) : (
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    경로 데이터를 준비 중입니다.
                  </p>
                )}
              </header>

              {selectedError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-rose-800 dark:bg-rose-950/40">
                  <p className="text-sm text-red-700 dark:text-rose-300">
                    {selectedError}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      void loadPathOverview(selectedPath).catch(() => {
                        // retry result is reflected by state updates
                      });
                    }}
                    className="mt-3 inline-flex rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-300 focus-visible:ring-offset-2 focus-visible:ring-offset-red-50 focus-visible:outline-none dark:border-rose-700 dark:text-rose-300 dark:hover:bg-rose-900/55"
                  >
                    다시 시도
                  </button>
                </div>
              ) : null}

              {selectedOverview ? (
                <>
                  {selectedOverview.categories.length > 0 ? (
                    <section
                      aria-labelledby="wiki-child-categories"
                      className="space-y-3"
                    >
                      <div className="flex items-end justify-between gap-3">
                        <h3
                          id="wiki-child-categories"
                          className="text-base font-semibold tracking-tight"
                        >
                          하위 카테고리
                        </h3>
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          {selectedOverview.categories.length}개
                        </p>
                      </div>
                      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {selectedOverview.categories.map((category) => (
                          <li key={category.path}>
                            <Link
                              href={buildWikiHref(category.path)}
                              onClick={(event) =>
                                handlePathLinkClick(event, category.path)
                              }
                              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:border-slate-700 dark:bg-slate-900 dark:ring-offset-slate-900 dark:hover:border-slate-600 dark:focus-visible:ring-slate-300"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  {category.segment}
                                </p>
                                <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                                  /{category.path}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 tabular-nums dark:bg-slate-800 dark:text-slate-200">
                                {category.count}개
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}

                  <section
                    aria-labelledby="wiki-comments-heading"
                    className="space-y-3"
                  >
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <h3
                        id="wiki-comments-heading"
                        className="text-base font-semibold"
                      >
                        연결된 댓글
                      </h3>
                      {selectedOverview.truncated ? (
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          최신 {DEFAULT_COMMENT_LIMIT}개만 표시합니다.
                        </p>
                      ) : null}
                    </div>

                    {selectedOverview.comments.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-600 dark:bg-slate-900">
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                          이 경로에 노출 가능한 댓글이 없습니다.
                        </p>
                      </div>
                    ) : (
                      <ul className="space-y-3">
                        {selectedOverview.comments.map((comment) => (
                          <li
                            key={comment.commentId}
                            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"
                          >
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              <Link
                                href={buildWikiHref(comment.tagPath)}
                                onClick={(event) =>
                                  handlePathLinkClick(event, comment.tagPath)
                                }
                                className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:bg-slate-800 dark:text-slate-200 dark:ring-offset-slate-900 dark:hover:bg-slate-700 dark:focus-visible:ring-slate-300"
                              >
                                /{comment.tagPath}
                              </Link>
                              <span className="text-xs text-slate-500 dark:text-slate-400">
                                업데이트: {formatDate(comment.updatedAt) ?? "-"}
                              </span>
                            </div>

                            <p className="text-sm leading-6 whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                              {comment.content}
                            </p>

                            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-300">
                              {isAdmin ? (
                                <Link
                                  href={`/posts/${comment.postSlug}`}
                                  className="font-medium text-slate-700 hover:underline dark:text-slate-200"
                                >
                                  블로그 글 보기
                                </Link>
                              ) : null}
                              {comment.sourceUrl ? (
                                <a
                                  href={comment.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium text-slate-700 hover:underline dark:text-slate-200"
                                >
                                  원문 링크
                                </a>
                              ) : null}
                              <span>{comment.postTitle}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <header className="space-y-2">
                <h2 className="text-xl font-semibold tracking-tight">위키</h2>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  공개 댓글 {initialRootOverview.totalComments}개 / 경로{" "}
                  {initialRootOverview.totalPaths}개
                </p>
              </header>

              {treeRootCategories.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-600 dark:bg-slate-900">
                  <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">
                    빈 위키
                  </h3>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                    관리자가 댓글에 태그 경로를 추가하면 카테고리가 표시됩니다.
                  </p>
                </div>
              ) : (
                <section
                  aria-labelledby="wiki-root-categories"
                  className="space-y-3"
                >
                  <div className="flex items-end justify-between gap-3">
                    <h3
                      id="wiki-root-categories"
                      className="text-base font-semibold tracking-tight"
                    >
                      루트 카테고리
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      {treeRootCategories.length}개
                    </p>
                  </div>

                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {treeRootCategories.map((category) => (
                      <li key={category.path}>
                        <Link
                          href={buildWikiHref(category.path)}
                          onClick={(event) =>
                            handlePathLinkClick(event, category.path)
                          }
                          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:border-slate-700 dark:bg-slate-900 dark:ring-offset-slate-900 dark:hover:border-slate-600 dark:focus-visible:ring-slate-300"
                        >
                          <div className="min-w-0 space-y-1">
                            <p className="truncate text-base font-semibold text-slate-900 dark:text-slate-100">
                              {category.segment}
                            </p>
                            <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                              /{category.path}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 tabular-nums dark:bg-slate-800 dark:text-slate-200">
                              {category.count}개
                            </span>
                            {category.hasChildren ? (
                              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                하위 있음
                              </span>
                            ) : (
                              <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                                leaf
                              </span>
                            )}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
