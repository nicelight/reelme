export interface SessionStatus {
  id: string;
  date: string;
  number: number;
  state: string;
  mode: string;
  stage: number;
  issue: 'error' | 'retry' | null;
  label: string;
  updatedAt: number;
}

export interface StatusPage {
  date: string;
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
