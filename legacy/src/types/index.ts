export type InvoiceStatus = 
  | 'draft' 
  | 'pending' 
  | 'partially_paid'
  | 'paid' 
  | 'overdue' 
  | 'void';

export type QuoteStatus = 
  | 'draft' 
  | 'sent_for_approval' 
  | 'changes_requested' 
  | 'approved' 
  | 'rejected' 
  | 'converted';

export interface InvoiceLineItem {
  itemId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  amount: number;
  type?: 'service' | 'product' | 'discount';
}

export interface Invoice {
  id: string;
  userId: string;
  customerId: string;
  customerName: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  shareToken?: string | null;
  version: number;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
  balanceDue: number;
  notes?: string | null;
  terms?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

export interface QuoteRevision {
  id: string;
  quoteId: string;
  userId: string;
  version: number;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
  clientComment?: string | null;
  createdBy: 'owner' | 'client';
  createdAt?: any;
}

export interface Quote {
  id: string;
  userId: string;
  customerId: string;
  customerName: string;
  quoteNumber: string;
  issueDate: string;
  expiryDate: string;
  status: QuoteStatus;
  shareToken: string;
  version: number;
  lineItems: InvoiceLineItem[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
  notes?: string | null;
  terms?: string | null;
  publicRevisions?: QuoteRevision[];
  createdAt?: any;
  updatedAt?: any;
}

export interface Customer {
  id: string;
  userId: string;
  name: string;
  email: string;
  phone?: string | null;
  billingAddress?: string | null;
  taxId?: string | null;
  notes?: string | null;
  totalBilled?: number;
  outstandingBalance?: number;
  createdAt?: any;
  updatedAt?: any;
}

export interface Item {
  id: string;
  userId: string;
  type: 'product' | 'service';
  name: string;
  description?: string | null;
  unitPrice: number;
  isTaxable: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'invoice_approved' | 'invoice_changes_requested' | 'invoice_overdue' | 'quote_accepted' | 'payment_received' | 'system';
  read: boolean;
  relatedEntityId?: string | null;
  createdAt?: any;
}

export interface ActivityLog {
  id: string;
  userId: string;
  entityType: 'invoice' | 'quote' | 'customer' | 'payment' | 'expense';
  entityId: string;
  action: string;
  description: string;
  metadata?: Record<string, any> | null;
  createdAt?: any;
}

export interface Payment {
  id: string;
  userId: string;
  invoiceId: string;
  customerId: string;
  amount: number;
  date: string;
  method: string;
  notes?: string | null;
  createdAt?: any;
  updatedAt?: any;
}

export interface Expense {
  id: string;
  userId: string;
  category: string;
  amount: number;
  date: string;
  merchant: string;
  description?: string | null;
  receiptUrl?: string | null;
  createdAt?: any;
  updatedAt?: any;
}
