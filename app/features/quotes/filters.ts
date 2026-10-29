// Quote list filters and paging, shared by the list screen (browser) and the
// service (server). Kept apart from service.ts so the browser bundle never
// pulls in server code.

export const QUOTE_FILTERS = ["all", "draft", "sent", "changes_requested", "approved", "closed"] as const;
export type QuoteFilter = (typeof QUOTE_FILTERS)[number];

/** Rows per page on list screens; "Show more" asks for the next page. */
export const QUOTE_PAGE_SIZE = 50;
