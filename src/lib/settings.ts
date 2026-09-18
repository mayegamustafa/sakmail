import { db } from '@/lib/db';

/** Small key/value rows for things with no home of their own. */
export async function getSetting<T>(key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return (row?.value as T) ?? null;
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  await db.setting.upsert({
    where: { key },
    update: { value: value as object },
    create: { key, value: value as object },
  });
}

export type MailSettings = {
  /** Presented by the inbound webhook caller. */
  inboundSecret?: string;
};
