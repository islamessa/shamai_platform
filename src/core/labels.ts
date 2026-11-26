import type { FileStatus, Severity } from './types';

export const STATUS_LABEL: Record<FileStatus, string> = {
  processing: 'בעיבוד…',
  ok: 'תקין',
  review: 'הופק עם הערות',
  approved: 'נבדק ידנית',
  failed: 'לא נקרא אוטומטית',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'שגיאה',
  warning: 'אזהרה',
  info: 'מידע',
};
