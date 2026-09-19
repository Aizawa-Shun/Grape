"use client";

import * as React from "react";
import Link from "next/link";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X, Grape as GrapeIcon } from "lucide-react";
import { SidebarNav } from "./sidebar-nav";

function Brand() {
  return (
    <Link href="/overview" className="flex items-center gap-2 px-3 py-4">
      <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <GrapeIcon className="size-4" aria-hidden />
      </span>
      <span className="text-sm font-semibold tracking-tight text-foreground">Grape</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  return (
    <div className="flex min-h-svh w-full">
      {/* デスクトップ: 常設サイドバー */}
      <aside className="hidden w-60 shrink-0 border-r border-border md:flex md:flex-col">
        <Brand />
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* モバイル: 上部バー + ドロワー */}
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <Link href="/overview" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <GrapeIcon className="size-4" aria-hidden />
            </span>
            <span className="text-sm font-semibold tracking-tight text-foreground">Grape</span>
          </Link>

          <Dialog.Root open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                aria-label="メニューを開く"
                className="flex size-9 items-center justify-center rounded-md text-foreground hover:bg-secondary/60"
              >
                <Menu className="size-5" aria-hidden />
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
              <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-card shadow-lg outline-none">
                <Dialog.Title className="sr-only">ナビゲーションメニュー</Dialog.Title>
                <div className="flex items-center justify-between px-3 py-4">
                  <Brand />
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      aria-label="メニューを閉じる"
                      className="mr-2 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </Dialog.Close>
                </div>
                <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
