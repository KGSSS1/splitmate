import { BrandMark } from "@/components/layout/brand-mark";
import { ROUTES } from "@/lib/auth/routes";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex flex-1 flex-col items-center px-4 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <BrandMark href={ROUTES.home} />
        {children}
      </div>
    </main>
  );
}
