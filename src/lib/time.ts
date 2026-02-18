export function nowIso(): string {
  return new Date().toISOString();
}

export function parseDeadline(value: string | number | Date): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}
