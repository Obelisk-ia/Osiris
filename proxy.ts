import {
  convexAuthNextjsProxy,
  nextjsProxyRedirect,
} from "@/lib/convex-auth";

export default convexAuthNextjsProxy(async (request, { isAuthenticated }) => {
  const path = request.nextUrl.pathname;
  const isAccountPage = path === "/cuenta" || path.startsWith("/cuenta/");
  const isSignInPage = path === "/acceso" || path === "/crear-cuenta";

  if (!isAccountPage && !isSignInPage) return;

  const authenticated = await isAuthenticated();
  if (isAccountPage && !authenticated) {
    return nextjsProxyRedirect(request, "/acceso");
  }
  // Signup also resumes interrupted registration. Its server page redirects
  // completed members, while incomplete accounts stay on the same signup form.
  if (path === "/acceso" && authenticated) {
    return nextjsProxyRedirect(request, "/cuenta");
  }
});

export const config = {
  // Auth handlers own their own cookies and stay outside this matcher.
  matcher: ["/acceso", "/crear-cuenta", "/cuenta/:path*"],
};
