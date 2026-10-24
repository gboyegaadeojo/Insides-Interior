# InvoiceOS: Firestore Database Schema

## Design Decisions: Top-level vs. Subcollections
Based on the `ARCHITECTURE.md` definition that "All Firestore rules will validate `request.auth.uid == resource.data.userId`", all feature collections (Invoices, Customers, etc.) are structured as **Top-Level Collections** containing a `userId` field.

**Reasoning tied to Screen Inventory:**
While subcollections (e.g., `/users/{uid}/invoices`) provide natural document partitioning, top-level collections partitioned by `userId` allow for a flat structure that works perfectly with standard client-side queries, provided the proper composite indexes are in place. Since the data flow strategy uses client-side real-time listeners and fetching, queries will always include `where("userId", "==", auth.uid)`.

## Denormalization Strategy
To ensure the Dashboard and list views render immediately without requiring waterfall client-side joins (which would be slow using the client SDK):
1. **Invoices/Quotes:** Denormalize `customerName` into the document so the Data Grid can display the client name without fetching the underlying Customer document.
2. **Customers:** Denormalize `totalBilled` and `outstandingBalance`. These will be aggregated/updated on the client when an invoice is created/paid, preventing the need to fetch and sum all invoices just to render the Customer List or Profile KPIs.

---

## 1. Users
**Path:** `/users/{uid}`
Maintains the core user profile mapped 1:1 with the Firebase Auth UID.

```typescript
interface User {
  id: string; // matches Auth UID
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
```

## 2. Settings
**Path:** `/settings/{uid}`
Since a single owner has one global settings config, the document ID is the `uid`.

```typescript
interface Settings {
  id: string; // matches Auth UID
  userId: string;
  businessName: string;
  businessAddress: string;
  logoUrl: string | null;
  theme: 'light' | 'dark' | 'system';
  accentColor: string;
  defaultCurrency: string;
  defaultTaxRate: number;
  createdAt: Date;
  updatedAt: Date;
}
```

## 3. Customers
**Path:** `/customers/{id}`

```typescript
interface Customer {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone: string | null;
  billingAddress: string | null;
  notes: string | null;
  // Denormalized fields for quick UI rendering in Customer List/Profile
  totalBilled: number; 
  outstandingBalance: number;
  createdAt: Date;
  updatedAt: Date;
}
```
**Required Indexes:**
- `userId` (ASC) + `name` (ASC) - For alphabetized directory views.
- `userId` (ASC) + `createdAt` (DESC) - For "recently added" views.

## 4. Invoices
**Path:** `/invoices/{id}`

```typescript
interface InvoiceLineItem {
  itemId: string | null; // null if custom typed
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  amount: number;
}

interface Invoice {
  id: string;
  userId: string;
  customerId: string;
  customerName: string; // Denormalized for List View
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  status: 'draft' | 'pending' | 'partially_paid' | 'paid' | 'overdue' | 'void';
  shareToken: string | null; // Unique, unguessable string for public client read-only access (no unauthenticated writes)
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
  balanceDue: number;
  notes: string | null;
  terms: string | null;
  
  // Future-proof Reminder Seam (Manual -> Auto)
  reminderStatus: 'none' | 'scheduled' | 'sent';
  lastReminderSentAt: Date | null;
  nextReminderScheduledAt: Date | null;
  
  createdAt: Date;
  updatedAt: Date;
}
```
**Required Indexes:**
- `userId` (ASC) + `status` (ASC) + `createdAt` (DESC) - For Invoice List status tabs (e.g., Draft, Pending).
- `userId` (ASC) + `status` (ASC) + `dueDate` (ASC) - For Dashboard Action Inbox (finding upcoming/overdue).
- `userId` (ASC) + `customerId` (ASC) + `createdAt` (DESC) - For Customer Profile Timeline.
- `shareToken` (ASC) - For public client invoice lookup.

## 4b. Invoice Share Links
**Path:** `/invoiceShareLinks/{shareToken}`
Maps a secure, unguessable token back to a full snapshot of an underlying invoice for read-only public access.
The public view reads *only* from this collection to ensure unauthenticated users can never access the main `invoices` collection.

