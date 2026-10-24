# InvoiceOS: Master Product Blueprint

## 1. Complete Application Map

**Authentication**
*   `/login` (Email/Password & Google OAuth)
*   `/forgot-password` (Password Reset)

**Dashboard (Executive Overview)**
*   `/` or `/dashboard`
    *   Revenue Chart Widget
    *   Action Inbox Widget (Overdue Invoices, Drafts)
    *   Recent Activity Log Widget

**Invoices**
*   `/invoices` (Data Grid with `?status=all|draft|sent_for_approval|changes_requested|approved|pending|paid|overdue` filters)
    *   Invoice Quick View (Slide-over Drawer)
    *   Record Payment (Modal)
    *   Mark as Sent / Void (Dialogs)
*   `/invoices/new` (Invoice Builder)
*   `/invoices/:id/edit` (Invoice Builder)
*   `/invoices/:id/preview` (Live PDF View)
*   `/i/:shareToken` (Public Client Invoice View — standalone screen with NO sidebar/app shell)

**Quotes**
*   `/quotes` (Data Grid with `?status=all|draft|sent|accepted|rejected` filters)
    *   Quote Quick View (Slide-over Drawer)
    *   Convert to Invoice (Action / Dialog)
*   `/quotes/new` (Quote Builder)
*   `/quotes/:id/edit` (Quote Builder)

**Customers**
*   `/customers` (Directory List)
    *   Customer Profile (Slide-over Drawer)
        *   Overview (Metrics)
        *   History (Invoices/Quotes timeline)
        *   Notes (Text area)
    *   Create / Edit Customer (Slide-over Drawer)

**Items (Products & Services)**
*   `/items` (Directory List)
    *   Create / Edit Item (Modal)

**Expenses**
*   `/expenses` (Data Grid)
    *   Create / Edit Expense (Slide-over Drawer)
    *   Receipt Preview (Lightbox/Modal)

**Payments**
*   `/payments` (Read-only ledger of all received payments)
    *   Payment Receipt Details (Modal)

**Reports**
*   `/reports` (Financial Analytics)
    *   Revenue vs. Expenses (Chart)
    *   Customer LTV (List)
    *   Tax Summary

**Notifications & Activity Log**
*   `/notifications` (Notification Center - accessible via Topbar Dropdown or full page)
*   `/activity` (Global audit log of all system actions)

**Settings**
*   `/settings` (Layout with sidebar navigation)
    *   `/settings/business` (Name, Address, Logo Upload)
    *   `/settings/branding` (Invoice Accent Color, Theme toggles)
    *   `/settings/financials` (Default Currency, Default Tax Rates)
    *   `/settings/account` (Email, Password Change, Logout)

---

## 2. Full Screen Inventory

| Screen Name | Purpose | Primary User Goal | Key Components | Entry Points | Exit Points | Empty State Copy | Loading State | Error State | Priority |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Login** | Authentication | Gain access to app | Email/Password Inputs, Google Auth Button | Direct URL, Redirect from protected route | Dashboard | N/A | Button spinner | Inline text ("Invalid credentials") | Critical |
| **Dashboard** | Financial command center | Understand business health at a glance | Revenue Chart, Action Inbox, Activity List | Login, Nav | Any Nav link | "Welcome to InvoiceOS. Create your first invoice." | Widget Skeletons | "Unable to load dashboard data." (Retry button) | High |
| **Invoice List** | View all invoices | Find specific invoice or check statuses | Filterable Data Grid, Status Tabs, Search | Nav, Dashboard | Invoice Builder, Invoice Drawer | "No invoices found. Create a new invoice." | Table Skeleton | "Failed to load invoices." | Critical |
| **Invoice Builder** | Create/Edit invoice | Send a professional bill | Cmd+K, Dashboard, Invoice List | Split-pane Editor, Live PDF View, Line Items | Invoice List | N/A (Starts blank) | Layout Skeleton | "Failed to save draft." (Toast) | Critical |
| **Public Invoice View** | Public client review | View final invoice | Read-only Invoice Display (no action buttons or version history) | Shared Link (`/i/:shareToken`) | None | "Invoice not found or link expired." | Document Skeleton | "Failed to load invoice." | High |
| **Quote List** | View all quotes | Track potential revenue | Filterable Data Grid, Status Tabs | Nav | Quote Builder, Quote Drawer | "No quotes found. Create a new quote." | Table Skeleton | "Failed to load quotes." | Med |
| **Customer List** | Manage clients | Find contact info | Data Grid, Search | Nav | Customer Drawer | "You haven't added any customers yet." | Table Skeleton | "Failed to load customers." | High |
| **Item List** | Manage reusable products/services | Add standardized billing items | Data Grid | Nav | Item Modal | "No items found." | Table Skeleton | "Failed to load items." | Low |
| **Expense List** | Track spending | Log a business expense | Data Grid, Receipt Uploader | Nav | Expense Drawer | "No expenses recorded." | Table Skeleton | "Failed to load expenses." | Med |
| **Reports** | Analyze metrics | Understand profitability | Charts, Data Cards | Nav | N/A | "Not enough data to generate reports." | Chart Skeletons | "Failed to load report data." | Med |
| **Settings** | App config | Setup branding/taxes | Form Groups, Logo Uploader | User Menu | Nav | N/A | Form Skeletons | "Failed to update settings." (Toast) | High |

