export interface SessionStatus {
  eventName?: string | null;
  id: string;
  date: string;
  number: number;
  state: string;
  mode: string;
  stage: number;
  issue: 'error' | 'retry' | null;
  label: string;
  updatedAt: number;
  /** Absent for sessions without a fal request, null until billing confirms the amount. */
  costUsd?: number | null;
}

export interface StatusPage {
  date: string;
  eventName: string | null;
  serverNow: number;
  issues: number;
  sessions: SessionStatus[];
  nextBefore: number | null;
}

export interface HistoryEntry {
  id: number;
  at: string;
  lastAt: string;
  source: string;
  step: string;
  event: string;
  outcome: string;
  detail: Record<string, string | number>;
  repeats: number;
  label: string;
}

export interface SessionHistory {
  version: 1;
  session: SessionStatus;
  facts: {
    createdAt: string;
    model: string | null;
    requestId: string | null;
    submittedAt: string | null;
    readyAt: string | null;
    openedAt: string | null;
    emailState: string | null;
    sentAt: string | null;
    errorCode: string | null;
  };
  partial: boolean;
  entries: HistoryEntry[];
  nextAfter: number | null;
}

export interface FalBalance {
  credits: { amount: number; currency: string; checkedAt: number } | null;
  error: string | null;
}

export const balanceIntervalMs = 60_000;
