import { db, auth } from './firebase/config';
import { 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  deleteDoc,
  query, 
  where, 
  serverTimestamp,
} from 'firebase/firestore';
import { Item, Invoice, Quote } from '../types';
import { getLocalData, setLocalData, LOCAL_ITEMS_KEY, DEMO_ITEMS } from './invoice-service';

export async function getItems(userId: string): Promise<Item[]> {
  if (db && userId && userId !== 'demo_user') {
    try {
      const q = query(
        collection(db, 'items'), 
        where('userId', '==', userId)
      );
      const snapshot = await getDocs(q);
      const items = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Item[];
      
      return items.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      console.warn('Firestore getItems failed:', e);
    }
  }
  return getLocalData<Item>(LOCAL_ITEMS_KEY, DEMO_ITEMS).sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveItem(itemData: Partial<Item>): Promise<Item> {
  const currentUserId = auth?.currentUser?.uid || 'demo_user';
  const nowStr = new Date().toISOString();
  const isEdit = !!itemData.id && itemData.id !== 'new';
  const itemId = isEdit ? itemData.id! : `item_${Date.now()}`;
  
  const completeItem: Item = {
    id: itemId,
    userId: currentUserId,
    type: itemData.type || 'product',
    name: itemData.name || '',
    description: itemData.description || null,
    unitPrice: itemData.unitPrice || 0,
    isTaxable: itemData.isTaxable !== undefined ? itemData.isTaxable : true,
    createdAt: itemData.createdAt || nowStr,
    updatedAt: nowStr
  };

  if (db && currentUserId !== 'demo_user') {
    try {
      const itemDocRef = doc(db, 'items', itemId);
      await setDoc(itemDocRef, { ...completeItem, updatedAt: serverTimestamp(), createdAt: itemData.createdAt || serverTimestamp() }, { merge: true });
      
      // Removing logActivity
    } catch (e) {
      console.error('Firestore saveItem failed:', e);
      throw e;
    }
  }
  
  // Local fallback
  const local = getLocalData<Item>(LOCAL_ITEMS_KEY, DEMO_ITEMS);
  const existingIdx = local.findIndex(i => i.id === itemId);
  if (existingIdx >= 0) {
    local[existingIdx] = completeItem;
  } else {
    local.push(completeItem);
  }
  setLocalData(LOCAL_ITEMS_KEY, local);
  
  return completeItem;
}

export async function deleteItem(id: string): Promise<void> {
  const currentUserId = auth?.currentUser?.uid || 'demo_user';
  if (db && id && currentUserId !== 'demo_user') {
    try {
      await deleteDoc(doc(db, 'items', id));
    } catch (e) {
      console.error('Firestore deleteItem failed:', e);
      throw e;
    }
  }
  
  const local = getLocalData<Item>(LOCAL_ITEMS_KEY, DEMO_ITEMS);
  const updated = local.filter(i => i.id !== id);
  setLocalData(LOCAL_ITEMS_KEY, updated);
}

export async function checkItemUsage(userId: string, itemId: string): Promise<{ invoiceCount: number, quoteCount: number }> {
  if (!db || !userId || userId === 'demo_user') {
    return { invoiceCount: 0, quoteCount: 0 }; // Simplified for demo
  }
  
  try {
    let invoiceCount = 0;
    let quoteCount = 0;

    const [invSnap, quoteSnap] = await Promise.all([
      getDocs(query(collection(db, 'invoices'), where('userId', '==', userId))),
      getDocs(query(collection(db, 'quotes'), where('userId', '==', userId)))
    ]);

    invSnap.docs.forEach(d => {
      const data = d.data() as Invoice;
      if (data.lineItems?.some(li => li.itemId === itemId)) {
        invoiceCount++;
      }
    });

    quoteSnap.docs.forEach(d => {
      const data = d.data() as Quote;
      if (data.lineItems?.some(li => li.itemId === itemId)) {
        quoteCount++;
      }
    });

    return { invoiceCount, quoteCount };
  } catch (e) {
    console.warn('Failed to check item usage:', e);
    return { invoiceCount: 0, quoteCount: 0 };
  }
}