---

## 3. Step-by-step User Flows

**1. Creating and Sending an Invoice**
1.  **Start:** User presses Cmd+K -> types "New Invoice" (routes to `/invoices/new`).
2.  **Customer Selection:** User focuses the Customer field. Types name. If exists, selects from dropdown. If new, clicks "Create '[Name]'" inline (saves to DB in background).
3.  **Line Items:** User types in line items. Can select from pre-saved Items or type custom ones.
4.  **Calculations:** Subtotals, taxes, and totals update instantly on the screen and in the Live PDF pane.
5.  **Autosave:** App silently saves document as `draft` every 3 seconds of inactivity.
6.  **Review:** User reviews Live PDF.
7.  **Send:** User clicks "Copy Client Link" (generates/fetches shareToken) or "Download PDF". (Note: Direct email sending excluded per pure client/Firebase scope, relies on public share link or PDF download/generation).
8.  **Outcome:** Invoice status updates to `pending`. Share link (`/i/:shareToken`) is generated and copied to clipboard. Activity log records action. Redirects to Invoice List with success Toast.

**2. Recording a Partial Payment**
1.  **Start:** User clicks a `pending` invoice in the Invoice List.
2.  **View:** Invoice Quick View Drawer slides in.
3.  **Action:** User clicks "Record Payment" button.
4.  **Modal:** Record Payment Modal opens.
5.  **Data Entry:** Amount defaults to full balance. User overwrites with partial amount (e.g., 50% deposit). Selects Date and Method (e.g., Bank Transfer).
6.  **Validation:** System ensures amount > 0 and <= remaining balance.
7.  **Submit:** User clicks "Save Payment".
8.  **Outcome:** Payment is logged. Invoice balance updates. Status remains `pending`. Drawer updates instantly. Toast: "Payment of $X recorded."

**3. Converting a Quote to an Invoice**
1.  **Start:** User is in the Quote Quick View Drawer for an `accepted` quote.
2.  **Action:** User clicks "Convert to Invoice".
3.  **Process:** System reads Quote document, duplicates all relevant fields (Customer, Line Items, Taxes, Discounts), creates a new Invoice document with status `draft`.
4.  **Redirect:** User is pushed to `/invoices/:newId/edit`.
5.  **Outcome:** User is in the Invoice Builder with pre-filled data, ready to review and send.

**4. Adding a New Customer**
1.  **Start:** User navigates to `/customers` and clicks "Add Customer".
2.  **Drawer:** Create Customer Drawer slides in.
3.  **Data Entry:** User fills out Company Name, Contact Email, Billing Address.
4.  **Submit:** User clicks "Save".
5.  **Outcome:** Customer is saved to Firestore. Drawer closes. Customer list updates instantly via optimistic UI. Toast: "Customer added successfully."

**5. Marking an Invoice Overdue (Reminder Flow)**
1.  **Automated Client Check:** When the Invoice List renders, it compares `dueDate` to the current date. If past due and the status is `pending`, the UI displays it as `overdue` with a red badge.
2.  **Action:** User clicks the overdue invoice to open the Drawer.
3.  **Current Manual Behavior:** User clicks "Generate Reminder". The app prepares the reminder text/asset and copies it to the user's clipboard for manual sending. User then clicks "Mark Reminder Sent" to log the action in the Activity Timeline.
4.  **Future Automatic Behavior (Prepared Seam):** Once Firebase Cloud Functions and a transactional email API (e.g., Resend, SendGrid) are integrated, this flow will transition. A scheduled Cloud Function will automatically detect overdue invoices, send the email via the API, and log the action to the Activity Timeline, bypassing the manual click without requiring any database schema rewrite.

