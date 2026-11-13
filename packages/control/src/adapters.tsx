import { createContext, useContext, type ReactNode } from "react";
import type { IntegrationSettings } from "@sm/shared";

export interface AdapterAvailability extends IntegrationSettings {
  refresh: () => Promise<void>;
}

const AdapterContext = createContext<AdapterAvailability>({
  songSelectEnabled: false,
  churchSuiteEnabled: false,
  refresh: async () => undefined,
});

export function AdapterProvider({
  value,
  children,
}: {
  value: AdapterAvailability;
  children: ReactNode;
}) {
  return <AdapterContext.Provider value={value}>{children}</AdapterContext.Provider>;
}

export function useAdapters(): AdapterAvailability {
  return useContext(AdapterContext);
}
