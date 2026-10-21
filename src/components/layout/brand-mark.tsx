import Image from "next/image";
import Link from "next/link";

import { brand } from "@/config/brand";
import { cn } from "@/lib/utils";

/** Logo + product name, linking to `href`. */
export function BrandMark({ href, className }: { href: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-2 rounded-md font-semibold tracking-tight", className)}
    >
      <Image src={brand.logo.src} alt="" width={28} height={28} />
      <span className="text-lg">{brand.name}</span>
    </Link>
  );
}
