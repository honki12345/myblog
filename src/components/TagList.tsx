import Link from "next/link";
import {
  buildWikiPathHref,
  normalizeWikiPathFromTagName,
} from "@/lib/comment-tags";

type TagListProps = {
  tags: string[];
};

export default function TagList({ tags }: TagListProps) {
  if (tags.length === 0) {
    return null;
  }

  return (
    // Render above stretched links, but allow clicks between chips to fall through.
    <ul className="pointer-events-none relative z-20 flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li key={tag}>
          {(() => {
            const wikiPath = normalizeWikiPathFromTagName(tag);
            if (!wikiPath) {
              return (
                <span className="pointer-events-auto rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  #{tag}
                </span>
              );
            }

            return (
              <Link
                href={buildWikiPathHref(wikiPath)}
                className="pointer-events-auto rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:bg-slate-800 dark:text-slate-200 dark:ring-offset-slate-900 dark:hover:bg-slate-700 dark:focus-visible:ring-slate-500"
              >
                #{tag}
              </Link>
            );
          })()}
        </li>
      ))}
    </ul>
  );
}
