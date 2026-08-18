import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Routes that don't require authentication
const PUBLIC_PATHS = ['/login', '/z'];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes through
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Use the refresh_token HttpOnly cookie as a proxy for "has a session".
  // The actual token validity is checked by AuthProvider on mount.
  const hasSession = req.cookies.has('refresh_token');
  if (!hasSession) {
    const loginUrl = new URL('/login', req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Match all routes except Next.js internals, static assets, PWA files, and API routes
  matcher: [
    '/((?!_next/static|_next/image|favicon\\.ico|icon|apple-icon|manifest|sw\\.js|workbox-.*|api/).*)',
  ],
};
