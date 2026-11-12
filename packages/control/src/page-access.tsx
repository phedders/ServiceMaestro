import { createContext, useContext, type ReactNode } from "react";

export interface PageAccess {
  canWrite: boolean;
  moduleLabel: string | null;
}

const PageAccessContext = createContext<PageAccess>({
  canWrite: true,
  moduleLabel: null,
});

export function PageAccessProvider({
  value,
  children,
}: {
  value: PageAccess;
  children: ReactNode;
}) {
  return <PageAccessContext.Provider value={value}>{children}</PageAccessContext.Provider>;
}

export function usePageAccess(): PageAccess {
  return useContext(PageAccessContext);
}

export function ReadOnlyFieldset({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const { canWrite, moduleLabel } = usePageAccess();
  return (
    <fieldset
      disabled={!canWrite}
      aria-disabled={!canWrite}
      title={canWrite ? undefined : `Read-only access to ${moduleLabel ?? "this page"}`}
      className={`read-only-fieldset ${canWrite ? "" : "is-read-only"} ${className}`.trim()}
    >
      {children}
    </fieldset>
  );
}
