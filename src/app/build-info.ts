// Replaced at build time through the builder's `define` option (see the CI build step).
declare const BUILD_SHA: string | undefined;

/** Short commit SHA of this build, or `null` for a local build. */
export const buildSha: string | null = typeof BUILD_SHA === 'string' ? BUILD_SHA : null;
