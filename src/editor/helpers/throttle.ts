/**
 * Throttles a function so that it runs at most
 * once per specified number of milliseconds.
 */
export default function throttle(func: (...args: any) => void, milliseconds: number) {
  let throttledRunTimeout: NodeJS.Timeout;
  let lastRunAt: number;
  return (...args: any) => {
    if (!lastRunAt) {
      func(...args);
      lastRunAt = Date.now();
    } else {
      clearTimeout(throttledRunTimeout);
      throttledRunTimeout = setTimeout(() => {
        func(...args);
        lastRunAt = Date.now();
      }, milliseconds - (Date.now() - lastRunAt));
    }
  };
}
