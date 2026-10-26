/**
 * Runs only for requests that match no static asset and are not page navigations: navigations
 * get the SPA shell from asset serving (compatibility date >= 2025-04-01), and existing assets
 * never reach a Worker. Without it, a missing script or chunk would receive index.html with a
 * 200 status, which `_headers` then marks immutable for a year under the script's URL.
 */
export default {
  fetch() {
    return new Response(null, { status: 404 });
  },
};
