export function isFtsQuerySyntaxError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  if (message.includes("fts5:")) {
    return true;
  }

  return (
    message.includes("unterminated") ||
    message.includes("malformed match") ||
    (message.includes("match") && message.includes("syntax"))
  );
}

