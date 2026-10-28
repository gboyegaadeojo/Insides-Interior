// The business's country settings in one place: Nigeria. Money stays integer
// minor units (kobo; the code calls them cents), so only formatting changes.

/** BCP 47 locale for numbers, dates and the page's lang. */
export const LOCALE = "en-NG";

/** ISO 4217 currency for new documents. */
export const CURRENCY = "NGN";

/** Business dates are calendar days here; instants are stored in UTC. */
export const BUSINESS_TZ = "Africa/Lagos";

/** Defaults for new addresses. */
export const DEFAULT_CITY = "Lagos";
export const DEFAULT_STATE = "Lagos";
