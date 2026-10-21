import Image from "next/image";

import { brand } from "@/config/brand";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <Image src={brand.logo.src} alt={brand.logo.alt} width={64} height={64} priority />
      <div className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">{brand.name}</h1>
        <p className="text-lg font-medium text-primary">{brand.tagline}</p>
        <p className="max-w-md text-muted-foreground">{brand.description}</p>
      </div>
    </main>
  );
}
