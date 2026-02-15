function normalizeSqliteDateTime(value: string): string {
  const normalized = value.trim();

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(normalized)) {
    return `${normalized.replace(" ", "T")}Z`;
  }

  return normalized;
}

export function parseDateValue(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeSqliteDateTime(value);
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

export function formatDate(
  value: string | null | undefined,
  locale = "ko-KR",
): string | null {
  const date = parseDateValue(value);
  if (!date) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
