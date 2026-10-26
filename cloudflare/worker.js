/**
 * Handles every request that matches no static asset; existing assets never reach it.
 *
 * - A path without a file extension is an app route (`/settings`): it gets the app shell, so deep
 *   links work for every client, including those that send no navigation hints.
 * - Anything else names a file that does not exist: a plain 404, not the shell. Served under a
 *   script URL the shell would break that script, and `_headers` would mark it immutable. The 404 is
 *   no-store because the file may well exist after the next deploy.
 */
export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!/\.[^/]*$/.test(pathname)) {
      return env.ASSETS.fetch(new URL('/', request.url));
    }
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  },
};