**6. View Public Invoice Link**
1.  **Start:** Owner clicks "Copy Client Link" from Invoice List or Builder.
2.  **State & Token:** System generates a unique `shareToken` (if one doesn't exist), saves it to the `invoices` document, and copies the public link (`/i/:shareToken`) to the clipboard.
3.  **Client Access:** Client opens the public link (`/i/:shareToken`) without logging in. The page renders the standalone **Public Invoice View** (no sidebar/app shell).
4.  **Client Action:** The view is strictly read-only. The client can view the details (same visual layout as the owner's live preview) but there are no "Approve", "Request Changes", or "Pay" buttons.

---

## 4. Modals & Drawers

**Drawers (Right-side Slide-overs):**
*   **Invoice Quick View:** Triggered by clicking an invoice row. Contains status, balances, PDF mini-preview, timeline of events, and quick actions (Record Payment, Edit).
*   **Quote Quick View:** Triggered by clicking a quote row. Contains actions (Mark Accepted, Convert to Invoice).
*   **Customer Profile:** Triggered by clicking a customer row. Contains KPIs (LTV, Outstanding Balance), Invoice history timeline, and a Notes text area.
*   **Create/Edit Customer:** Triggered from Customer List or inline from Invoice Builder. Contains standard CRM form fields.
*   **Create/Edit Expense:** Triggered from Expense List. Contains amount, category, date, and receipt upload dropzone.

**Modals (Centered Dialogs):**
*   **Record Payment Modal:** Triggered from Invoice Drawer. Contains Amount, Date, Method, and Notes.
*   **Create/Edit Item Modal:** Triggered from Items List. Contains Name, Description, Unit Price, and Taxable toggle.
*   **Command Palette (Cmd+K):** Triggered by keyboard shortcut anywhere. Contains search index and quick global actions.
*   **Delete Confirmation:** Triggered by any delete action (Invoice, Customer, etc.). Contains warning text and red destructive button.
*   **Receipt Preview:** Triggered by clicking a receipt thumbnail in the Expense Drawer. Displays full-resolution image.

---

## 5. Application States & Permissions

**Permissions (Single Business Owner Model):**
*   **Role:** Owner (Implicit, tied to Firebase Auth UID).
*   **Operations:** Full CRUD (Create, Read, Update, Delete) on ALL entities within their UID sandbox. There are no restricted views or roles.
*   **Security Rule Enforcement:** Firestore rules will strictly ensure `request.auth.uid == resource.data.userId` for every read/write. 

**Module States:**
*   **Loading State:** All modules use UI-matched Skeleton loaders (e.g., Table Skeletons for lists) while waiting for initial Firestore snapshots. No full-page blocking spinners.
*   **Empty State:** 
    *   Invoices/Quotes: "Create your first [item]" illustration and primary call-to-action button.
    *   Reports: "Not enough data" if there are fewer than 1-2 finalized invoices.
*   **Offline State:** 
    *   Firebase JS SDK handles offline caching automatically.
    *   App shows a subtle yellow top banner: "Working offline. Changes will sync when connection is restored."
    *   Destructive actions (Delete) and heavy actions (PDF Generation/Uploads) are disabled gracefully.
*   **Error State:** Toast notifications (`variant="destructive"`) for localized failures (e.g., "Failed to upload logo"). Specialized empty/error states for complete collection fetch failures.

---

## 6. Feature Dependency Map

*   **Invoices** depend on **Customers** (for billing info), **Items** (for quick line item entry), and **Settings** (for default taxes, currencies, and branding).
*   **Quotes** depend on **Customers**, **Items**, and **Settings**.
*   **Quotes** flow directly into **Invoices** (Conversion).
*   **Payments** depend on **Invoices** (A payment must be tied to a specific invoice ID).
*   **Reports** aggregate data from **Invoices** (Revenue) and **Expenses** (Costs) to calculate Profit/Loss.
*   **Customer Profile** depends on **Invoices** and **Payments** to calculate Lifetime Value (LTV) and Outstanding Balance.
*   **Activity Log** acts as a global subscriber. Actions in Invoices, Quotes, Payments, and Customers write localized log entries to the central Activity collection to form the global feed.
