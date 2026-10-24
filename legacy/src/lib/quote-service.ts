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
  orderBy, 
  addDoc, 
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { Quote, QuoteRevision, QuoteStatus, Invoice } from '../types';
import { saveInvoice, logActivity } from './invoice-service';

// Utility for generating unique quote share token
export function generateQuoteShareToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `quote_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `quote_${Math.random().toString(36).substring(2, 15)}${Date.now().toString(36)}`;
}

// LocalStorage key for fallback
const LOCAL_QUOTES_KEY = 'invoiceos_demo_quotes';
const LOCAL_QUOTE_REVISIONS_KEY = 'invoiceos_demo_quote_revisions';

function getLocalData<T>(key: string, defaultVal: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.error('Error reading localStorage', e);
  }
  localStorage.setItem(key, JSON.stringify(defaultVal));
  return defaultVal;
}

function setLocalData<T>(key: string, data: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.error('Error writing localStorage', e);
  }
}

export const DEMO_QUOTES: Quote[] = [
  {
    id: 'quote_201',
    userId: 'demo_user',
    customerId: 'cust_1',
    customerName: 'Acme Corporation',
    quoteNumber: 'QT-2026-001',
    issueDate: '2026-07-20',
    expiryDate: '2026-08-20',
    status: 'sent_for_approval',
    shareToken: 'quote_acme_demo_token_201',
    version: 1,
    lineItems: [
      { itemId: 'item_1', description: 'Design System Consulting & Workshop', quantity: 10, unitPrice: 150, taxRate: 8.5, amount: 1500, type: 'service' },
      { itemId: 'item_2', description: 'Prototype Architecture Build', quantity: 20, unitPrice: 180, taxRate: 8.5, amount: 3600, type: 'service' }
    ],
    subtotal: 5100,
    taxTotal: 433.5,
    discountTotal: 0,
    total: 5533.5,
    notes: 'Quote valid for 30 days. Please review and approve.',
    terms: '50% deposit upon acceptance.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'quote_202',
    userId: 'demo_user',
    customerId: 'cust_2',
    customerName: 'Starlight Media',
    quoteNumber: 'QT-2026-002',
    issueDate: '2026-07-25',
    expiryDate: '2026-08-25',
    status: 'approved',
    shareToken: 'quote_starlight_demo_token_202',
    version: 1,
    lineItems: [
      { itemId: 'item_4', description: 'Technical Security Audit', quantity: 1, unitPrice: 1200, taxRate: 8.5, amount: 1200, type: 'service' }
    ],
    subtotal: 1200,
    taxTotal: 102,
    discountTotal: 0,
    total: 1302,
    notes: 'Approved by client. Ready for conversion.',
    terms: 'Net 15',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
];

export const DEMO_QUOTE_REVISIONS: QuoteRevision[] = [];

// Service Methods

// 1. Fetch Quotes (Owner)
export async function getQuotes(userId: string): Promise<Quote[]> {
  if (db && userId && userId !== 'demo_user') {
    try {
      const q = query(
        collection(db, 'quotes'), 
        where('userId', '==', userId)
      );
      const snapshot = await getDocs(q);
      const quotes = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Quote[];
      
      return quotes.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    } catch (e) {
      console.warn('Firestore getQuotes failed, using fallback:', e);
    }
  }
  
  const local = getLocalData<Quote>(LOCAL_QUOTES_KEY, DEMO_QUOTES);
  return local.filter(q => q.userId === userId || userId === 'demo_user');
}

// 2. Fetch Single Quote by ID
export async function getQuoteById(id: string): Promise<Quote | null> {
  if (db && id && !id.startsWith('quote_20')) {
    try {
      const docRef = doc(db, 'quotes', id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return { id: snap.id, ...snap.data() } as Quote;
      }
    } catch (e) {
      console.warn('Firestore getQuoteById failed:', e);
    }
  }

  const local = getLocalData<Quote>(LOCAL_QUOTES_KEY, DEMO_QUOTES);
  return local.find(q => q.id === id) || null;
}

// 3. Fetch Public Quote by shareToken (Client View)
export async function getQuoteByShareToken(shareToken: string): Promise<Quote | null> {
  if (db && shareToken) {
    try {
      const linkDocRef = doc(db, 'quoteShareLinks', shareToken);
      const linkSnap = await getDoc(linkDocRef);
      
      if (linkSnap.exists()) {
        const linkData = linkSnap.data();
        return {
          id: linkData.id,
          userId: linkData.userId,
          customerId: linkData.customerId || '',
          customerName: linkData.customerName,
          quoteNumber: linkData.quoteNumber,
          issueDate: linkData.issueDate,
          expiryDate: linkData.expiryDate || '',
          status: linkData.status,
          shareToken: linkData.shareToken,
          version: linkData.version || 1,
          lineItems: linkData.lineItems || [],
          subtotal: linkData.subtotal || 0,
          taxTotal: linkData.taxTotal || 0,
          discountTotal: linkData.discountTotal || 0,
          total: linkData.total || 0,
          notes: linkData.notes || null,
          terms: linkData.terms || null,
          publicRevisions: linkData.publicRevisions || [],
          createdAt: linkData.createdAt,
          updatedAt: linkData.updatedAt
        } as Quote;
      }

      // Fallback query directly on quotes collection
      const q = query(collection(db, 'quotes'), where('shareToken', '==', shareToken));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const firstDoc = snapshot.docs[0];
        return { id: firstDoc.id, ...firstDoc.data() } as Quote;
      }
    } catch (e) {
      console.warn('Firestore getQuoteByShareToken error, checking local fallback:', e);
    }
  }

  const local = getLocalData<Quote>(LOCAL_QUOTES_KEY, DEMO_QUOTES);
  return local.find(q => q.shareToken === shareToken) || null;
}

// 4. Save/Update Quote (Owner)
export async function saveQuote(quoteData: Partial<Quote> & { customerId: string; customerName: string; lineItems: any[] }): Promise<Quote> {
  const currentUserId = auth?.currentUser?.uid || quoteData.userId || 'demo_user';
  const shareToken = quoteData.shareToken || generateQuoteShareToken();
  const nowStr = new Date().toISOString();

  const isEdit = !!quoteData.id && quoteData.id !== 'new';
  const quoteId = isEdit ? quoteData.id! : `quote_${Date.now()}`;

  const completeQuote: Quote = {
    id: quoteId,
    userId: currentUserId,
    customerId: quoteData.customerId,
    customerName: quoteData.customerName,
    quoteNumber: quoteData.quoteNumber || `QT-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
    issueDate: quoteData.issueDate || nowStr.split('T')[0],
    expiryDate: quoteData.expiryDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    status: (quoteData.status as QuoteStatus) || 'draft',
    shareToken: shareToken,
    version: quoteData.version || 1,
    lineItems: quoteData.lineItems || [],
    subtotal: quoteData.subtotal || 0,
    taxTotal: quoteData.taxTotal || 0,
    discountTotal: quoteData.discountTotal || 0,
    total: quoteData.total || 0,
    notes: quoteData.notes || null,
    terms: quoteData.terms || null,
    createdAt: quoteData.createdAt || nowStr,
    updatedAt: nowStr
  };

  if (db && currentUserId !== 'demo_user') {
    try {
      const batch = writeBatch(db);
      const quoteDocRef = doc(db, 'quotes', quoteId);
      batch.set(quoteDocRef, { ...completeQuote, updatedAt: serverTimestamp(), createdAt: quoteData.createdAt || serverTimestamp() }, { merge: true });

      // If quote has a share link active, sync to quoteShareLinks
      if (completeQuote.shareToken) {
        const linkDocRef = doc(db, 'quoteShareLinks', completeQuote.shareToken);
        batch.set(linkDocRef, {
          id: completeQuote.id,
          userId: completeQuote.userId,
          customerId: completeQuote.customerId,
          customerName: completeQuote.customerName,
          quoteNumber: completeQuote.quoteNumber,
          issueDate: completeQuote.issueDate,
          expiryDate: completeQuote.expiryDate,
          status: completeQuote.status,
          shareToken: completeQuote.shareToken,
          version: completeQuote.version,
          lineItems: completeQuote.lineItems,
          subtotal: completeQuote.subtotal,
          taxTotal: completeQuote.taxTotal,
          discountTotal: completeQuote.discountTotal,
          total: completeQuote.total,
          notes: completeQuote.notes,
          terms: completeQuote.terms,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }

      await batch.commit();
      return completeQuote;
    } catch (e) {
      console.warn('Firestore saveQuote failed, saving to local fallback:', e);
    }
  }

  // Local Storage Fallback
  const local = getLocalData<Quote>(LOCAL_QUOTES_KEY, DEMO_QUOTES);
  const existingIdx = local.findIndex(q => q.id === quoteId);
  if (existingIdx >= 0) {
    local[existingIdx] = completeQuote;
  } else {
    local.unshift(completeQuote);
  }
  setLocalData(LOCAL_QUOTES_KEY, local);

  await logActivity({
    userId: currentUserId,
    entityType: 'quote',
    entityId: completeQuote.id,
    action: isEdit ? 'updated' : 'created',
    description: isEdit
      ? `Updated quote ${completeQuote.quoteNumber} (Status: ${completeQuote.status})`
      : `Created quote ${completeQuote.quoteNumber}`
  });

  return completeQuote;
}

// 5. Send Quote for Approval (Owner)
export async function sendQuoteForApproval(quote: Quote): Promise<{ quote: Quote; shareUrl: string }> {
  const currentUserId = auth?.currentUser?.uid || quote.userId;
  const shareToken = quote.shareToken || generateQuoteShareToken();
  const nowStr = new Date().toISOString();

  const updatedQuote: Quote = {
    ...quote,
    status: 'sent_for_approval',
    shareToken: shareToken,
    updatedAt: nowStr
  };

  if (db && currentUserId !== 'demo_user') {
    try {
      const batch = writeBatch(db);

      // 1. Upsert /quotes/{id}
      const quoteRef = doc(db, 'quotes', quote.id);
      batch.set(quoteRef, {
        ...quote,
        status: 'sent_for_approval',
        shareToken: shareToken,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // 2. Upsert /quoteShareLinks/{shareToken}
      const linkRef = doc(db, 'quoteShareLinks', shareToken);
      batch.set(linkRef, {
        id: quote.id,
        userId: currentUserId,
        customerId: quote.customerId,
        customerName: quote.customerName,
        quoteNumber: quote.quoteNumber,
        issueDate: quote.issueDate,
        expiryDate: quote.expiryDate,
        status: 'sent_for_approval',
        shareToken: shareToken,
        version: quote.version || 1,
        lineItems: quote.lineItems,
        subtotal: quote.subtotal,
        taxTotal: quote.taxTotal,
        discountTotal: quote.discountTotal,
        total: quote.total,
        notes: quote.notes || null,
        terms: quote.terms || null,
        publicRevisions: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // 3. Create Version 1 snapshot in /quoteRevisions
      const revRef = doc(collection(db, 'quoteRevisions'));
      batch.set(revRef, {
        id: revRef.id,
        quoteId: quote.id,
        userId: currentUserId,
        version: quote.version || 1,
        lineItems: quote.lineItems,
        subtotal: quote.subtotal,
        taxTotal: quote.taxTotal,
        discountTotal: quote.discountTotal,
        total: quote.total,
        clientComment: null,
        createdBy: 'owner',
        createdAt: serverTimestamp()
      });

      await batch.commit();

      const shareUrl = `${window.location.origin}/q/${shareToken}`;
      return { quote: updatedQuote, shareUrl };
    } catch (e) {
      console.warn('Firestore sendQuoteForApproval failed:', e);
    }
  }

  // Fallback
  const local = getLocalData<Quote>(LOCAL_QUOTES_KEY, DEMO_QUOTES);
  const idx = local.findIndex(q => q.id === quote.id);
  if (idx >= 0) {
    local[idx] = updatedQuote;
    setLocalData(LOCAL_QUOTES_KEY, local);
  }

  const shareUrl = `${window.location.origin}/q/${shareToken}`;
  await logActivity({
    userId: currentUserId,
    entityType: 'quote',
    entityId: updatedQuote.id,
    action: 'sent_for_approval',
    description: `Sent quote ${updatedQuote.quoteNumber} to client`
  });

  return { quote: updatedQuote, shareUrl };
}

// 6. Client Approve Quote
export async function clientApproveQuote(quote: Quote): Promise<void> {
  const nowStr = new Date().toISOString();

  if (db && quote.shareToken) {
    const batch = writeBatch(db);

    // 1. Update /quoteShareLinks/{shareToken}
    const linkRef = doc(db, 'quoteShareLinks', quote.shareToken);
    batch.update(linkRef, {
      status: 'approved',
      updatedAt: serverTimestamp()
    });

    // 2. Update /quotes/{id}
    const quoteRef = doc(db, 'quotes', quote.id);
    batch.update(quoteRef, {
      status: 'approved',
      updatedAt: serverTimestamp()
    });

    // 3. Write Notification for Owner
    const notifRef = doc(collection(db, 'notifications'));
    batch.set(notifRef, {
      id: notifRef.id,
      userId: quote.userId,
      title: 'Quote Approved',
      message: `Quote #${quote.quoteNumber} was approved by ${quote.customerName}.`,
      type: 'quote_accepted',
      read: false,
      relatedEntityId: quote.id,
      shareToken: quote.shareToken,
      createdAt: serverTimestamp()
    });

    // 4. Write Activity Log
    const actRef = doc(collection(db, 'activityLogs'));
    batch.set(actRef, {
      id: actRef.id,
      userId: quote.userId,
      entityType: 'quote',
      entityId: quote.id,
      action: 'approved',
      description: `Client approved Quote #${quote.quoteNumber}`,
      shareToken: quote.shareToken,
      metadata: { total: quote.total },
      createdAt: serverTimestamp()
    });

    await batch.commit();
    return;
  }

  // Fallback
  const local = getLocalData<Quote>(LOCAL_QUOTES_KEY, DEMO_QUOTES);
  const idx = local.findIndex(q => q.id === quote.id);
  if (idx >= 0) {
    local[idx].status = 'approved';
    local[idx].updatedAt = nowStr;
    setLocalData(LOCAL_QUOTES_KEY, local);
  }
}

// 7. Client Request Changes on Quote
export async function clientRequestChangesQuote(quote: Quote, clientComment: string): Promise<void> {
  const nowStr = new Date().toISOString();
  const trimmedComment = clientComment.trim().slice(0, 1000);

  if (db && quote.shareToken) {
    const batch = writeBatch(db);

    // Get current publicRevisions array
    const existingRevs = quote.publicRevisions || [];
    const newRevObj = {
      id: `rev_client_${Date.now()}`,
      quoteId: quote.id,
      userId: quote.userId,
      version: quote.version || 1,
      lineItems: quote.lineItems,
      subtotal: quote.subtotal,
      taxTotal: quote.taxTotal,
      discountTotal: quote.discountTotal,
      total: quote.total,
      clientComment: trimmedComment,
      createdBy: 'client',
      createdAt: nowStr
    };

    const updatedPublicRevisions = [newRevObj, ...existingRevs];

    // 1. Update /quoteShareLinks/{shareToken}
    const linkRef = doc(db, 'quoteShareLinks', quote.shareToken);
    batch.update(linkRef, {
      status: 'changes_requested',
      publicRevisions: updatedPublicRevisions,
      updatedAt: serverTimestamp()
    });

    // 2. Update /quotes/{id}
    const quoteRef = doc(db, 'quotes', quote.id);
    batch.update(quoteRef, {
      status: 'changes_requested',
      publicRevisions: updatedPublicRevisions,
      updatedAt: serverTimestamp()
    });

    // 3. Create /quoteRevisions entry
    const revRef = doc(collection(db, 'quoteRevisions'));
    batch.set(revRef, {
      id: revRef.id,
      quoteId: quote.id,
      userId: quote.userId,
      shareToken: quote.shareToken,
      version: quote.version || 1,
      lineItems: quote.lineItems,
      subtotal: quote.subtotal,
      taxTotal: quote.taxTotal,
      discountTotal: quote.discountTotal,
      total: quote.total,
      clientComment: trimmedComment,
      createdBy: 'client',
      createdAt: serverTimestamp()
    });

    // 4. Notification
    const notifRef = doc(collection(db, 'notifications'));
    batch.set(notifRef, {
      id: notifRef.id,
      userId: quote.userId,
      title: 'Quote Changes Requested',
      message: `Client requested changes for Quote #${quote.quoteNumber}: "${trimmedComment}"`,
      type: 'quote_changes_requested',
      read: false,
      relatedEntityId: quote.id,
      shareToken: quote.shareToken,
      createdAt: serverTimestamp()
    });

    await batch.commit();
    return;
  }

  // Fallback
  const local = getLocalData<Quote>(LOCAL_QUOTES_KEY, DEMO_QUOTES);
  const idx = local.findIndex(q => q.id === quote.id);
  if (idx >= 0) {
    local[idx].status = 'changes_requested';
    local[idx].updatedAt = nowStr;
    setLocalData(LOCAL_QUOTES_KEY, local);
  }

  await logActivity({
    userId: quote.userId,
    entityType: 'quote',
    entityId: quote.id,
    action: 'changes_requested',
    description: `Client requested changes for Quote #${quote.quoteNumber}`
  });
}

// 8. Fetch Quote Revisions
export async function getQuoteRevisions(quoteId: string, shareToken?: string): Promise<QuoteRevision[]> {
  const currentUserId = auth?.currentUser?.uid;
  if (db && quoteId && currentUserId) {
    try {
      const q = query(
        collection(db, 'quoteRevisions'),
        where('quoteId', '==', quoteId),
        where('userId', '==', currentUserId)
      );
      const snapshot = await getDocs(q);
      const revs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as QuoteRevision[];

      return revs.sort((a, b) => b.version - a.version);
    } catch (e) {
      console.warn('Firestore getQuoteRevisions error:', e);
    }
  }

  const local = getLocalData<QuoteRevision>(LOCAL_QUOTE_REVISIONS_KEY, DEMO_QUOTE_REVISIONS);
  return local.filter(r => r.quoteId === quoteId).sort((a, b) => b.version - a.version);
}

// 9. Convert Quote to Invoice
export async function convertQuoteToInvoice(quoteId: string): Promise<Invoice> {
  const quote = await getQuoteById(quoteId);
  if (!quote) {
    throw new Error(`Quote #${quoteId} not found.`);
  }

  // Create new Invoice
  const newInvoiceData = {
    userId: quote.userId,
    customerId: quote.customerId,
    customerName: quote.customerName,
    invoiceNumber: `INV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`,
    issueDate: new Date().toISOString().split('T')[0],
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    status: 'pending' as const,
    lineItems: quote.lineItems,
    subtotal: quote.subtotal,
    taxTotal: quote.taxTotal,
    discountTotal: quote.discountTotal,
    total: quote.total,
    balanceDue: quote.total,
    notes: `Converted from Quote #${quote.quoteNumber}. ${quote.notes || ''}`,
    terms: quote.terms || 'Net 30'
  };

  const createdInvoice = await saveInvoice(newInvoiceData);

  // Mark Quote as Converted
  await saveQuote({
    ...quote,
    status: 'converted'
  });

  return createdInvoice;
}

// 10. Delete Quote
export async function deleteQuote(id: string, shareToken?: string): Promise<void> {
  const currentUserId = auth?.currentUser?.uid;

  if (db && id && currentUserId) {
    try {
      const batch = writeBatch(db);

      // 1. Delete /quotes/{id}
      batch.delete(doc(db, 'quotes', id));

      // 2. Delete /quoteShareLinks/{shareToken} if exists
      if (shareToken) {
        batch.delete(doc(db, 'quoteShareLinks', shareToken));
      }

      // 3. Delete related /quoteRevisions
      const revQuery = query(collection(db, 'quoteRevisions'), where('quoteId', '==', id));
      const revSnap = await getDocs(revQuery);
      revSnap.forEach((revDoc) => {
        batch.delete(revDoc.ref);
      });

      await batch.commit();
      return;
    } catch (e) {
      console.warn('Firestore deleteQuote failed:', e);
    }
  }

  // Local Storage Fallback
  const local = getLocalData<Quote>(LOCAL_QUOTES_KEY, DEMO_QUOTES);
  const updated = local.filter(q => q.id !== id);
  setLocalData(LOCAL_QUOTES_KEY, updated);
  
  await logActivity({
    userId: currentUserId || 'demo_user',
    entityType: 'quote',
    entityId: id,
    action: 'deleted',
    description: `Quote ${id} was permanently deleted.`
  });
}
