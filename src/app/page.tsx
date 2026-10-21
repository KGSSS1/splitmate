import Image from "next/image";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { brand } from "@/config/brand";
import { ROUTES } from "@/lib/auth/routes";
import { cn } from "@/lib/utils";

// Signed-in visitors are redirected to the dashboard by src/proxy.ts.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <Image src={brand.logo.src} alt={brand.logo.alt} width={64} height={64} priority />
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">{brand.name}</h1>
        <p className="text-lg font-medium text-primary">{brand.tagline}</p>
        <p className="max-w-md text-muted-foreground">{brand.description}</p>
      </div>
      <div className="flex w-full max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
        <Link href={ROUTES.signup} className={cn(buttonVariants({ size: "lg" }), "h-11 px-6")}>
          Get started
        </Link>
        <Link href={ROUTES.login} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 px-6")}>
          Log in
        </Link>
      </div>
    </main>
  );
}
