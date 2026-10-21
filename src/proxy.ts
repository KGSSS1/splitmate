import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Everything except Next.js internals and static files.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
