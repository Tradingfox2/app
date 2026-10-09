import type { ReactNode } from "react";
import { PageFooter } from "./page-footer";
import { SectionState } from "./section-state";

type Translate = (source: string, values?: Record<string, string | number>) => string;

/** One queue: status line, rows, and the shared page footer. */
export function QueueList({
  children,
  loading,
  error,
  onRetry,
  retryLabel,
  updatedAt,
  empty,
  t,
  formatDate,
  loaded,
  total,
  nextCursor,
  onMore,
  queueLabel,
  footerLoading,
  errorTestID,
}: {
  children: ReactNode;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  retryLabel: string;
  updatedAt?: string | null;
  empty?: string | null;
  t: Translate;
  formatDate?: (value: string, options?: Intl.DateTimeFormatOptions) => string;
  loaded: number;
  total: number | null;
  nextCursor: string | null;
  onMore?: () => void;
  queueLabel: string;
  footerLoading?: boolean;
  errorTestID?: string;
}) {
  return (
    <>
      <SectionState
        loading={loading}
        error={error}
        onRetry={onRetry}
        retryLabel={retryLabel}
        updatedAt={updatedAt}
        empty={empty}
        t={t}
        formatDate={formatDate}
        testID={errorTestID}
      />
      {children}
      <PageFooter
        loaded={loaded}
        total={total}
        nextCursor={nextCursor}
        loading={footerLoading}
        onMore={onMore}
        queueLabel={queueLabel}
        t={t}
      />
    </>
  );
}
