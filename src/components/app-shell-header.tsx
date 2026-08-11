"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/assets", label: "Asset Identity" },
  { href: "/poe-reset", label: "POE Reset" },
  { href: "/firewalls", label: "Firewall Overview" },
  { href: "/admin", label: "Admin" }
] as const;

function isNavActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShellHeader({
  displayName,
  logoutAction
}: {
  displayName: string;
  logoutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  function navLinkClass(href: string, className?: string) {
    return cn(
      "block rounded-md px-3 py-3 text-base font-medium transition-colors",
      isNavActive(pathname, href)
        ? "bg-slate-100 text-slate-900"
        : "text-slate-700 hover:bg-slate-50",
      className
    );
  }

  return (
    <>
      <header className="relative z-40 border-b border-[var(--border)] bg-white/80 backdrop-blur">
        <div className="container flex min-h-16 min-w-0 items-center justify-between gap-3">
          <Link href="/" className="shrink-0 text-lg font-semibold leading-tight">
            Fortinet RBAC
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {navItems.map((item) => (
                <Button key={item.href} asChild variant="ghost" size="sm">
                  <Link href={item.href}>{item.label}</Link>
                </Button>
              ))}
            </nav>

            <form action={logoutAction} className="hidden md:block">
              <Button variant="outline" size="sm">
                Sign out {displayName}
              </Button>
            </form>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-9 px-0 md:hidden"
              onClick={() => setMenuOpen(true)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-[100] md:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/60"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div
            id="mobile-nav"
            className="absolute inset-y-0 right-0 flex w-[min(20rem,calc(100vw-1rem))] flex-col bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <p className="text-sm font-semibold">Menu</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 px-0"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-label="Main">
              <ul className="flex flex-col gap-1">
                {navItems.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={navLinkClass(item.href)}
                      onClick={() => setMenuOpen(false)}
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="shrink-0 border-t border-[var(--border)] p-4">
              <p className="mb-3 truncate text-sm text-[var(--muted-foreground)]">{displayName}</p>
              <form action={logoutAction}>
                <Button type="submit" variant="outline" className="w-full">
                  Sign out
                </Button>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
