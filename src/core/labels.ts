import type { FileStatus, Severity } from './types';

export const STATUS_LABEL: Record<FileStatus, string> = {
  processing: 'בעיבוד…',
  ok: 'תקין',
  review: 'דורש בדיקה',
  approved: 'אושר ידנית',
  failed: 'נכשל',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  error: 'שגיאה',
  warning: 'אזהרה',
  info: 'מידע',
};
