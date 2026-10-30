import type { DocumentTotals } from "~/domain/document";
import { validitySentence } from "~/domain/portal";
import { formatBp, formatCents, formatQuantity, lineAmountCents } from "~/domain/money";
import type { ComputedLine } from "~/domain/tax";
import { formatDate } from "~/lib/dates";
import { isEmptyRichText, sanitizeRichText } from "~/lib/rich-text";
import { cn } from "~/lib/utils";
import { onColour, PALETTE } from "~/styles/tokens";

// The document is the product (SPEC 6.10, DS-DOC): one tree for the builder
// preview, the client portal and the PDF. Client-facing documents use the
// business brand colour plus neutrals only (DS-COL-08); the brand value is the
// owner's setting, so it is applied inline.

export interface DocBusiness {
  name: string;
  legalName?: string | null;
  address?: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  tin?: string | null;
  rcNumber?: string | null;
  brandColor: string;
  /** The owner's permanent signature (Settings → Branding), on every quote and invoice. */
  signature?: { svg: string; name: string | null; title: string | null } | null;
}

export interface DocParty {
  name: string;
  company?: string | null;
  address?: string;
  email?: string | null;
  phone?: string | null;
}

export interface DocLine {
  id: string;
  description: string;
  details?: string;
  qtyMilli: number;
  unit: string;
  unitPriceCents: number;
  taxRateIds: string[];
  optional?: boolean;
  selected?: boolean;
  discount?: { type: "percent"; bp: number } | { type: "amount"; cents: number };
}

export interface DocSection {
  id: string;
  title: string;
  lines: DocLine[];
}

export interface DocumentRendererProps {
  kind: "quote" | "invoice";
  /** "Q-1042", or null for a draft. */
  number: string | null;
  title?: string | null;
  revision?: number | null;
  issuedOn?: string | null;
  /** Valid until (quotes) or due date (invoices). */
  untilDate?: string | null;
  business: DocBusiness;
  client: DocParty | null;
  site?: { label: string; address?: string } | null;
  sections: DocSection[];
  taxRates: { id: string; name: string; rateBp: number }[];
  totals: DocumentTotals;
  deposit?: { type: "percent" | "amount"; value: number } | null;
  notes?: string | null;
  terms?: string | null;
  paymentInstructions?: string[];
  /** The client's PO or reference (FR-INV-03). */
  reference?: string | null;
  /** Invoices: paid so far (cash + WHT) and what's left (SPEC 8.3). */
  settlement?: { paidCents: number; balanceCents: number } | null;
  stamp?: "paid" | "void" | "revised" | "approved" | null;
  /** h2 when the page around the document has its own h1 (portal). */
  titleAs?: "h1" | "h2";
  /** Optional footer content such as the approval block (portal). */
  children?: React.ReactNode;
  /** Portal: "Request a change" on each line (FR-MSG-03). Never in the PDF. */
  lineAction?: (line: DocLine) => React.ReactNode;
  /** Lines with an open change request get a labelled marker (FR-MSG-03). */
  flaggedLines?: string[];
  className?: string;
}

interface LineExtras {
  lineAction?: DocumentRendererProps["lineAction"];
  flagged: Set<string>;
}

function LineTable({
  lines,
  byLine,
  taxNames,
  extras,
}: {
  lines: DocLine[];
  byLine: DocumentTotals["byLine"];
  taxNames: Map<string, string>;
  extras: LineExtras;
}) {
  return (
    <table className="doc-table">
      <thead>
        <tr>
          {/* Owner's order: quantity first, then what it is, the unit price and the amount. */}
          <th scope="col" className="doc-qty">
            Qty
          </th>
          <th scope="col" className="doc-desc">
            Description
          </th>
          <th scope="col" className="doc-price num">
            Price per unit
          </th>
          <th scope="col" className="doc-amount num">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <LineRow
            key={line.id}
            line={line}
            computed={byLine.get(line.id)}
            taxNames={taxNames}
            extras={extras}
          />
        ))}
      </tbody>
    </table>
  );
}

