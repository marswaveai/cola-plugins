/** Keep SDK diagnostics without serializing request headers, credentials, or stacks. */
export function describeConnectionError(error: unknown): string {
  function parts(value: unknown, depth: number): string[] {
    if (depth > 4) return [];
    if (typeof value === "string") {
      const text = value.trim();
      return text && text !== "[ws]" ? [text] : [];
    }
    if (Array.isArray(value)) return value.flatMap((item) => parts(item, depth + 1));
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const code =
      typeof record.code === "string" || typeof record.code === "number"
        ? [`code: ${record.code}`]
        : [];
    const response = record.response as { data?: unknown } | undefined;
    return [
      ...code,
      ...parts(record.message ?? record.msg, depth + 1),
      ...parts(response?.data, depth + 1),
      ...parts(record.cause, depth + 1),
    ];
  }
  return [...new Set(parts(error, 0))].join("; ").slice(0, 1000) || "Feishu connection failed";
}
