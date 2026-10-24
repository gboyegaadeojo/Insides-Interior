import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  Invoice, 
  InvoiceLineItem, 
  Customer, 
  Item, 
  InvoiceStatus 
} from '../../../types';
import { 
  getInvoiceById, 
  getCustomers, 
   
  saveInvoice, 
  deleteInvoice,
  recordPayment,
  generateInvoiceShareLink,
  getInvoicePayments
} from '../../../lib/invoice-service';
import { getItems } from "../../../lib/item-service";
import { useAuth } from '../../../hooks/use-auth';
import { StatusBadge } from '../../../components/shared/status-badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { 
  Drawer, 
  DrawerContent, 
  DrawerHeader, 
  DrawerTitle, 
  DrawerDescription 
} from '../../../components/ui/drawer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '../../../components/ui/dialog';
import { 
  Plus, 
  Trash2, 
  Send, 
  Save, 
  ArrowLeft, 
  Copy, 
  Check, 
  Sparkles, 
  History, 
  MessageSquare, 
  Command, 
  FileText, 
  Printer, 
  Eye, 
  Tag, 
  Package, 
  Briefcase, 
  AlertCircle,
  DollarSign,
  Link
} from 'lucide-react';

export function InvoiceBuilder() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const userId = user?.uid || 'demo_user';

  // Core Invoice Form State
  const [invoiceId, setInvoiceId] = useState<string>(id || `inv_${Date.now()}`);
  const [invoiceNumber, setInvoiceNumber] = useState<string>(`INV-2026-0${Math.floor(10 + Math.random() * 90)}`);
  const [customerId, setCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState<string>(new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]);
  const [status, setStatus] = useState<InvoiceStatus>('draft');
  const [balanceDue, setBalanceDue] = useState<number | undefined>(undefined);
  const [payments, setPayments] = useState<any[]>([]);
  const [shareToken, setShareToken] = useState<string>('');
  const [version, setVersion] = useState<number>(1);
  const [notes, setNotes] = useState<string>('Thank you for your business! Please remit payment upon approval.');
  const [terms, setTerms] = useState<string>('Net 30. Payments accepted via wire transfer or credit card.');

  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([
    {
      itemId: null,
      description: 'Web Design & Design System Development',
      quantity: 10,
      unitPrice: 150,
      taxRate: 8.5,
      amount: 1500,
      type: 'service'
    }
  ]);

  // Catalog & Auxiliary State
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [catalogItems, setCatalogItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // "/" Slash Command Popup State
  const [slashMenuIndex, setSlashMenuIndex] = useState<number | null>(null);
  const [activeSlashInput, setActiveSlashInput] = useState<string>('');

  // Revisions Drawer Toggle
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);

  // Delete Dialog state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Mark as Paid Dialog state
  const [isPaymentDialogOpen, setIsPaymentDialogOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState<string>('Bank Transfer');
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  const handleOpenPaymentModal = () => {
    const calculatedTotal = subtotal - discountTotal + taxTotal;
    const balance = balanceDue !== undefined && balanceDue !== null ? balanceDue : calculatedTotal;
    setPaymentAmount(String(balance));
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setPaymentMethod('Bank Transfer');
    setPaymentNotes('');
    setIsPaymentDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!id || id === 'new') return;
    setIsDeleting(true);
    try {
      await deleteInvoice(id);
      showToast(`Invoice #${invoiceNumber} permanently deleted.`);
      navigate('/invoices', { replace: true });
    } catch (err: any) {
      showToast(`Failed to delete invoice: ${err?.message || 'Error'}`);
      setIsDeleting(false);
    }
  };

  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || id === 'new') return;
    const amountNum = parseFloat(paymentAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('Please enter a valid payment amount greater than zero.');
      return;
    }
    setIsRecordingPayment(true);
    try {
      await recordPayment({
        invoiceId: id,
        customerId,
        userId,
        amount: amountNum,
        date: paymentDate,
        method: paymentMethod,
        notes: paymentNotes || null,
      });
      showToast(`Recorded payment of $${amountNum.toFixed(2)}.`);
      setIsPaymentDialogOpen(false);
      const updated = await getInvoiceById(id);
      if (updated) {
        setStatus(updated.status);
        setBalanceDue(updated.balanceDue);
        const invPayments = await getInvoicePayments(updated.id);
        setPayments(invPayments);
      }
    } catch (err: any) {
      showToast(`Failed to record payment: ${err?.message || 'Error'}`);
    } finally {
      setIsRecordingPayment(false);
    }
  };

  // Fetch initial data
  useEffect(() => {
    async function initData() {
      setLoading(true);
      const [custs, items] = await Promise.all([
        getCustomers(userId),
        getItems(userId)
      ]);
      setCustomers(custs);
      setCatalogItems(items);

      if (id && id !== 'new') {
        const existing = await getInvoiceById(id);
        if (existing) {
          setInvoiceId(existing.id);
          setInvoiceNumber(existing.invoiceNumber);
          setCustomerId(existing.customerId);
          setCustomerName(existing.customerName);
          setIssueDate(existing.issueDate);
          setDueDate(existing.dueDate);
          setStatus(existing.status);

          let loadedLineItems = existing.lineItems || [];
          if (existing.status === 'draft') {
            loadedLineItems = loadedLineItems.map(li => {
              if (li.itemId) {
                const catalogMatch = items.find(i => i.id === li.itemId);
                if (catalogMatch) {
                  const updatedPrice = catalogMatch.unitPrice;
                  const updatedDesc = `${catalogMatch.name} - ${catalogMatch.description || ''}`;
                  return {
                    ...li,
                    unitPrice: updatedPrice,
                    description: updatedDesc,
                    amount: updatedPrice * li.quantity,
                  };
                }
              }
              return li;
            });
          }
          setLineItems(loadedLineItems);

          setNotes(existing.notes || '');
          setTerms(existing.terms || '');
          setBalanceDue(existing.balanceDue);
          
          const invPayments = await getInvoicePayments(existing.id);
          setPayments(invPayments);
        }
      }
      setLoading(false);
    }
    initData();
  }, [id, userId]);

  // Recalculate Totals
  const subtotal = lineItems.reduce((acc, item) => {
    if (item.type === 'discount') {
      return acc - Math.abs(item.amount);
    }
    return acc + (item.quantity * item.unitPrice);
  }, 0);

  const taxTotal = lineItems.reduce((acc, item) => {
    if (item.type === 'discount' || !item.taxRate) return acc;
    const base = item.quantity * item.unitPrice;
    return acc + (base * (item.taxRate / 100));
  }, 0);

  const discountTotal = lineItems.reduce((acc, item) => {
    if (item.type === 'discount') {
      return acc + Math.abs(item.amount);
    }
    return acc;
  }, 0);

  const total = Math.max(0, subtotal + taxTotal);

  // Handle Line Item Changes
  const handleItemChange = (index: number, field: keyof InvoiceLineItem, val: any) => {
    setLineItems(prev => {
      const updated = [...prev];
      const target = { ...updated[index], [field]: val };

      // Recalculate line amount
      if (field === 'quantity' || field === 'unitPrice' || field === 'amount' || field === 'type') {
        if (target.type === 'discount') {
          target.amount = -Math.abs(Number(target.unitPrice) || 0);
        } else {
          target.amount = (Number(target.quantity) || 0) * (Number(target.unitPrice) || 0);
        }
      }

      updated[index] = target;
      return updated;
    });
  };

  // Add Item Helpers
  const addLineItem = (type: 'service' | 'product' | 'discount' = 'service') => {
    setLineItems(prev => [
      ...prev,
      {
        itemId: null,
        description: type === 'discount' ? 'Special Client Discount' : type === 'product' ? 'New Hardware Product' : 'Professional Service',
        quantity: type === 'discount' ? 1 : 1,
        unitPrice: type === 'discount' ? 100 : 150,
        taxRate: type === 'discount' ? 0 : 8.5,
        amount: type === 'discount' ? -100 : 150,
        type,
      }
    ]);
  };

  const addCatalogItem = (item: Item) => {
    setLineItems(prev => [
      ...prev,
      {
        itemId: item.id,
        description: `${item.name} - ${item.description || ''}`,
        quantity: 1,
        unitPrice: item.unitPrice,
        taxRate: item.isTaxable ? 8.5 : 0,
        amount: item.unitPrice,
        type: item.type,
      }
    ]);
  };

  const removeLineItem = (index: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== index));
  };

  // Select customer helper
  const handleCustomerSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    setCustomerId(selectedId);
    const found = customers.find(c => c.id === selectedId);
    if (found) {
      setCustomerName(found.name);
    }
  };

  // Save / Send Actions
  // Save Actions
  const handleSaveInvoice = async (newStatus: InvoiceStatus = status): Promise<Invoice | null> => {
    setSaving(true);
    try {
      const saved = await saveInvoice({
        id: id && id !== 'new' ? id : invoiceId,
        userId,
        customerId,
        customerName: customerName || 'Unassigned Customer',
        invoiceNumber,
        issueDate,
        dueDate,
        status: newStatus,
        lineItems,
        subtotal,
        taxTotal,
        discountTotal,
        total,
        balanceDue: total,
        notes,
        terms,
      });

      setStatus(saved.status);
      
      if (id === 'new') {
        navigate(`/invoices/${saved.id}/edit`, { replace: true });
      }

      showToast(`Invoice #${saved.invoiceNumber} saved as ${saved.status}.`);
      return saved;
    } catch (err: any) {
      console.error('Error saving invoice:', err);
      showToast(`Error saving invoice: ${err?.message || 'Unknown error'}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleCopyLink = async () => {
    if (!id || id === 'new') {
      showToast('Please save the invoice first to generate a link.');
      return;
    }
    
    // Auto-save the invoice before generating the link to ensure snapshot is up to date
    const saved = await handleSaveInvoice(status);
    if (!saved) return;

    try {
      const { shareUrl } = await generateInvoiceShareLink(id);
      await navigator.clipboard.writeText(shareUrl);
      showToast('Client link copied to clipboard!');
    } catch (err: any) {
      showToast(`Failed to generate link: ${err?.message || 'Error'}`);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  if (loading) {
    return (
      <div className="p-12 text-center text-secondary flex flex-col items-center justify-center space-y-3">
        <FileText className="w-8 h-8 animate-bounce text-secondary" />
        <p className="text-sm">Loading Invoice Builder...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-zinc-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-2 border border-zinc-700 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header & Actions Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/invoices')}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Invoices
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold font-mono text-primary">{invoiceNumber}</h1>
              <StatusBadge status={status} />
            </div>
            <p className="text-xs text-secondary mt-0.5">Split-screen document editor & real-time live preview</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleSaveInvoice('draft')}
            disabled={saving}
            className="gap-1.5"
          >
            <Save className="w-4 h-4" />
            <span>Save Draft</span>
          </Button>

          <Button
            size="sm"
            onClick={() => handleSaveInvoice('pending')}
            disabled={saving}
            className="bg-accent text-white hover:opacity-90 font-medium gap-1.5 shadow-sm"
          >
            <Save className="w-4 h-4" />
            <span>Save as Pending</span>
          </Button>

          {id && id !== 'new' && (
            <Button
              size="sm"
              onClick={handleCopyLink}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium gap-1.5 shadow-sm"
            >
              <Link className="w-4 h-4" />
              <span>Copy Client Link</span>
            </Button>
          )}

          {id && id !== 'new' && ['pending', 'partially_paid', 'overdue'].includes(status) && (
            <Button
              size="sm"
              onClick={handleOpenPaymentModal}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-1.5 shadow-sm"
            >
              <DollarSign className="w-4 h-4" />
              <span>{status === 'partially_paid' ? 'Complete Payment' : 'Record Payment'}</span>
            </Button>
          )}

          {id && id !== 'new' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsDeleteDialogOpen(true)}
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950 gap-1.5"
            >
              <Trash2 className="w-4 h-4" />
              <span>Delete</span>
            </Button>
          )}
        </div>
      </div>

      {/* Main Split-Screen Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT COLUMN: Notion-Style Document Editor */}
        <div className="lg:col-span-7 space-y-6 bg-surface border border-border rounded-xl p-6 shadow-xs">
          
          {/* Document Header Metadata */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-border">
            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider block mb-1">Invoice Number</label>
              <Input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                className="font-mono text-sm font-semibold"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider block mb-1">Select Customer</label>
              <select
                value={customerId}
                onChange={handleCustomerSelect}
                className="w-full h-9 px-3 rounded-md border border-border bg-surface text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="">-- Choose Client --</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider block mb-1">Issue Date</label>
              <Input
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
                className="text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider block mb-1">Payment Due Date</label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          {/* Catalog Quick Inserter Bar */}
          {catalogItems.length > 0 && (
            <div className="p-3 bg-subtle rounded-lg border border-border flex items-center gap-2 overflow-x-auto scrollbar-none">
              <span className="text-xs font-semibold text-secondary shrink-0 flex items-center gap-1">
                <Command className="w-3.5 h-3.5" /> Quick Add Item:
              </span>
              {catalogItems.map(ci => (
                <button
                  key={ci.id}
                  onClick={() => addCatalogItem(ci)}
                  className="px-2.5 py-1 text-xs font-medium bg-surface border border-border hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md shrink-0 flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3 h-3 text-secondary" />
                  <span>{ci.name}</span>
                  <span className="font-mono text-secondary text-[11px]">${ci.unitPrice}</span>
                </button>
              ))}
            </div>
          )}

          {/* Line Items Editor Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-secondary uppercase tracking-wider">
                Line Items ({lineItems.length})
              </h3>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => addLineItem('service')} className="h-7 text-xs gap-1">
                  <Briefcase className="w-3.5 h-3.5 text-blue-500" /> + Service
                </Button>
                <Button size="sm" variant="ghost" onClick={() => addLineItem('product')} className="h-7 text-xs gap-1">
                  <Package className="w-3.5 h-3.5 text-emerald-500" /> + Product
                </Button>
                <Button size="sm" variant="ghost" onClick={() => addLineItem('discount')} className="h-7 text-xs gap-1">
                  <Tag className="w-3.5 h-3.5 text-rose-500" /> + Discount
                </Button>
              </div>
            </div>

            {/* Line Items List */}
            <div className="space-y-3">
              {lineItems.map((item, index) => (
                <div 
                  key={index} 
                  className="p-3.5 border border-border rounded-lg bg-surface space-y-3 relative group hover:border-zinc-400 dark:hover:border-zinc-600 transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] uppercase font-bold px-1.5 py-0.2 rounded ${
                          item.type === 'discount' ? 'bg-rose-100 text-rose-800' : item.type === 'product' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'
                        }`}>
                          {item.type || 'service'}
                        </span>
                        <span className="text-[10px] text-secondary">Tip: Type '/' for commands</span>
                      </div>

                      <Input
                        value={item.description}
                        onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                        placeholder="Description (e.g. Frontend Architecture Development)"
                        className="text-sm font-medium"
                      />
                    </div>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeLineItem(index)}
                      className="h-9 w-9 p-0 text-secondary hover:text-rose-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Quantity, Rate, Tax, Total Inputs */}
                  <div className="grid grid-cols-4 gap-2 pt-2 border-t border-border/50 text-xs">
                    <div>
                      <label className="text-[10px] font-semibold text-secondary uppercase block mb-0.5">Quantity</label>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                        className="text-xs h-8"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-secondary uppercase block mb-0.5">
                        {item.type === 'discount' ? 'Discount Amount ($)' : 'Unit Price ($)'}
                      </label>
                      <Input
                        type="number"
                        step="0.01"
                        value={item.unitPrice}
                        onChange={(e) => handleItemChange(index, 'unitPrice', Number(e.target.value))}
                        className="text-xs h-8 font-mono"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-secondary uppercase block mb-0.5">Tax Rate (%)</label>
                      <Input
                        type="number"
                        step="0.1"
                        value={item.taxRate}
                        onChange={(e) => handleItemChange(index, 'taxRate', Number(e.target.value))}
                        className="text-xs h-8"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-secondary uppercase block mb-0.5 text-right">Line Total</label>
                      <div className="h-8 flex items-center justify-end font-mono font-semibold text-primary">
                        ${item.amount.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => addLineItem('service')}
              className="w-full border-dashed border-border text-secondary hover:text-primary hover:border-zinc-400 gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Add Line Item</span>
            </Button>
          </div>

          {/* Notes & Terms Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-border">
            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider block mb-1">Invoice Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full p-2.5 rounded-md border border-border bg-surface text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Notes visible to client..."
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider block mb-1">Payment Terms</label>
              <textarea
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                rows={2}
                className="w-full p-2.5 rounded-md border border-border bg-surface text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Payment terms..."
              />
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Sticky Live PDF Preview */}
        <div className="lg:col-span-5 lg:sticky lg:top-6 space-y-4">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-secondary flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-emerald-500" /> Sticky Live PDF Preview
            </span>
            <span className="text-[11px] font-mono text-secondary">Real-time render</span>
          </div>

          {/* Rendered PDF Document Canvas */}
          <div className="bg-white text-zinc-900 border border-zinc-200 rounded-xl shadow-md p-6 space-y-6 font-sans text-xs min-h-[520px] relative overflow-hidden">
            
            {/* Status Stamp Overlay */}
            <div className="absolute top-4 right-4 rotate-12 opacity-85 pointer-events-none">
              <StatusBadge status={status} size="lg" />
            </div>

            {/* Document Header */}
            <div className="border-b border-zinc-200 pb-4">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900 uppercase">INVOICE</h2>
              <p className="font-mono text-zinc-600 mt-1 font-semibold">{invoiceNumber}</p>
            </div>

            {/* Bill To & Metadata Grid */}
            <div className="grid grid-cols-2 gap-4 text-zinc-600">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">Billed To</span>
                <p className="font-bold text-zinc-900 text-sm">{customerName || 'Select Customer'}</p>
              </div>

              <div className="text-right space-y-1">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Issue Date</span>
                  <span className="font-medium text-zinc-800">{issueDate}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Due Date</span>
                  <span className="font-medium text-zinc-800">{dueDate}</span>
                </div>
              </div>
            </div>

            {/* Itemized Table */}
            <div className="border border-zinc-200 rounded overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-zinc-50 border-b border-zinc-200 font-semibold text-zinc-600 text-[11px]">
                  <tr>
                    <th className="p-2">Description</th>
                    <th className="p-2 text-center">Qty</th>
                    <th className="p-2 text-right">Price</th>
                    <th className="p-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 text-zinc-800">
                  {lineItems.map((item, idx) => (
                    <tr key={idx}>
                      <td className="p-2 font-medium">{item.description || 'Line Item'}</td>
                      <td className="p-2 text-center font-mono">{item.quantity}</td>
                      <td className="p-2 text-right font-mono">${item.unitPrice.toFixed(2)}</td>
                      <td className="p-2 text-right font-mono font-semibold">${item.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Summary Totals Block */}
            <div className="flex justify-end pt-2 border-t border-zinc-200">
              <div className="w-56 space-y-1.5 text-zinc-700">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="font-mono font-medium">${subtotal.toFixed(2)}</span>
                </div>

                {discountTotal > 0 && (
                  <div className="flex justify-between text-emerald-700">
                    <span>Discount</span>
                    <span className="font-mono">-${discountTotal.toFixed(2)}</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span>Tax</span>
                  <span className="font-mono font-medium">${taxTotal.toFixed(2)}</span>
                </div>

                <div className="flex justify-between font-bold text-sm text-zinc-900 pt-2 border-t border-zinc-200">
                  <span>Total Amount</span>
                  <span className="font-mono">${total.toFixed(2)}</span>
                </div>
                
                {balanceDue !== undefined && balanceDue !== total && (
                  <div className="flex justify-between font-bold text-sm text-amber-600 pt-2 border-t border-zinc-200 mt-1">
                    <span>Balance Due</span>
                    <span className="font-mono">${balanceDue.toFixed(2)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Payment History */}
            {id && id !== 'new' && payments.length > 0 && (
              <div className="pt-6">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-secondary mb-3">Payment History</h4>
                <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                  {payments.map((payment: any, idx: number) => (
                    <div key={idx} className="p-3 text-sm flex items-start justify-between bg-surface">
                      <div>
                        <p className="font-medium text-primary">
                          Payment Received <span className="text-xs font-normal text-secondary ml-1">via {payment.method}</span>
                        </p>
                        <p className="text-xs text-secondary mt-0.5">
                          {new Date(payment.date).toLocaleDateString()}
                        </p>
                        {payment.notes && <p className="text-xs text-secondary mt-1 italic">{payment.notes}</p>}
                      </div>
                      <span className="font-mono font-medium text-emerald-600">+${payment.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes & Terms */}
            {notes && (
              <div className="pt-4 border-t border-zinc-200 text-zinc-500">
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">Notes</span>
                <p className="italic">{notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Trash2 className="w-5 h-5" />
              <DialogTitle>Permanently Delete Invoice?</DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-xs leading-relaxed text-secondary">
              Are you sure you want to delete <strong className="text-primary">Invoice #{invoiceNumber}</strong>?
              <span className="block mt-2 p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 rounded-lg text-rose-900 dark:text-rose-200 font-medium">
                ⚠️ Irreversible Action: This permanently deletes the invoice document from Firestore along with its invoiceRevisions, its invoiceShareLinks document, and any related storage files.
              </span>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setIsDeleteDialogOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button 
              size="sm" 
              onClick={handleConfirmDelete} 
              disabled={isDeleting}
              className="bg-rose-600 hover:bg-rose-700 text-white font-medium gap-1.5 shadow-sm"
            >
              {isDeleting ? 'Deleting...' : 'Delete Permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark as Paid Dialog */}
      <Dialog open={isPaymentDialogOpen} onOpenChange={setIsPaymentDialogOpen}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleConfirmPayment}>
            <DialogHeader>
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <DollarSign className="w-5 h-5" />
                <DialogTitle>Mark Invoice #{invoiceNumber} as Paid</DialogTitle>
              </div>
              <DialogDescription className="text-xs text-secondary">
                Record a payment received for this invoice.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4 text-xs">
              <div>
                <label className="block font-semibold text-secondary uppercase tracking-wider mb-1">
                  Payment Amount ($)
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="font-mono text-sm font-bold"
                  required
                />
                <p className="text-[11px] text-secondary mt-1">
                  Partial payments reduce balance; status becomes 'paid' when balance reaches $0.00.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-secondary uppercase tracking-wider mb-1">
                  Payment Date
                </label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-secondary uppercase tracking-wider mb-1">
                  Payment Method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-border bg-surface text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                >
                  <option value="Bank Transfer">Bank Transfer / Wire</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Check">Check</option>
                  <option value="Cash">Cash</option>
                  <option value="Stripe">Stripe / Online</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-secondary uppercase tracking-wider mb-1">
                  Payment Notes / Reference (Optional)
                </label>
                <Input
                  placeholder="e.g., Wire ref #987654 or Check #1042"
                  value={paymentNotes}
                  onChange={(e) => setPaymentNotes(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="ghost" size="sm" onClick={() => setIsPaymentDialogOpen(false)} disabled={isRecordingPayment}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                size="sm" 
                disabled={isRecordingPayment}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-1.5 shadow-sm"
              >
                <DollarSign className="w-4 h-4" />
                {isRecordingPayment ? 'Recording...' : 'Record Payment'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
