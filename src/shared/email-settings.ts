// Admin-facing profiles contain only fields that can be shown in the form.
export const mailProviders = { mailru: 'Mail.ru', smtpbz: 'SMTP.BZ' } as const;
export type MailProvider = keyof typeof mailProviders;
export const mailServers = { mailru: 'smtp.mail.ru', smtpbz: 'connect.smtp.bz' } as const;

export interface MailProfile {
  host: string;
  port: number;
  user: string;
  from: string;
  hasPassword: boolean;
}
export interface MailSettings {
  active: MailProvider | 'environment' | null;
  profiles: Partial<Record<MailProvider, MailProfile>>;
}
