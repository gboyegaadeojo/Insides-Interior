import { db, auth } from './firebase/config';
import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  query, 
  where, 
  addDoc, 
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { Invoice, Customer, Item, Notification, ActivityLog, InvoiceStatus, Payment } from '../types';

// LocalStorage keys for fallback state
const LOCAL_INVOICES_KEY = 'invoiceos_demo_invoices';
const LOCAL_CUSTOMERS_KEY = 'invoiceos_demo_customers';
export const LOCAL_ITEMS_KEY = 'invoiceos_demo_items';
const LOCAL_NOTIFS_KEY = 'invoiceos_demo_notifications';
const LOCAL_ACTIVITY_KEY = 'invoiceos_demo_activity';
const LOCAL_PAYMENTS_KEY = 'invoiceos_demo_payments';

// Helpers
export function getLocalData<T>(key: string, defaultVal: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Error reading localStorage', e);
  }
  localStorage.setItem(key, JSON.stringify(defaultVal));
  return defaultVal;
}

export function setLocalData<T>(key: string, data: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error('Error writing localStorage', e);
  }
}

// Default Seed Data
export const DEMO_CUSTOMERS: Customer[] = [
  { id: 'cust_1', userId: 'demo_user', name: 'Acme Corporation', email: 'billing@acme.com', phone: '+1 555-0192', billingAddress: '100 Enterprise Way, Suite 400, San Francisco, CA' },
  { id: 'cust_2', userId: 'demo_user', name: 'Starlight Media', email: 'accounts@starlight.io', phone: '+1 555-0144', billingAddress: '450 Sunset Blvd, Los Angeles, CA' },
  { id: 'cust_3', userId: 'demo_user', name: 'Nexus Technologies', email: 'finance@nexus.tech', phone: '+1 555-0188', billingAddress: '789 Innovation Dr, Austin, TX' },
];

export const DEMO_ITEMS: Item[] = [
  { id: 'item_1', userId: 'demo_user', type: 'service', name: 'UI/UX Design Systems', description: 'Design system architecture & component library design', unitPrice: 150, isTaxable: true },
  { id: 'item_2', userId: 'demo_user', type: 'service', name: 'Full Stack Web Development', description: 'Custom React & TypeScript frontend & API development', unitPrice: 180, isTaxable: true },
  { id: 'item_3', userId: 'demo_user', type: 'product', name: 'Cloud Server Infrastructure', description: 'Monthly dedicated Cloud Run hosting setup', unitPrice: 250, isTaxable: false },
  { id: 'item_4', userId: 'demo_user', type: 'service', name: 'Technical Code Audit', description: 'Comprehensive security & performance audit', unitPrice: 1200, isTaxable: true },
];

