import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except Next.js internals and static files (including the service
  // worker and its offline page, which must load without a session).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|sw\\.js$|offline\\.html$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
