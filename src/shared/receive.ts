/** Visitor projection: scoped URLs and delivery state, never a full email or provider data. */
export type EmailState = 'not_requested' | 'pending' | 'sending' | 'sent' | 'failed';
export interface ReceiveStatus {
  number: number;
  photoUrl: string;
  emailState: EmailState;
  canSubmit: boolean;
  openedAt: number | null;
  emailConfirmedAt: number | null;
}
export interface ReadyCard { number: number; photoUrl: string; frameUrl: string; receiveUrl: string }