```typescript
interface InvoiceShareLink {
  shareToken: string; // Document ID
  invoiceId: string;
  userId: string; // Owner of the invoice
  customerId: string;
  customerName: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  status: 'draft' | 'pending' | 'partially_paid' | 'paid' | 'overdue' | 'void';
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
  notes: string | null;
  terms: string | null;
  createdAt: Date;
  updatedAt: Date;
  // NOTE EXPLICITLY: This mapping is used for READ-ONLY access.
  // It never accepts unauthenticated writes. No status changes or revisions.
}
```
**Required Indexes:**
- Document lookup by `shareToken` is a simple `get()` so no complex composite index is required.

## 5. Quotes
**Path:** `/quotes/{id}`

```typescript
interface Quote {
  id: string;
  userId: string;
  customerId: string;
  customerName: string; // Denormalized
  quoteNumber: string;
  issueDate: Date;
  expiryDate: Date;
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  lineItems: InvoiceLineItem[]; // Same shape as invoice
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
  notes: string | null;
  terms: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```
**Required Indexes:**
- `userId` (ASC) + `status` (ASC) + `createdAt` (DESC) - For Quote List tabs.

## 6. Items (Products & Services)
**Path:** `/items/{id}`

```typescript
interface Item {
  id: string;
  userId: string;
  type: 'product' | 'service';
  name: string;
  description: string | null;
  unitPrice: number;
  isTaxable: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```
**Required Indexes:**
- `userId` (ASC) + `name` (ASC) - For typeahead/dropdown in Invoice Builder.

## 7. Expenses
**Path:** `/expenses/{id}`

```typescript
interface Expense {
  id: string;
  userId: string;
  category: string;
  amount: number;
  date: Date;
  merchant: string;
  description: string | null;
  receiptUrl: string | null; // Firebase Storage URL
  createdAt: Date;
  updatedAt: Date;
}
```
**Required Indexes:**
- `userId` (ASC) + `date` (DESC) - For Expense Data Grid and Reports aggregation.

## 8. Payments
**Path:** `/payments/{id}`

```typescript
interface Payment {
  id: string;
  userId: string;
  invoiceId: string;
  customerId: string;
  amount: number;
  date: Date;
  method: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```
**Required Indexes:**
- `userId` (ASC) + `date` (DESC) - For global payment ledger.
- `userId` (ASC) + `invoiceId` (ASC) + `date` (DESC) - For loading payments tied to a specific invoice.

## 9. Notifications
**Path:** `/notifications/{id}`
Supports the Notification Center mentioned in the global navigation map.

```typescript
interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'invoice_overdue' | 'quote_accepted' | 'payment_received' | 'system';
  read: boolean;
  relatedEntityId: string | null; // e.g. invoiceId to click through
  createdAt: Date;
}
```
**Required Indexes:**
- `userId` (ASC) + `createdAt` (DESC) - For chronological feed.
- `userId` (ASC) + `read` (ASC) + `createdAt` (DESC) - To fetch unread counts.

## 10. Activity Logs
**Path:** `/activityLogs/{id}`
Supports the Global Audit Log and contextual timelines in Quick View Drawers.

```typescript
interface ActivityLog {
  id: string;
  userId: string;
  entityType: 'invoice' | 'quote' | 'customer' | 'payment' | 'expense';
  entityId: string;
  action: string; // e.g., 'created', 'sent', 'paid', 'reminder_sent'
  description: string;
  metadata: Record<string, any> | null; // e.g., { amount: 500, previousStatus: 'draft' }
  createdAt: Date;
}
```
**Required Indexes:**
- `userId` (ASC) + `createdAt` (DESC) - For the Dashboard Recent Activity widget.
- `userId` (ASC) + `entityId` (ASC) + `createdAt` (DESC) - For rendering a timeline of events inside a specific Customer or Invoice Drawer.

## 11. Security Rules & Public Access Pattern

> **Token-Based Public Access Pattern:**
> Unlike existing owner-only collections which strictly validate `request.auth.uid == resource.data.userId`, the public Client Invoice View introduces a read-only token pattern:
> - **Invoices Read Access:** Unauthenticated or authenticated clients can read a single Invoice document snapshot when the request queries the `invoiceShareLinks` collection by the correct `shareToken`. They **never** read directly from the `invoices` collection.
> - **Client Action Writes:** The public invoice view is **strictly read-only**. It never accepts unauthenticated writes (no status changes, no revisions).
> - **Explicit Callout:** This operates as a read-only token-validated access path alongside the existing owner-only (`userId`) rule. Quote approvals may use a similar but write-enabled pattern.
