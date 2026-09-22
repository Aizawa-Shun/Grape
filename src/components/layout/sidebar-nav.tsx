"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, NAV_FOOTER_ITEMS, type NavItem } from "./nav-items";

function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string | null;
  onNavigate?: () => void;
}) {
  return (
    <>
      {items.map((item) => {
        const isActive = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-1 flex-col justify-between">
      <nav className="flex flex-col gap-0.5 px-3">
        <NavLinks items={NAV_ITEMS} pathname={pathname} onNavigate={onNavigate} />
      </nav>
      <nav className="flex flex-col gap-0.5 border-t border-border px-3 py-3">
        <NavLinks items={NAV_FOOTER_ITEMS} pathname={pathname} onNavigate={onNavigate} />
      </nav>
    </div>
  );
}
