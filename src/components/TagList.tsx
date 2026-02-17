import Link from "next/link";

type TagListProps = {
  tags: string[];
};

export default function TagList({ tags }: TagListProps) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <li key={tag}>
          <Link
            href={`/tags/${encodeURIComponent(tag)}`}
            className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700"
          >
            #{tag}
          </Link>
        </li>
      ))}
    </ul>
  );
}
