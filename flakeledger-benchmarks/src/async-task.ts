export function triggerBackgroundTask(callback: () => void) {
  // Simulates a background operation that takes roughly 20ms to complete
  setTimeout(callback, 20);
}
