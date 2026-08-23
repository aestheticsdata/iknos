"use client";

import { useSelectedService, useSignalsOpen } from "@lib/chassisState";
import { CommandProvider } from "@lib/commandState";
import { LOG_QUERY_VIEWS, ROUTES } from "@lib/routes";
import { useLogout } from "@lib/useLogout";
import { ViewStatusProvider } from "@lib/viewStatus";
import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { CommandPalette } from "./CommandPalette";

import type { ChromeAction } from "@lib/keymap";

/**
 * The client half of the chassis: the keyboard, the palette, and the channel the views publish
 * their status on (IKN-22).
 *
 * It exists because `AppChassis` is a server component — it reads the service registry with the
 * caller's cookie — and the two shortcuts the chrome answers itself need the router and the
 * session. Rather than turn the whole shell into a client component and give up that first-byte
 * render of the rail, the interactive layer is this one wrapper and the layout stays where it was.
 */
export const ChromeShell = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const logout = useLogout();
  const pathname = usePathname();
  const [selected] = useSelectedService();
  const [, toggleSignals] = useSignalsOpen();

  const onChromeAction = useCallback(
    (action: ChromeAction) => {
      switch (action) {
        /*
         * `⌘L` means what it has always been called: give the log list the whole height.
         *
         * What changed is how. While there were two routes it navigated to the one without the
         * tiles on it; now there is one work area and the tiles collapse in place. From anywhere
         * else — the design gallery — it still has to arrive at the work area first, and with no
         * service selected there is nothing above the panel to collapse, so it does nothing rather
         * than writing a state the reader would only discover later.
         */
        case "fullscreenLogs":
          if (!LOG_QUERY_VIEWS.includes(pathname.replace(/\/+$/, ""))) router.push(ROUTES.logs);
          else if (selected !== null) toggleSignals();
          break;
        case "logout":
          void logout();
          break;
        default:
          // `palette` and `close` are answered inside `CommandProvider`, which owns that flag.
          break;
      }
    },
    [router, logout, pathname, selected, toggleSignals],
  );

  return (
    <CommandProvider onChromeAction={onChromeAction}>
      <ViewStatusProvider>
        {children}
        {/* Outside the layout div: it is a native `<dialog>` and belongs to the top layer, not to
            a flex column that clips its overflow. */}
        <CommandPalette />
      </ViewStatusProvider>
    </CommandProvider>
  );
};
