import Link from "next/link";

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
          <Link
            href={`/tags/${encodeURIComponent(tag)}`}
            className="pointer-events-auto rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none"
          >
            #{tag}
          </Link>
        </li>
      ))}
    </ul>
  );
}
