import Link from "next/link";
import { Logo } from "./logo";

export function Nav({
  active,
}: {
  active: "dashboard" | "components" | "tokens" | "config";
}) {
  const item = (href: string, key: string, label: string) => (
    <Link
      href={href}
      className={`text-sm ${active === key ? "font-semibold text-neutral-900" : "text-neutral-500 hover:text-neutral-900"}`}
    >
      {label}
    </Link>
  );
  return (
    <header className="border-b border-neutral-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-8 py-4">
        <Link href="/" aria-label="Congruo home">
          <Logo height={30} />
        </Link>
        <nav className="flex gap-6">
          {item("/", "dashboard", "Dashboard")}
          {item("/components", "components", "Components")}
          {item("/tokens", "tokens", "Tokens")}
          {item("/config", "config", "Config")}
        </nav>
      </div>
    </header>
  );
}
