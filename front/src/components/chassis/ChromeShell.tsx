"use client";

import { CommandProvider } from "@lib/commandState";
import { ROUTES } from "@lib/routes";
import { useLogout } from "@lib/useLogout";
import { ViewStatusProvider } from "@lib/viewStatus";
import { useRouter } from "next/navigation";
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

  const onChromeAction = useCallback(
    (action: ChromeAction) => {
      switch (action) {
        case "fullscreenLogs":
          // `/logs` **is** the full-screen panel in M1 — the embedded one belongs to the service
          // view (IKN-13). So the shortcut navigates rather than toggling a size, which is the
          // same end state by the only route that exists today.
          router.push(ROUTES.logs);
          break;
        case "logout":
          void logout();
          break;
        default:
          // `palette` and `close` are answered inside `CommandProvider`, which owns that flag.
          break;
      }
    },
    [router, logout],
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
