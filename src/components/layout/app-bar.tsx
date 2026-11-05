import Link from "next/link";
import { PersonaSwitcher } from "@/components/persona-switcher";
import { ArgusMark } from "@/components/layout/argus-mark";
import { SandboxBanner } from "@/components/layout/sandbox-banner";

/** Top bar shared by every page: brand, navigation, persona switcher and the sandbox banner. */
export function AppBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-rule bg-paper/85 backdrop-blur">
      <SandboxBanner />
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-8 gap-y-2 px-5 py-2.5 sm:px-8">
        <Link href="/" className="group flex items-center gap-2.5" aria-label="Argus home">
          <ArgusMark />
          <span className="flex flex-col leading-none">
            <span className="font-display text-xl font-semibold tracking-tight text-ink">Argus</span>
            <span className="eyebrow mt-0.5 hidden !text-[0.625rem] sm:block">Plan before you pay</span>
          </span>
        </Link>

        <nav aria-label="Main" className="flex items-center gap-1 text-sm font-medium text-ink-soft">
          <Link href="/" className="rounded-md px-3 py-1.5 hover:bg-paper-deep hover:text-ink">
            Runs
          </Link>
          <Link href="/runs/new" className="rounded-md px-3 py-1.5 hover:bg-paper-deep hover:text-ink">
            New run
          </Link>
        </nav>

        <div className="ml-auto">
          <PersonaSwitcher />
        </div>
      </div>
    </header>
  );
}
