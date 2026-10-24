import { db, auth } from './firebase/config';
import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  deleteDoc,
  query, 
  where, 
  serverTimestamp,
  writeBatch,
  orderBy
} from 'firebase/firestore';
import { Customer, Invoice, Quote, Payment } from '../types';
import { logActivity } from './invoice-service';

export async function getCustomers(userId: string): Promise<Customer[]> {
  if (db && userId && userId !== 'demo_user') {
    try {
      const q = query(
        collection(db, 'customers'), 
        where('userId', '==', userId)
      );
      const snapshot = await getDocs(q);
      const customers = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Customer[];
      
      // We will sort them in memory
      return customers.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      console.warn('Firestore getCustomers failed:', e);
    }
  }
  return [];
}

export async function saveCustomer(customerData: Partial<Customer>): Promise<Customer> {
  const currentUserId = auth?.currentUser?.uid || 'demo_user';
  const nowStr = new Date().toISOString();
  const isEdit = !!customerData.id && customerData.id !== 'new';
  const customerId = isEdit ? customerData.id! : `cust_${Date.now()}`;
  
  const completeCustomer: Customer = {
    id: customerId,
    userId: currentUserId,
    name: customerData.name || '',
    email: customerData.email || '',
    phone: customerData.phone || null,
    billingAddress: customerData.billingAddress || null,
    taxId: customerData.taxId || null,
    notes: customerData.notes || null,
    totalBilled: customerData.totalBilled || 0,
    outstandingBalance: customerData.outstandingBalance || 0,
    createdAt: customerData.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  if (db && currentUserId !== 'demo_user') {
    try {
      const customerDocRef = doc(db, 'customers', customerId);
      await setDoc(customerDocRef, completeCustomer, { merge: true });
      
      await logActivity({
        userId: currentUserId,
        entityType: 'customer',
        entityId: customerId,
        action: isEdit ? 'updated' : 'created',
        description: isEdit 
          ? `Updated customer ${completeCustomer.name}`
          : `Created customer ${completeCustomer.name}`
      });
      
      return completeCustomer;
    } catch (e) {
      console.error('Firestore saveCustomer failed:', e);
      throw e;
    }
  }
  return completeCustomer;
}

export async function deleteCustomer(id: string): Promise<void> {
  const currentUserId = auth?.currentUser?.uid;
  if (db && id && currentUserId) {
    try {
      await deleteDoc(doc(db, 'customers', id));
      await logActivity({
        userId: currentUserId,
        entityType: 'customer',
        entityId: id,
        action: 'deleted',
        description: `Customer deleted`
      });
    } catch (e) {
      console.error('Firestore deleteCustomer failed:', e);
      throw e;
    }
  }
}

export async function getCustomerActivity(userId: string, customerId: string) {
  if (!db || !userId || userId === 'demo_user') return { invoices: [], quotes: [], payments: [] };
  
  try {
    const [invSnap, quoteSnap, paySnap] = await Promise.all([
      getDocs(query(collection(db, 'invoices'), where('userId', '==', userId), where('customerId', '==', customerId))),
      getDocs(query(collection(db, 'quotes'), where('userId', '==', userId), where('customerId', '==', customerId))),
      getDocs(query(collection(db, 'payments'), where('userId', '==', userId), where('customerId', '==', customerId)))
    ]);
    
    return {
      invoices: invSnap.docs.map(d => ({ id: d.id, ...d.data() } as Invoice)),
      quotes: quoteSnap.docs.map(d => ({ id: d.id, ...d.data() } as Quote)),
      payments: paySnap.docs.map(d => ({ id: d.id, ...d.data() } as Payment))
    };
  } catch (e) {
    console.warn('Failed to fetch customer activity:', e);
    return { invoices: [], quotes: [], payments: [] };
  }
}