export const DEMO_INVOICES: Invoice[] = [
  {
    id: 'inv_101',
    userId: 'demo_user',
    customerId: 'cust_1',
    customerName: 'Acme Corporation',
    invoiceNumber: 'INV-2026-001',
    issueDate: '2026-07-15',
    dueDate: '2026-08-15',
    status: 'pending',
    version: 1,
    lineItems: [
      { itemId: 'item_1', description: 'UI/UX Design Systems - Phase 1', quantity: 20, unitPrice: 150, taxRate: 8.5, amount: 3000, type: 'service' },
      { itemId: 'item_2', description: 'Frontend Development Iteration', quantity: 15, unitPrice: 180, taxRate: 8.5, amount: 2700, type: 'service' }
    ],
    subtotal: 5700,
    taxTotal: 484.5,
    discountTotal: 0,
    total: 6184.5,
    balanceDue: 6184.5,
    notes: 'Thank you for your business!',
    terms: 'Payment due within 30 days.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'inv_102',
    userId: 'demo_user',
    customerId: 'cust_2',
    customerName: 'Starlight Media',
    invoiceNumber: 'INV-2026-002',
    issueDate: '2026-07-20',
    dueDate: '2026-08-05',
    status: 'pending',
    version: 1,
    lineItems: [
      { itemId: 'item_4', description: 'Technical Code Audit & Security Review', quantity: 1, unitPrice: 1200, taxRate: 8.5, amount: 1200, type: 'service' },
      { itemId: null, description: 'Client Requested Priority Rush Fee', quantity: 1, unitPrice: 300, taxRate: 8.5, amount: 300, type: 'service' }
    ],
    subtotal: 1500,
    taxTotal: 127.5,
    discountTotal: 0,
    total: 1627.5,
    balanceDue: 1627.5,
    notes: 'Priority audit work.',
    terms: 'Net 15.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'inv_103',
    userId: 'demo_user',
    customerId: 'cust_3',
    customerName: 'Nexus Technologies',
    invoiceNumber: 'INV-2026-003',
    issueDate: '2026-06-10',
    dueDate: '2026-07-10',
    status: 'paid',
    version: 1,
    lineItems: [
      { itemId: 'item_3', description: 'Cloud Server Infrastructure setup & configuration', quantity: 2, unitPrice: 250, taxRate: 0, amount: 500, type: 'product' }
    ],
    subtotal: 500,
    taxTotal: 0,
    discountTotal: 0,
    total: 500,
    balanceDue: 0,
    notes: 'Paid in full via Bank Transfer.',
    terms: 'Net 30.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// 1. Fetch Invoices
export async function getInvoices(userId: string): Promise<Invoice[]> {
  if (db && userId && userId !== 'demo_user') {
    try {
      const q = query(
        collection(db, 'invoices'), 
        where('userId', '==', userId)
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Invoice[];
      }
    } catch (err) {
      console.warn('Firestore fetch invoices error, fallback to local storage:', err);
    }
  }
  return getLocalData<Invoice>(LOCAL_INVOICES_KEY, DEMO_INVOICES);
}

// 2. Fetch Single Invoice by ID
export async function getInvoiceById(id: string): Promise<Invoice | null> {
  if (db && id) {
    try {
      const docRef = doc(db, 'invoices', id);
      const snapshot = await getDoc(docRef);
      if (snapshot.exists()) {
        return { id: snapshot.id, ...snapshot.data() } as Invoice;
      }
    } catch (err) {
      console.warn('Firestore fetch invoice error, fallback to local:', err);
    }
  }
  const local = getLocalData<Invoice>(LOCAL_INVOICES_KEY, DEMO_INVOICES);
  return local.find(i => i.id === id) || null;
}

// 3. Save / Update Invoice
export async function saveInvoice(invoiceData: Partial<Invoice> & { userId: string }): Promise<Invoice> {
  const isNew = !invoiceData.id;
  const id = invoiceData.id || `inv_${Date.now()}`;

  const updatedInvoice: Invoice = {
    id,
    userId: invoiceData.userId,
    customerId: invoiceData.customerId || '',
    customerName: invoiceData.customerName || 'Unknown Customer',
    invoiceNumber: invoiceData.invoiceNumber || `INV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
    issueDate: invoiceData.issueDate || new Date().toISOString().split('T')[0],
    dueDate: invoiceData.dueDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    status: invoiceData.status || 'draft',
    version: invoiceData.version || 1,
    lineItems: invoiceData.lineItems || [],
    subtotal: invoiceData.subtotal || 0,
    taxTotal: invoiceData.taxTotal || 0,
    discountTotal: invoiceData.discountTotal || 0,
    total: invoiceData.total || 0,
    balanceDue: invoiceData.balanceDue !== undefined ? invoiceData.balanceDue : (invoiceData.total || 0),
    notes: invoiceData.notes || '',
    terms: invoiceData.terms || '',
    createdAt: invoiceData.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (db && invoiceData.userId !== 'demo_user') {
    try {
      await setDoc(doc(db, 'invoices', id), updatedInvoice, { merge: true });
    } catch (err) {
      console.warn('Firestore save invoice error, using local storage:', err);
    }
  }

  const localInvoices = getLocalData<Invoice>(LOCAL_INVOICES_KEY, DEMO_INVOICES);
  const existingIdx = localInvoices.findIndex(i => i.id === id);
  if (existingIdx >= 0) {
    localInvoices[existingIdx] = updatedInvoice;
  } else {
    localInvoices.unshift(updatedInvoice);
  }
  setLocalData(LOCAL_INVOICES_KEY, localInvoices);

  await logActivity({
    userId: invoiceData.userId,
    entityType: 'invoice',
    entityId: id,
    action: isNew ? 'created' : 'updated',
    description: isNew 
      ? `Created invoice ${updatedInvoice.invoiceNumber}`
      : `Updated invoice ${updatedInvoice.invoiceNumber} (Status: ${updatedInvoice.status})`,
  });

  return updatedInvoice;
}

// 4. Create Notification
export async function createNotification(notif: Omit<Notification, 'id' | 'createdAt'>): Promise<void> {
  const notifObj = {
    id: `notif_${Date.now()}`,
    ...notif,
    createdAt: new Date().toISOString(),
  };

  if (db) {
    try {
      await addDoc(collection(db, 'notifications'), {
        ...notifObj,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Firestore notification error:', err);
    }
  }

  const local = getLocalData<Notification>(LOCAL_NOTIFS_KEY, []);
  local.unshift(notifObj as Notification);
  setLocalData(LOCAL_NOTIFS_KEY, local);
}

// 5. Log Activity
export async function logActivity(log: Omit<ActivityLog, 'id' | 'createdAt'>): Promise<void> {
  const logObj = {
    id: `log_${Date.now()}`,
    ...log,
    createdAt: new Date().toISOString(),
  };

  if (db) {
    try {
      await addDoc(collection(db, 'activityLogs'), {
        ...logObj,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Firestore log activity error:', err);
    }
  }

  const local = getLocalData<ActivityLog>(LOCAL_ACTIVITY_KEY, []);
  local.unshift(logObj as ActivityLog);
  setLocalData(LOCAL_ACTIVITY_KEY, local);
}

// Fetch activity logs for a user
export async function getActivityLogs(userId: string): Promise<ActivityLog[]> {
  if (db && userId && userId !== 'demo_user') {
    try {
      const q = query(
        collection(db, 'activityLogs'),
        where('userId', '==', userId)
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const logs = snapshot.docs.map(d => {
          const data = d.data();
          let createdAtStr = data.createdAt;
          if (data.createdAt && typeof data.createdAt.toDate === 'function') {
            createdAtStr = data.createdAt.toDate().toISOString();
          }
          return {
            id: d.id,
            ...data,
            createdAt: createdAtStr || new Date().toISOString()
          };
        }) as ActivityLog[];
        return logs.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      }
    } catch (e) {
      console.warn('Error fetching activity logs:', e);
    }
  }
  const local = getLocalData<ActivityLog>(LOCAL_ACTIVITY_KEY, []);
  return local.filter(l => l.userId === userId || userId === 'demo_user').sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
}

// 6. Fetch Customers & Items
export async function getCustomers(userId: string): Promise<Customer[]> {
  if (db && userId && userId !== 'demo_user') {
    try {
      const q = query(collection(db, 'customers'), where('userId', '==', userId));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        return snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Customer[];
      }
    } catch (err) {
      console.warn('Firestore fetch customers error:', err);
    }
  }
  return getLocalData(LOCAL_CUSTOMERS_KEY, DEMO_CUSTOMERS);
}


// 7. Delete Invoice
export async function deleteInvoice(invoiceId: string): Promise<void> {
  if (db) {
    try {
      await deleteDoc(doc(db, 'invoices', invoiceId));

      try {
        const payQuery = query(collection(db, 'payments'), where('invoiceId', '==', invoiceId));
        const paySnap = await getDocs(payQuery);
        for (const payDoc of paySnap.docs) {
          await deleteDoc(doc(db, 'payments', payDoc.id));
        }
      } catch (e) {
        console.warn('Error deleting cascading payments:', e);
      }
    } catch (err: any) {
      console.error('Firestore delete invoice error:', err);
      throw new Error(`Failed to delete invoice from Firestore: ${err?.message || 'Database error'}`);
    }
  }

  const localInvoices = getLocalData<Invoice>(LOCAL_INVOICES_KEY, DEMO_INVOICES);
  const filteredInvoices = localInvoices.filter(i => i.id !== invoiceId);
  setLocalData(LOCAL_INVOICES_KEY, filteredInvoices);

  const localPayments = getLocalData<Payment>(LOCAL_PAYMENTS_KEY, []);
  const filteredPayments = localPayments.filter(p => p.invoiceId !== invoiceId);
  setLocalData(LOCAL_PAYMENTS_KEY, filteredPayments);

  await logActivity({
    userId: auth?.currentUser?.uid || 'owner',
    entityType: 'invoice',
    entityId: invoiceId,
    action: 'deleted',
    description: `Invoice ${invoiceId} and all associated payments were permanently deleted.`,
  });
}

export interface Expense {
  id: string;
  userId: string;
  category: string;
  amount: number;
  date: string;
  merchant: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

const LOCAL_EXPENSES_KEY = 'invoiceos_demo_expenses';

// Fetch all expenses for a user

// Fetch all payments for a user
export async function getAllPayments(userId: string): Promise<Payment[]> {
  if (db && userId && userId !== 'demo_user') {
    try {
      const q = query(
        collection(db, 'payments'),
        where('userId', '==', userId)
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const payments = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Payment[];
        return payments.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      }
    } catch (e) {
      console.warn('Error fetching all payments:', e);
    }
  }
  const allPayments = getLocalData<Payment>(LOCAL_PAYMENTS_KEY, []);
  return allPayments.filter(p => p.userId === userId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// Fetch payments for an invoice
export async function getInvoicePayments(invoiceId: string): Promise<Payment[]> {
  if (db) {
    try {
      const q = query(
        collection(db, 'payments'),
        where('invoiceId', '==', invoiceId)
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const payments = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Payment[];
        return payments.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      }
    } catch (e) {
      console.warn('Error fetching invoice payments:', e);
    }
  }
  const allPayments = getLocalData<Payment>(LOCAL_PAYMENTS_KEY, []);
  return allPayments.filter(p => p.invoiceId === invoiceId).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

// 8. Record Payment Action
export async function recordPayment(paymentData: {
  invoiceId: string;
  customerId: string;
  userId: string;
  amount: number;
  date: string;
  method: string;
  notes?: string | null;
}): Promise<void> {
  const invoice = await getInvoiceById(paymentData.invoiceId);
  if (!invoice) {
    throw new Error(`Invoice ${paymentData.invoiceId} not found.`);
  }

  const payAmount = Number(paymentData.amount) || 0;
  if (payAmount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  const currentBalance = invoice.balanceDue !== undefined && invoice.balanceDue !== null ? invoice.balanceDue : invoice.total;
  const newBalance = Math.max(0, currentBalance - payAmount);
  let newStatus: InvoiceStatus = invoice.status;
  if (newBalance === 0) {
    newStatus = 'paid';
  } else if (newBalance > 0 && newBalance < invoice.total) {
    newStatus = 'partially_paid';
  }
  const updatedAt = new Date().toISOString();

  const paymentId = `pay_${Date.now()}`;
  const paymentObj: Payment = {
    id: paymentId,
    userId: paymentData.userId,
    invoiceId: paymentData.invoiceId,
    customerId: paymentData.customerId,
    amount: payAmount,
    date: paymentData.date,
    method: paymentData.method || 'Bank Transfer',
    notes: paymentData.notes || null,
    createdAt: updatedAt,
    updatedAt: updatedAt,
  };

  if (db) {
    try {
      await setDoc(doc(db, 'payments', paymentId), {
        ...paymentObj,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await updateDoc(doc(db, 'invoices', invoice.id), {
        balanceDue: newBalance,
        status: newStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err: any) {
      console.error('Firestore record payment error:', err);
      throw new Error(`Failed to record payment in Firestore: ${err?.message || 'Database error'}`);
    }
  }

  const localPayments = getLocalData<Payment>(LOCAL_PAYMENTS_KEY, []);
  localPayments.unshift(paymentObj);
  setLocalData(LOCAL_PAYMENTS_KEY, localPayments);

  const localInvoices = getLocalData<Invoice>(LOCAL_INVOICES_KEY, DEMO_INVOICES);
  const idx = localInvoices.findIndex(i => i.id === invoice.id);
  if (idx >= 0) {
    localInvoices[idx].balanceDue = newBalance;
    localInvoices[idx].status = newStatus;
    localInvoices[idx].updatedAt = updatedAt;
    setLocalData(LOCAL_INVOICES_KEY, localInvoices);
  }

  await createNotification({
    userId: paymentData.userId,
    title: 'Payment Received',
    message: `Payment of $${payAmount.toFixed(2)} recorded for Invoice #${invoice.invoiceNumber}. ${newBalance === 0 ? 'Invoice is fully paid!' : `Remaining balance: $${newBalance.toFixed(2)}`}`,
    type: 'payment_received',
    read: false,
    relatedEntityId: invoice.id,
  });

  await logActivity({
    userId: paymentData.userId,
    entityType: 'invoice',
    entityId: invoice.id,
    action: 'payment_recorded',
    description: `Recorded payment of $${payAmount.toFixed(2)} (${paymentData.method}) for Invoice #${invoice.invoiceNumber}. Remaining balance: $${newBalance.toFixed(2)}.`,
  });
}

// 9. Generate Invoice Share Link
export async function generateInvoiceShareLink(invoiceId: string): Promise<{ shareUrl: string; shareToken: string }> {
  const currentUserId = auth?.currentUser?.uid;
  if (!currentUserId || !db) throw new Error('Requires authenticated database access');

  const invoice = await getInvoiceById(invoiceId);
  if (!invoice) throw new Error('Invoice not found');
  if (invoice.userId !== currentUserId) throw new Error('Unauthorized');

  const shareToken = invoice.shareToken || `inv_${Math.random().toString(36).substring(2, 15)}_${Date.now().toString(36)}`;
  
  const batch = writeBatch(db);

  // 1. Update /invoices/{id} if shareToken is new
  if (!invoice.shareToken) {
    const invoiceRef = doc(db, 'invoices', invoice.id);
    batch.update(invoiceRef, {
      shareToken: shareToken,
      updatedAt: serverTimestamp()
    });
  }

  // 2. Upsert /invoiceShareLinks/{shareToken}
  const linkRef = doc(db, 'invoiceShareLinks', shareToken);
  batch.set(linkRef, {
    shareToken: shareToken,
    invoiceId: invoice.id,
    userId: invoice.userId,
    customerId: invoice.customerId,
    customerName: invoice.customerName,
    invoiceNumber: invoice.invoiceNumber,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    status: invoice.status,
    lineItems: invoice.lineItems,
    subtotal: invoice.subtotal,
    taxTotal: invoice.taxTotal,
    discountTotal: invoice.discountTotal,
    total: invoice.total,
    notes: invoice.notes || null,
    terms: invoice.terms || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true });

  await batch.commit();

  const shareUrl = `${window.location.origin}/i/${shareToken}`;
  return { shareUrl, shareToken };
}

// 10. Fetch Invoice by Share Token
export async function getInvoiceByShareToken(shareToken: string): Promise<any> {
  if (db) {
    const linkRef = doc(db, 'invoiceShareLinks', shareToken);
    const snap = await getDoc(linkRef);
    if (snap.exists()) {
      return snap.data();
    }
  }
  return null;
}
