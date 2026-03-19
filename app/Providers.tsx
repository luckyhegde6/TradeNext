import { SessionProvider } from "next-auth/react";
import { ModalProvider } from "./components/providers/ModalProvider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      // Prevent automatic session refetch on window focus - prevents stale session issues
      refetchOnWindowFocus={false}
      // Disable automatic polling - session should only be refreshed explicitly
      refetchInterval={0}
    >
      <ModalProvider>
        {children}
      </ModalProvider>
    </SessionProvider>
  );
}
