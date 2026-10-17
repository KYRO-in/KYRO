import { AuthLegalFooter } from "@/components/auth/auth-legal-footer";
import { APP_NAME, BRAND_LOGO_FULL, BRAND_LOGO_FULL_WHITE } from "@/lib/brand";
import Image from "next/image";

/** Centered card with the Kayyro logo, used by the smaller auth pages. */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-x-hidden bg-cloud px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 20% -10%, rgba(124,28,240,0.18), transparent), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(182,92,255,0.12), transparent)",
        }}
      />
      <div className="panel relative w-full max-w-sm p-5 sm:p-8">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="relative mb-4 h-12 w-[200px]">
            <Image src={BRAND_LOGO_FULL} alt={APP_NAME} fill priority className="object-contain object-center dark:hidden" sizes="200px" />
            <Image src={BRAND_LOGO_FULL_WHITE} alt="" fill priority className="hidden object-contain object-center dark:block" sizes="200px" />
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-1 text-xs text-slate">{subtitle}</p>}
        </div>
        {children}
        <AuthLegalFooter />
      </div>
    </div>
  );
}
