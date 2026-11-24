/**
 * `work`, or a rejection with `message` once `ms` have passed; the timer never keeps the app alive. A late
 * rejection of `work` is still handled, so it cannot surface as an unhandled one.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
    timer.unref?.();
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
