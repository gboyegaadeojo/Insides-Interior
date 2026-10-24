import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { 
  Quote, 
  InvoiceLineItem, 
  Customer, 
  Item, 
  QuoteRevision, 
  QuoteStatus 
} from '../../../types';
import { 
  getQuoteById, 
  saveQuote, 
  deleteQuote, 
  sendQuoteForApproval, 
  getQuoteRevisions, 
  convertQuoteToInvoice,
  generateQuoteShareToken 
} from '../../../lib/quote-service';
import { getCustomers } from '../../../lib/invoice-service';
import { getItems } from '../../../lib/item-service';
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
  Sparkles, 
  History, 
  FileText, 
  AlertCircle,
  ArrowRightCircle,
  Copy,
  ExternalLink,
  Briefcase,
  Package,
  Tag,
  Command,
  Eye
} from 'lucide-react';

export function QuoteBuilder() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const userId = user?.uid || 'demo_user';

  // Core Quote Form State
  const [quoteId, setQuoteId] = useState<string>(id || `quote_${Date.now()}`);
  const [quoteNumber, setQuoteNumber] = useState<string>(`QT-2026-0${Math.floor(10 + Math.random() * 90)}`);
  const [customerId, setCustomerId] = useState<string>('');
  const [customerName, setCustomerName] = useState<string>('');
  const [issueDate, setIssueDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [expiryDate, setExpiryDate] = useState<string>(new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0]);
  const [status, setStatus] = useState<QuoteStatus>('draft');
  const [shareToken, setShareToken] = useState<string>('');
  const [version, setVersion] = useState<number>(1);
  const [notes, setNotes] = useState<string>('Quote valid for 30 days. Please review and click Approve or Request Changes.');
  const [terms, setTerms] = useState<string>('50% deposit upon acceptance. Balance due upon completion.');

  const [lineItems, setLineItems] = useState<InvoiceLineItem[]>([
    {
      itemId: null,
      description: 'System Architecture & Consulting',
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
  const [revisions, setRevisions] = useState<QuoteRevision[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [converting, setConverting] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Revisions Drawer Toggle
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);

  // Delete Dialog state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!id || id === 'new') return;
    setIsDeleting(true);
    try {
      await deleteQuote(id, shareToken);
      showToast(`Quote #${quoteNumber} permanently deleted.`);
      navigate('/quotes', { replace: true });
    } catch (err: any) {
      showToast(`Failed to delete quote: ${err?.message || 'Error'}`);
      setIsDeleting(false);
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
        const existing = await getQuoteById(id);
        if (existing) {
          setQuoteId(existing.id);
          setQuoteNumber(existing.quoteNumber);
          setCustomerId(existing.customerId);
          setCustomerName(existing.customerName);
          setIssueDate(existing.issueDate);
          setExpiryDate(existing.expiryDate || '');
          setStatus(existing.status);
          setShareToken(existing.shareToken);
          setVersion(existing.version);

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

          const dbRevs = await getQuoteRevisions(existing.id, existing.shareToken);
          const combinedRevs = [...dbRevs];
          
          if (existing.publicRevisions && Array.isArray(existing.publicRevisions)) {
            existing.publicRevisions.forEach((pr) => {
              if (!combinedRevs.some(r => r.id === pr.id)) {
                combinedRevs.push(pr);
              }
            });
          }
          
          combinedRevs.sort((a, b) => b.version - a.version);
          setRevisions(combinedRevs);
        }
      } else {
        setShareToken(generateQuoteShareToken());
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

  // Line Item Handlers
  const handleItemChange = (index: number, field: keyof InvoiceLineItem, val: any) => {
    setLineItems(prev => {
      const updated = [...prev];
      const target = { ...updated[index], [field]: val };

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

  const addLineItem = (type: 'service' | 'product' | 'discount' = 'service') => {
    setLineItems(prev => [
      ...prev,
      {
        itemId: null,
        description: type === 'discount' ? 'Special Client Discount' : type === 'product' ? 'Hardware Item' : 'Consulting Service',
        quantity: 1,
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

  const handleCustomerSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    setCustomerId(selectedId);
    const found = customers.find(c => c.id === selectedId);
    if (found) {
      setCustomerName(found.name);
    }
  };

  // Actions
  const handleSaveQuote = async (newStatus: QuoteStatus = status): Promise<Quote | null> => {
    setSaving(true);
    try {
      const activeShareToken = shareToken || generateQuoteShareToken();
      if (!shareToken) setShareToken(activeShareToken);

      const saved = await saveQuote({
        id: id && id !== 'new' ? id : quoteId,
        userId,
        customerId,
        customerName: customerName || 'Unassigned Customer',
        quoteNumber,
        issueDate,
        expiryDate,
        status: newStatus,
        shareToken: activeShareToken,
        version,
        lineItems,
        subtotal,
        taxTotal,
        discountTotal,
        total,
        notes,
        terms,
      });

      setStatus(saved.status);
      setVersion(saved.version);
      setShareToken(saved.shareToken);
      
      const revs = await getQuoteRevisions(saved.id, saved.shareToken);
      setRevisions(revs);

      if (id === 'new') {
        navigate(`/quotes/${saved.id}/edit`, { replace: true });
      }

      showToast('Quote saved successfully.');
      return saved;
    } catch (err: any) {
      console.error('Error saving quote:', err);
      showToast(`Error saving quote: ${err?.message || 'Unknown error'}`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleSendForApproval = async () => {
    setSaving(true);
    try {
      const savedQuote = await handleSaveQuote('sent_for_approval');
      if (!savedQuote) return;

      const res = await sendQuoteForApproval(savedQuote);
      setStatus(res.quote.status);
      setShareToken(res.quote.shareToken);

      try {
        await navigator.clipboard.writeText(res.shareUrl);
        showToast('Quote sent for approval! Link copied to clipboard.');
      } catch (err) {
        showToast(`Quote sent for approval! Public link: ${res.shareUrl}`);
      }

      const dbRevs = await getQuoteRevisions(res.quote.id, res.quote.shareToken);
      const combinedRevs = [...dbRevs];
      
      if (res.quote.publicRevisions && Array.isArray(res.quote.publicRevisions)) {
        res.quote.publicRevisions.forEach((pr) => {
          if (!combinedRevs.some(r => r.id === pr.id)) {
            combinedRevs.push(pr);
          }
        });
      }
      
      combinedRevs.sort((a, b) => b.version - a.version);
      setRevisions(combinedRevs);
    } catch (err: any) {
      showToast(`Failed to send quote for approval: ${err?.message || 'Error'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleConvertToInvoice = async () => {
    if (!id || id === 'new') return;
    setConverting(true);
    try {
      const invoice = await convertQuoteToInvoice(id);
      showToast(`Quote #${quoteNumber} converted to Invoice #${invoice.invoiceNumber}! Redirecting...`);
      setTimeout(() => {
        navigate(`/invoices/${invoice.id}/edit`);
      }, 1000);
    } catch (err: any) {
      showToast(`Failed to convert quote: ${err?.message || 'Error'}`);
      setConverting(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const latestClientRevision = revisions.find(r => r.createdBy === 'client' && r.clientComment);

  if (loading) {
    return (
      <div className="p-12 text-center text-secondary flex flex-col items-center justify-center space-y-3">
        <FileText className="w-8 h-8 animate-bounce text-secondary" />
        <p className="text-sm">Loading Quote Builder...</p>
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
          <Button variant="ghost" size="sm" onClick={() => navigate('/quotes')}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Quotes
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold font-mono text-primary">{quoteNumber}</h1>
              <span className="text-xs font-mono bg-subtle text-secondary px-2 py-0.5 rounded border border-border">v{version}</span>
              <StatusBadge status={status} />
            </div>
            <p className="text-xs text-secondary mt-0.5">Quote Builder with approval revision loop & invoice conversion</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsHistoryDrawerOpen(true)}
            className="gap-1.5"
          >
            <History className="w-4 h-4 text-secondary" />
            <span>Revisions ({revisions.length})</span>
          </Button>

          {shareToken && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`/q/${shareToken}`, '_blank')}
              className="gap-1.5 text-xs"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Client View</span>
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleSaveQuote('draft')}
            disabled={saving}
            className="gap-1.5"
          >
            <Save className="w-4 h-4" />
            <span>Save Draft</span>
          </Button>

          <Button
            size="sm"
            onClick={handleSendForApproval}
            disabled={saving}
            className="bg-accent text-white hover:opacity-90 font-medium gap-1.5 shadow-sm"
          >
            <Send className="w-4 h-4" />
            <span>Send for Approval</span>
          </Button>

          {id && id !== 'new' && (status === 'approved' || status === 'converted') && (
            <Button
              size="sm"
              onClick={handleConvertToInvoice}
              disabled={converting}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium gap-1.5 shadow-sm"
            >
              <ArrowRightCircle className="w-4 h-4" />
              <span>{converting ? 'Converting...' : 'Convert to Invoice'}</span>
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

      {/* Client Feedback Banner */}
      {status === 'changes_requested' && latestClientRevision && (
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800 flex items-start gap-3 shadow-xs">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-semibold text-sm">Client Requested Changes (Feedback for Version {latestClientRevision.version})</h4>
            <p className="text-xs italic bg-white/70 dark:bg-black/30 p-2.5 rounded border border-rose-200 dark:border-rose-800 font-serif">
              "{latestClientRevision.clientComment}"
            </p>
            <p className="text-[11px] text-rose-700 dark:text-rose-300">
              Update quote details and click <strong>Send for Approval</strong> to increment version and update public view.
            </p>
          </div>
        </div>
      )}

      {/* Main Form & Preview Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT COLUMN: Editor Form */}
        <div className="lg:col-span-7 space-y-6 bg-surface border border-border rounded-xl p-6 shadow-xs">
          
          {/* Metadata Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4 border-b border-border">
            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider block mb-1">Quote Number</label>
              <Input
                value={quoteNumber}
                onChange={(e) => setQuoteNumber(e.target.value)}
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
                {customers.map((c) => (
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
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider block mb-1">Expiry Date</label>
              <Input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
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
                  type="button"
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
                      </div>

                      <Input
                        value={item.description}
                        onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                        placeholder="Description (e.g. System Architecture Design)"
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
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider block mb-1">Quote Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full p-2.5 rounded-md border border-border bg-surface text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Notes visible to client..."
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider block mb-1">Terms & Conditions</label>
              <textarea
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                rows={2}
                className="w-full p-2.5 rounded-md border border-border bg-surface text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="Terms & conditions..."
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
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold tracking-tight text-zinc-900 uppercase">QUOTE</h2>
                <span className="text-xs font-mono font-semibold text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded">v{version}</span>
              </div>
              <p className="font-mono text-zinc-600 mt-1 font-semibold">{quoteNumber}</p>
            </div>

            {/* Bill To & Metadata Grid */}
            <div className="grid grid-cols-2 gap-4 text-zinc-600">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-0.5">Prepared For</span>
                <p className="font-bold text-zinc-900 text-sm">{customerName || 'Select Customer'}</p>
              </div>

              <div className="text-right space-y-1">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Issue Date</span>
                  <span className="font-medium text-zinc-800">{issueDate}</span>
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">Expiry Date</span>
                  <span className="font-medium text-zinc-800">{expiryDate}</span>
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
                  <span>Total Quote</span>
                  <span className="font-mono">${total.toFixed(2)}</span>
                </div>
              </div>
            </div>

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

      {/* Revisions History Drawer */}
      <Drawer open={isHistoryDrawerOpen} onOpenChange={setIsHistoryDrawerOpen}>
        <DrawerContent className="max-w-xl mx-auto p-6 space-y-4">
          <DrawerHeader className="p-0">
            <DrawerTitle className="text-lg font-bold flex items-center gap-2">
              <History className="w-5 h-5 text-accent" />
              <span>Quote Revisions Log ({revisions.length})</span>
            </DrawerTitle>
            <DrawerDescription className="text-xs text-secondary">
              History of owner revisions and client feedback snapshots for Quote #{quoteNumber}.
            </DrawerDescription>
          </DrawerHeader>

          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
            {revisions.length === 0 ? (
              <p className="text-xs text-secondary italic text-center py-6">No previous revision snapshots recorded yet.</p>
            ) : (
              revisions.map((rev) => (
                <div key={rev.id} className="p-4 rounded-xl border border-border bg-subtle space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold text-primary">Version {rev.version}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${rev.createdBy === 'client' ? 'bg-rose-100 text-rose-800' : 'bg-blue-100 text-blue-800'}`}>
                        {rev.createdBy === 'client' ? 'Client Feedback' : 'Owner Revision'}
                      </span>
                      {rev.createdAt && (
                        <span className="text-[10px] text-secondary font-mono">
                          {typeof rev.createdAt === 'object' && rev.createdAt.seconds 
                            ? new Date(rev.createdAt.seconds * 1000).toLocaleString()
                            : new Date(rev.createdAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <span className="text-xs font-mono font-bold text-emerald-600">${rev.total.toFixed(2)}</span>
                  </div>

                  {rev.clientComment && (
                    <div className="p-2.5 rounded bg-surface border border-border text-xs italic font-serif">
                      "{rev.clientComment}"
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Irreversible Delete Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-rose-600 flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              <span>Delete Quote #{quoteNumber}?</span>
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-xs text-secondary pt-2">
                This operation is <strong>irreversible</strong>. Deleting this quote will permanently remove:
                <ul className="list-disc list-inside mt-2 space-y-1 font-mono text-[11px] text-primary">
                  <li>Main Quote Record (#{quoteNumber})</li>
                  <li>Public Client Share Link (/q/{shareToken})</li>
                  <li>All Revision Snapshots & Client Feedback ({revisions.length})</li>
                </ul>
              </div>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button variant="ghost" size="sm" onClick={() => setIsDeleteDialogOpen(false)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
              className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
            >
              {isDeleting ? 'Deleting...' : 'Permanently Delete Quote'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
