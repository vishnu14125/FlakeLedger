export function isStartOfDay(dateStr: string): boolean {
  const d = new Date(dateStr);
  return d.getHours() === 0 && d.getMinutes() === 0;
}
