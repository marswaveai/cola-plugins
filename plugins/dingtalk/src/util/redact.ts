export function redactSecret(value: string, visibleChars = 4): string {
  if (value.length <= visibleChars) return "***";
  return value.slice(0, visibleChars) + "***";
}
