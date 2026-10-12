import "server-only";

/** Wall-clock time for the current request (server components render once per request). */
export const requestTime = (): number => Date.now();
