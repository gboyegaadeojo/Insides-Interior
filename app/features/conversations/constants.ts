// Inbox filters, used by the screen as well as the service; kept out of
// service.ts so the client bundle doesn't pull in server modules.

export const INBOX_FILTERS = ["open", "all"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];