function LineRow({
  line,
  computed,
  taxNames,
  extras,
}: {
  line: DocLine;
  computed?: ComputedLine;
  taxNames: Map<string, string>;
  extras: LineExtras;
}) {
  const flagged = extras.flagged.has(line.id);
  // Excluded options still show what they would cost.
  const amount = computed?.included
    ? computed.amountCents
    : lineAmountCents(line.qtyMilli, line.unitPriceCents);
  const discount = (computed?.lineDiscountCents ?? 0) > 0 ? computed!.lineDiscountCents : 0;
  const taxes = line.taxRateIds.map((id) => taxNames.get(id)).filter(Boolean);
  return (
    <tr
      className={cn(line.optional && !line.selected && "doc-excluded", flagged && "doc-line-flagged")}
      data-line-id={line.id}
    >
      <td className="doc-qty">{formatQuantity(line.qtyMilli)}</td>
      <td className="doc-desc">
        <span className="doc-line-title">{line.description || "Untitled line"}</span>
        {flagged && <span className="doc-flag">Change requested</span>}
        {!isEmptyRichText(line.details) && (
          <div
            className="doc-details"
            dangerouslySetInnerHTML={{ __html: sanitizeRichText(line.details ?? "") }}
          />
        )}
        {(taxes.length > 0 || discount > 0) && (
          <span className="doc-meta">
            {taxes.length > 0 && taxes.join(" + ")}
            {discount > 0 && ` · discount ${formatCents(discount)}`}
          </span>
        )}
        {extras.lineAction?.(line)}
      </td>
      <td className="doc-price num">{formatCents(line.unitPriceCents)}</td>
      <td className="doc-amount num">{formatCents(amount)}</td>
    </tr>
  );
}

