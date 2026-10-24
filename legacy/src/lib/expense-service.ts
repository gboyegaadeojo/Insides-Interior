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
import { Expense } from '../types';
import { getLocalData, setLocalData } from './invoice-service';

export const LOCAL_EXPENSES_KEY = 'invoiceos_demo_expenses';

export async function getExpenses(userId: string): Promise<Expense[]> {
  if (db && userId && userId !== 'demo_user') {
    try {
      const q = query(
        collection(db, 'expenses'), 
        where('userId', '==', userId)
      );
      const snapshot = await getDocs(q);
      const expenses = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Expense[];
      
      return expenses.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    } catch (e) {
      console.warn('Firestore getExpenses failed:', e);
    }
  }
  return getLocalData<Expense>(LOCAL_EXPENSES_KEY, []).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function saveExpense(expenseData: Partial<Expense>): Promise<Expense> {
  const currentUserId = auth?.currentUser?.uid || 'demo_user';
  const nowStr = new Date().toISOString();
  const isEdit = !!expenseData.id && expenseData.id !== 'new';
  const expenseId = isEdit ? expenseData.id! : `exp_${Date.now()}`;
  
  const completeExpense: Expense = {
    id: expenseId,
    userId: currentUserId,
    category: expenseData.category || 'general',
    amount: expenseData.amount || 0,
    date: expenseData.date || nowStr,
    merchant: expenseData.merchant || '',
    description: expenseData.description || null,
    receiptUrl: expenseData.receiptUrl || null,
    createdAt: expenseData.createdAt || nowStr,
    updatedAt: nowStr
  };

  if (db && currentUserId !== 'demo_user') {
    try {
      const expenseDocRef = doc(db, 'expenses', expenseId);
      await setDoc(expenseDocRef, { ...completeExpense, updatedAt: serverTimestamp(), createdAt: expenseData.createdAt || serverTimestamp() }, { merge: true });
    } catch (e) {
      console.error('Firestore saveExpense failed:', e);
      throw e;
    }
  }
  
  // Local fallback
  const local = getLocalData<Expense>(LOCAL_EXPENSES_KEY, []);
  const existingIdx = local.findIndex(i => i.id === expenseId);
  if (existingIdx >= 0) {
    local[existingIdx] = completeExpense;
  } else {
    local.push(completeExpense);
  }
  setLocalData(LOCAL_EXPENSES_KEY, local);
  
  return completeExpense;
}

export async function deleteExpense(id: string): Promise<void> {
  const currentUserId = auth?.currentUser?.uid || 'demo_user';
  if (db && id && currentUserId !== 'demo_user') {
    try {
      await deleteDoc(doc(db, 'expenses', id));
    } catch (e) {
      console.error('Firestore deleteExpense failed:', e);
      throw e;
    }
  }
  
  const local = getLocalData<Expense>(LOCAL_EXPENSES_KEY, []);
  const updated = local.filter(i => i.id !== id);
  setLocalData(LOCAL_EXPENSES_KEY, updated);
}
