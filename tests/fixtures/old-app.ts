import type { BrowserExport, FirestoreExport } from "../../scripts/migrate/transform";

/**
 * A small export in the old app's shapes (legacy/src/types): real records in
 * Firestore and in one browser's localStorage (with a newer edit and a record
 * only the browser had), plus the old seed data that must never be imported.
 */
export function oldAppExports(): [FirestoreExport, BrowserExport] {
  const uid = "owner_uid";
  const ade = {
    id: "cust_ade",
    userId: uid,
    name: "Adaeze Okafor",
    email: "ade@example.ng",
    phone: "0803 000 0000",
    billingAddress: "12 Admiralty Way, Lekki",
    updatedAt: { seconds: 1_780_000_000 },
  };
  const firestore: FirestoreExport = {
    source: "firestore",
    exportedAt: "2026-10-29T10:00:00.000Z",
    collections: {
      customers: [
        ade,
        { id: "cust_tunde", userId: uid, name: "Tunde Bakare", email: "not-an-email", taxId: "TIN-123" },
        // Old seed data.
        { id: "cust_1", userId: "demo_user", name: "Acme Corporation", email: "billing@acme.com" },
      ],
      items: [
        {
          id: "it_blind",
          userId: uid,
          type: "product",
          name: "Roller blind",
          unitPrice: 45000,
          isTaxable: true,
        },
        {
          id: "item_1",
          userId: "demo_user",
          type: "service",
          name: "UI/UX Design Systems",
          unitPrice: 150,
          isTaxable: true,
        },
      ],
      quotes: [
        {
          id: "q_conv",
          userId: uid,
          customerId: "cust_ade",
          customerName: "Adaeze Okafor",
          quoteNumber: "QT-2026-010",
          issueDate: "2026-07-01",
          expiryDate: "2026-07-31",
          status: "converted",
          lineItems: [
            {
              description: "Living room curtains",
              quantity: 2,
              unitPrice: 50000,
              taxRate: 7.5,
              amount: 100000,
              type: "service",
            },
          ],
          total: 107500,
        },
        {
          id: "q_changes",
          userId: uid,
          customerId: "cust_tunde",
          customerName: "Tunde Bakare",
          quoteNumber: "QT-2026-011",
          issueDate: "2026-08-02",
          expiryDate: "2026-09-01",
          status: "changes_requested",
          lineItems: [
            {
              description: "Bedroom drapes",
              quantity: 1.5,
              unitPrice: 30000.333,
              taxRate: 8.5,
              type: "product",
            },
          ],
          total: 48826.79,
        },
        {
          id: "q_draft",
          userId: uid,
          customerId: "cust_ade",
          quoteNumber: "QT-2026-012",
          status: "draft",
          lineItems: [],
        },
        {
          id: "quote_201",
          userId: "demo_user",
          customerId: "cust_1",
          quoteNumber: "QT-2026-001",
          status: "sent_for_approval",
          lineItems: [],
        },
      ],
      quoteRevisions: [
        {
          id: "rev_1",
          quoteId: "q_changes",
          clientComment: "Can the curtains be lined?",
          createdBy: "client",
          createdAt: "2026-08-03T09:00:00Z",
        },
      ],
      invoices: [
        {
          id: "inv_conv",
          userId: uid,
          customerId: "cust_ade",
          customerName: "Adaeze Okafor",
          invoiceNumber: "INV-2026-104",
          issueDate: "2026-07-05",
          dueDate: "2026-08-04",
          status: "pending",
          lineItems: [
            {
              description: "Living room curtains",
              quantity: 2,
              unitPrice: 50000,
              taxRate: 7.5,
              amount: 100000,
              type: "service",
            },
          ],
          total: 107500,
          balanceDue: 57500,
          notes: "Converted from Quote #QT-2026-010. Thanks!",
        },
        {
          id: "inv_paid",
          userId: uid,
          customerId: "cust_tunde",
          invoiceNumber: "INV-2026-105",
          issueDate: "2026-08-10",
          dueDate: "2026-08-24",
          status: "paid",
          lineItems: [
            { description: "Measuring visit", quantity: 1, unitPrice: 15000, taxRate: 0, type: "service" },
          ],
          total: 15000,
          balanceDue: 0,
        },
        {
          id: "inv_dup",
          userId: uid,
          customerId: "cust_tunde",
          invoiceNumber: "INV-2026-105",
          issueDate: "2026-08-11",
          dueDate: "2026-08-25",
          status: "void",
          lineItems: [{ description: "Duplicate", quantity: 1, unitPrice: 15000, taxRate: 0 }],
          total: 15000,
          balanceDue: 0,
        },
        {
          id: "inv_disc",
          userId: uid,
          customerId: "cust_ade",
          invoiceNumber: "INV-2026-106",
          issueDate: "2026-09-01",
          dueDate: "2026-09-15",
          status: "partially_paid",
          lineItems: [
            { description: "Sofa reupholstery", quantity: 1, unitPrice: 200000, taxRate: 0, type: "service" },
            { description: "Loyalty discount", quantity: 1, unitPrice: 20000, taxRate: 0, type: "discount" },
          ],
          total: 180000,
          balanceDue: 80000,
        },
        {
          id: "inv_101",
          userId: "demo_user",
          customerId: "cust_1",
          invoiceNumber: "INV-2026-001",
          status: "pending",
          lineItems: [],
        },
      ],
      payments: [
        {
          id: "pay_1",
          userId: uid,
          invoiceId: "inv_conv",
          customerId: "cust_ade",
          amount: 50000,
          date: "2026-07-20",
          method: "Bank Transfer",
        },
        {
          id: "pay_2",
          userId: uid,
          invoiceId: "inv_paid",
          customerId: "cust_tunde",
          amount: 15000,
          date: "2026-08-12",
          method: "cash",
        },
        {
          id: "pay_3",
          userId: uid,
          invoiceId: "inv_disc",
          customerId: "cust_ade",
          amount: 100000,
          date: "2026-09-05",
          method: "POS",
        },
      ],
      expenses: [
        {
          id: "exp_1",
          userId: uid,
          category: "travel",
          amount: 4500.5,
          date: "2026-07-02",
          merchant: "Bolt",
          description: "Site visit",
          receiptUrl: "https://firebasestorage.example/receipts/owner_uid/exp_1/bolt.jpg",
        },
      ],
    },
  };
  const browser: BrowserExport = {
    source: "browser",
    exportedAt: "2026-10-29T10:05:00.000Z",
    origin: "https://old-app.example",
    keys: {
      invoiceos_demo_customers: JSON.stringify([
        { ...ade, phone: "0803 000 1111", updatedAt: "2026-10-01T00:00:00.000Z" },
        { id: "cust_2", userId: "demo_user", name: "Starlight Media" },
      ]),
      invoiceos_demo_invoices: [
        {
          id: "inv_browser_only",
          userId: uid,
          customerId: "cust_ade",
          invoiceNumber: "INV-2026-107",
          issueDate: "2026-10-01",
          dueDate: "2026-10-15",
          status: "overdue",
          lineItems: [{ description: "Cushions", quantity: 4, unitPrice: 7500, taxRate: 0, type: "product" }],
          total: 30000,
          balanceDue: 30000,
        },
      ],
      unrelated_key: "[]",
    },
  };
  return [firestore, browser];
}