export function DocumentRenderer(props: DocumentRendererProps) {
  const { business, client, site, sections, totals, kind } = props;
  const brand = /^#[0-9a-f]{6}$/i.test(business.brandColor) ? business.brandColor : PALETTE.teal.base;
  const brandText = onColour(brand as `#${string}`);
  const taxNames = new Map(props.taxRates.map((r) => [r.id, `${r.name} ${formatBp(r.rateBp)}%`]));
  const label = kind === "quote" ? "Quote" : "Invoice";
  const numberText = props.number
    ? `${props.number}${props.revision && props.revision > 1 ? ` · Revised (rev ${props.revision})` : ""}`
    : "Draft";
  const { computed } = totals;
  const Title = props.titleAs ?? "h1";
  const extras: LineExtras = { lineAction: props.lineAction, flagged: new Set(props.flaggedLines) };
  const validity = kind === "quote" ? validitySentence(props.issuedOn, props.untilDate, formatDate) : null;

  return (
    <article
      data-theme="light"
      className={cn("doc", props.className)}
      style={{ ["--doc-brand" as string]: brand, ["--doc-on-brand" as string]: brandText }}
    >
      <header className="doc-header">
        <div className="doc-business">
          {business.logoUrl ? (
            <img src={business.logoUrl} alt={business.name} className="doc-logo" />
          ) : (
            <p className="doc-business-name">{business.name}</p>
          )}
          <p>
            {business.legalName && business.legalName !== business.name && (
              <>
                {business.legalName}
                <br />
              </>
            )}
            {business.address}
            {business.phone && (
              <>
                <br />
                {business.phone}
              </>
            )}
            {business.email && (
              <>
                <br />
                {business.email}
              </>
            )}
          </p>
        </div>
        <div className="doc-title-block">
          <Title className="doc-title">{label}</Title>
          <p className="doc-number">{numberText}</p>
          <dl className="doc-dates">
            {props.issuedOn && (
              <>
                <dt>Date</dt>
                <dd>{formatDate(props.issuedOn)}</dd>
              </>
            )}
            {props.untilDate && (
              <>
                <dt>{kind === "quote" ? "Valid until" : "Due"}</dt>
                <dd>{formatDate(props.untilDate)}</dd>
              </>
            )}
          </dl>
        </div>
      </header>
      <div className="doc-rule" aria-hidden />

      <section className="doc-parties">
        <div>
          <h2 className="doc-label">{kind === "quote" ? "Prepared for" : "Bill to"}</h2>
          {client ? (
            <p>
              <strong>{client.name}</strong>
              {client.company && (
                <>
                  <br />
                  {client.company}
                </>
              )}
              {client.address && (
                <>
                  <br />
                  {client.address}
                </>
              )}
              {client.email && (
                <>
                  <br />
                  {client.email}
                </>
              )}
            </p>
          ) : (
            <p className="doc-muted">No client chosen yet</p>
          )}
        </div>
        {site && (
          <div>
            <h2 className="doc-label">Job address</h2>
            <p>
              <strong>{site.label}</strong>
              {site.address && (
                <>
                  <br />
                  {site.address}
                </>
              )}
            </p>
          </div>
        )}
        {props.title && (
          <div className="doc-project">
            <h2 className="doc-label">Project</h2>
            <p>{props.title}</p>
          </div>
        )}
        {props.reference && (
          <div>
            <h2 className="doc-label">Your reference</h2>
            <p>{props.reference}</p>
          </div>
        )}
      </section>

      {sections.map((section) => {
        const regular = section.lines.filter((l) => !l.optional);
        const options = section.lines.filter((l) => l.optional);
        if (section.lines.length === 0) return null;
        return (
          <section key={section.id} className="doc-section">
            <h2 className="doc-section-title">{section.title || "Untitled room"}</h2>
            {regular.length > 0 && (
              <LineTable lines={regular} byLine={totals.byLine} taxNames={taxNames} extras={extras} />
            )}
            {options.length > 0 && (
              <div className="doc-options">
                <h3 className="doc-label">Options</h3>
                <LineTable lines={options} byLine={totals.byLine} taxNames={taxNames} extras={extras} />
              </div>
            )}
          </section>
        );
      })}
      {sections.every((s) => s.lines.length === 0) && (
        <p className="doc-muted doc-empty">Lines you add appear here.</p>
      )}

      <section className="doc-totals" aria-label="Totals">
        {/* Beside the totals, where the page has room, so it never covers content. */}
        {props.stamp && (
          <div className={`doc-stamp doc-stamp-${props.stamp}`}>
            {props.stamp === "revised" ? "Revised" : props.stamp}
          </div>
        )}
        <dl>
          <div>
            <dt>Subtotal</dt>
            <dd>{formatCents(computed.subtotalCents)}</dd>
          </div>
          {computed.discountCents > 0 && (
            <div>
              <dt>Discounts</dt>
              <dd>−{formatCents(computed.discountCents)}</dd>
            </div>
          )}
          {computed.taxes.map((tax) => (
            <div key={tax.rateId}>
              <dt>
                {tax.name} {formatBp(tax.rateBp)}%
              </dt>
              <dd>{formatCents(tax.taxCents)}</dd>
            </div>
          ))}
          {totals.hasOptions && (
            <div>
              <dt>Base total (without options)</dt>
              <dd>{formatCents(totals.baseTotalCents)}</dd>
            </div>
          )}
          <div className="doc-total">
            <dt>{totals.hasOptions ? "Total with your selection" : "Total"}</dt>
            <dd>{formatCents(computed.totalCents)}</dd>
          </div>
          {totals.depositCents > 0 && (
            <>
              <div>
                <dt>
                  Deposit due on approval
                  {props.deposit?.type === "percent" ? ` (${formatBp(props.deposit.value)}%)` : ""}
                </dt>
                <dd>{formatCents(totals.depositCents)}</dd>
              </div>
              <div>
                <dt>Balance on completion</dt>
                <dd>{formatCents(totals.balanceCents)}</dd>
              </div>
            </>
          )}
          {props.settlement && props.settlement.paidCents > 0 && (
            <>
              <div>
                <dt>Paid to date</dt>
                <dd>−{formatCents(props.settlement.paidCents)}</dd>
              </div>
              <div className="doc-balance">
                <dt>Balance due</dt>
                <dd>{formatCents(props.settlement.balanceCents)}</dd>
              </div>
            </>
          )}
        </dl>
        {(business.tin || business.rcNumber) && (
          <p className="doc-registrations">
            {business.tin && `TIN ${business.tin}`}
            {business.tin && business.rcNumber && " · "}
            {business.rcNumber && `RC ${business.rcNumber.replace(/^RC\s*/i, "")}`}
          </p>
        )}
      </section>

      {props.paymentInstructions && props.paymentInstructions.length > 0 && (
        <section className="doc-block">
          <h2 className="doc-label">How to pay</h2>
          {props.paymentInstructions.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </section>
      )}
      {props.notes && (
        <section className="doc-block">
          <h2 className="doc-label">Notes</h2>
          <p className="doc-prewrap">{props.notes}</p>
        </section>
      )}
      {(props.terms || validity) && (
        <section className="doc-block doc-terms">
          <h2 className="doc-label">Terms</h2>
          {validity && <p className="doc-validity">{validity}</p>}
          {props.terms && <p className="doc-prewrap">{props.terms}</p>}
        </section>
      )}
      {business.signature && (
        <section className="doc-block doc-signature" aria-label="Authorised signature">
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(business.signature.svg)}`}
            alt={`Signature of ${business.signature.name ?? business.name}`}
            className="doc-signature-img"
          />
          <p className="doc-signature-rule">
            <span className="doc-label">Authorised signature</span>
          </p>
          {business.signature.name && <p className="doc-signature-name">{business.signature.name}</p>}
          {business.signature.title && <p className="doc-muted">{business.signature.title}</p>}
        </section>
      )}
      {props.children}
      <footer className="doc-footer">
        {business.name}
        {business.website && ` · ${business.website}`}
      </footer>
    </article>
  );
}
