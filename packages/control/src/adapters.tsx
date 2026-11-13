import { createContext, useContext, type ReactNode } from "react";
import type { IntegrationSettings } from "@sm/shared";

export interface AdapterAvailability {
  songSelectEnabled: boolean;
  churchSuiteEnabled: boolean;
  mqttEnabled: boolean;
  modes: IntegrationSettings;
  refresh: () => Promise<void>;
}

const AdapterContext = createContext<AdapterAvailability>({
  songSelectEnabled: false,
  churchSuiteEnabled: false,
  mqttEnabled: false,
  modes: { songSelect: "off", churchSuite: "off", mqtt: "off" },
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
