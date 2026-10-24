import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Invoice, InvoiceStatus } from '../../../types';
import { 
  getInvoices, 
  saveInvoice, 
  deleteInvoice,
  recordPayment,
  createNotification, 
  logActivity,
  generateInvoiceShareLink,
  getInvoicePayments
} from '../../../lib/invoice-service';
import { useAuth } from '../../../hooks/use-auth';
import { StatusBadge } from '../../../components/shared/status-badge';
import { 
  Table, 
  TableHeader, 
  TableBody, 
  TableHead, 
  TableRow, 
  TableCell, 
  TableRowActions 
} from '../../../components/ui/table';
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
  Search, 
  Eye, 
  Edit3, 
  FileText, 
  Sparkles,
  Trash2,
  DollarSign,
  Link
} from 'lucide-react';

export function InvoiceList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>(searchParams.get('status') || 'all');
  
  // Drawer state for Quick View
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedInvoicePayments, setSelectedInvoicePayments] = useState<any[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Delete confirmation dialog state
  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Payment modal state
  const [invoiceToPay, setInvoiceToPay] = useState<Invoice | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [paymentMethod, setPaymentMethod] = useState<string>('Bank Transfer');
  const [paymentNotes, setPaymentNotes] = useState<string>('');
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  const userId = user?.uid || 'demo_user';

  const loadData = async () => {
    setLoading(true);
    const data = await getInvoices(userId);
    setInvoices(data);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [userId]);

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    if (status === 'all') {
      searchParams.delete('status');
    } else {
      searchParams.set('status', status);
    }
    setSearchParams(searchParams);
  };

  // Filtered invoices
  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch = 
      invoice.invoiceNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      invoice.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (invoice.notes && invoice.notes.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;
    if (selectedStatus === 'all') return true;
    return invoice.status === selectedStatus;
  });

  // Open Quick View Drawer
  const handleOpenDrawer = async (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    const payments = await getInvoicePayments(invoice.id);
    setSelectedInvoicePayments(payments);
    setIsDrawerOpen(true);
  };

  // Open Delete Modal
  const handleOpenDeleteDialog = (invoice: Invoice, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setInvoiceToDelete(invoice);
  };

  // Confirm Delete
  const handleConfirmDelete = async () => {
    if (!invoiceToDelete) return;
    setIsDeleting(true);
    try {
      await deleteInvoice(invoiceToDelete.id);
      showToast(`Invoice #${invoiceToDelete.invoiceNumber} permanently deleted.`);
      setInvoiceToDelete(null);
      if (selectedInvoice?.id === invoiceToDelete.id) {
        setIsDrawerOpen(false);
        setSelectedInvoice(null);
      }
      await loadData();
    } catch (err: any) {
      console.error('Delete invoice failed:', err);
      showToast(`Failed to delete invoice: ${err?.message || 'Error occurred'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Open Payment Modal
  const handleOpenPaymentDialog = (invoice: Invoice, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setInvoiceToPay(invoice);
    const balance = invoice.balanceDue !== undefined && invoice.balanceDue !== null ? invoice.balanceDue : invoice.total;
    setPaymentAmount(String(balance));
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setPaymentMethod('Bank Transfer');
    setPaymentNotes('');
  };

  // Confirm Payment
  const handleConfirmPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceToPay) return;
    const amountNum = parseFloat(paymentAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('Please enter a valid payment amount greater than zero.');
      return;
    }
    setIsRecordingPayment(true);
    try {
      await recordPayment({
        invoiceId: invoiceToPay.id,
        customerId: invoiceToPay.customerId,
        userId: userId,
        amount: amountNum,
        date: paymentDate,
        method: paymentMethod,
        notes: paymentNotes || null,
      });
      showToast(`Recorded payment of $${amountNum.toFixed(2)} for Invoice #${invoiceToPay.invoiceNumber}.`);
      setInvoiceToPay(null);
      if (selectedInvoice?.id === invoiceToPay.id) {
        const updated = (await getInvoices(userId)).find(i => i.id === invoiceToPay.id);
        if (updated) {
          setSelectedInvoice(updated);
          const payments = await getInvoicePayments(updated.id);
          setSelectedInvoicePayments(payments);
        }
      }
      await loadData();
    } catch (err: any) {
      console.error('Record payment failed:', err);
      showToast(`Failed to record payment: ${err?.message || 'Error occurred'}`);
    } finally {
      setIsRecordingPayment(false);
    }
  };

  const handleCopyLink = async (invoice: Invoice, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const { shareUrl } = await generateInvoiceShareLink(invoice.id);
      await navigator.clipboard.writeText(shareUrl);
      showToast('Client link copied to clipboard!');
      // Reload data to reflect potentially new shareToken locally if it was missing
      if (!invoice.shareToken) {
        await loadData();
      }
    } catch (err: any) {
      showToast(`Failed to generate link: ${err?.message || 'Error'}`);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Tabs list
  const tabs = [
    { id: 'all', label: 'All Invoices' },
    { id: 'draft', label: 'Drafts' },
    { id: 'pending', label: 'Pending Payment' },
    { id: 'partially_paid', label: 'Partial Payment' },
    { id: 'paid', label: 'Paid' },
    { id: 'overdue', label: 'Overdue' },
  ];

  // Calculated KPI stats
  const totalInvoiced = invoices.reduce((sum, i) => sum + i.total, 0);
  const outstandingAmount = invoices
    .filter(i => ['pending', 'overdue'].includes(i.status))
    .reduce((sum, i) => sum + (i.balanceDue !== undefined ? i.balanceDue : i.total), 0);
  const needsAttentionCount = invoices.filter(i => i.status === 'overdue').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-zinc-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-2 border border-zinc-700 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">Invoices</h1>
          <p className="text-sm text-secondary mt-1">
            Manage billing, client approval flows, share public links, and track payment lifecycles.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button 
            onClick={() => navigate('/invoices/new')} 
            className="bg-accent text-white hover:opacity-90 font-medium shadow-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            <span>Create Invoice</span>
          </Button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl border border-border bg-surface shadow-xs">
          <span className="text-xs font-medium text-secondary uppercase tracking-wider">Total Revenue Tracked</span>
          <div className="text-2xl font-semibold text-primary mt-1">
            ${totalInvoiced.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-secondary mt-1">{invoices.length} total invoice documents</div>
        </div>

        <div className="p-4 rounded-xl border border-border bg-surface shadow-xs">
          <span className="text-xs font-medium text-secondary uppercase tracking-wider">Outstanding Balance</span>
          <div className="text-2xl font-semibold text-amber-600 dark:text-amber-400 mt-1">
            ${outstandingAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-secondary mt-1">Awaiting approval or client payment</div>
        </div>

        <div className="p-4 rounded-xl border border-border bg-surface shadow-xs">
          <span className="text-xs font-medium text-secondary uppercase tracking-wider">Review & Approval Queue</span>
          <div className="text-2xl font-semibold text-primary mt-1 flex items-center gap-2">
            <span>{needsAttentionCount}</span>
            {needsAttentionCount > 0 && (
              <span className="text-xs bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 px-2 py-0.5 rounded-full font-medium">
                Action Required
              </span>
            )}
          </div>
          <div className="text-xs text-secondary mt-1">Invoices in client approval loop</div>
        </div>
      </div>

      {/* Filter Tabs & Search Controls */}
      <div className="space-y-4">
        {/* Status Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-2 border-b border-border scrollbar-none">
          {tabs.map(tab => {
            const count = tab.id === 'all' 
              ? invoices.length 
              : invoices.filter(i => i.status === tab.id).length;

            const isActive = selectedStatus === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => handleStatusChange(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all flex items-center gap-2 ${
                  isActive 
                    ? 'bg-zinc-900 text-white shadow-xs dark:bg-zinc-100 dark:text-zinc-900' 
                    : 'text-secondary hover:text-primary hover:bg-subtle'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`px-1.5 py-0.2 text-[10px] rounded-full ${
                  isActive ? 'bg-zinc-700 text-zinc-100 dark:bg-zinc-300 dark:text-zinc-900' : 'bg-subtle text-secondary'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Input Bar */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-secondary" />
            <Input
              type="text"
              placeholder="Filter by invoice #, customer name, or notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 text-sm"
            />
          </div>
          {searchQuery && (
            <Button variant="ghost" size="sm" onClick={() => setSearchQuery('')}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {/* Main Table Data Grid */}
      <div className="border border-border rounded-xl bg-surface overflow-hidden shadow-xs">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Issue Date</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead className="text-right">Total Amount</TableHead>
              <TableHead className="text-right pr-6">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              // Skeleton Loader Rows
              Array.from({ length: 4 }).map((_, idx) => (
                <TableRow key={idx}>
                  <TableCell><div className="h-4 w-24 bg-subtle animate-pulse rounded" /></TableCell>
                  <TableCell><div className="h-4 w-32 bg-subtle animate-pulse rounded" /></TableCell>
                  <TableCell><div className="h-5 w-28 bg-subtle animate-pulse rounded-full" /></TableCell>
                  <TableCell><div className="h-4 w-20 bg-subtle animate-pulse rounded" /></TableCell>
                  <TableCell><div className="h-4 w-20 bg-subtle animate-pulse rounded" /></TableCell>
                  <TableCell><div className="h-4 w-16 bg-subtle animate-pulse rounded ml-auto" /></TableCell>
                  <TableCell><div className="h-4 w-12 bg-subtle animate-pulse rounded ml-auto" /></TableCell>
                </TableRow>
              ))
            ) : filteredInvoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-48 text-center">
                  <div className="flex flex-col items-center justify-center space-y-2 py-8">
                    <FileText className="w-10 h-10 text-secondary stroke-1" />
                    <p className="text-sm font-medium text-primary">No invoices found</p>
                    <p className="text-xs text-secondary max-w-xs">
                      {searchQuery || selectedStatus !== 'all' 
                        ? 'Try clearing search filters or selecting a different status tab.'
                        : 'Create your first invoice to begin tracking billing and client approval workflows.'}
                    </p>
                    {(!searchQuery && selectedStatus === 'all') && (
                      <Button onClick={() => navigate('/invoices/new')} size="sm" className="mt-2">
                        <Plus className="w-3.5 h-3.5 mr-1.5" />
                        New Invoice
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredInvoices.map((invoice) => (
                <TableRow 
                  key={invoice.id} 
                  onClick={() => handleOpenDrawer(invoice)}
                  className="cursor-pointer group"
                >
                  <TableCell className="font-semibold text-primary">
                    <div className="flex items-center gap-2">
                      <span>{invoice.invoiceNumber}</span>
                      {invoice.version > 1 && (
                        <span className="text-[10px] font-mono bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 px-1.5 py-0.5 rounded">
                          v{invoice.version}
                        </span>
                      )}
                    </div>
                  </TableCell>

                  <TableCell className="font-medium text-primary">
                    {invoice.customerName}
                  </TableCell>

                  <TableCell>
                    <StatusBadge status={invoice.status} />
                  </TableCell>

                  <TableCell className="text-secondary text-xs">
                    {invoice.issueDate}
                  </TableCell>

                  <TableCell className="text-secondary text-xs">
                    {invoice.dueDate}
                  </TableCell>

                  <TableCell className="text-right">
                    <div className="font-mono font-semibold text-primary">
                      ${invoice.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} total
                    </div>
                    {invoice.balanceDue !== undefined && invoice.balanceDue !== invoice.total && (
                      <div className="text-xs text-secondary mt-0.5 font-medium">
                        ${invoice.balanceDue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} due
                      </div>
                    )}
                  </TableCell>

                  <TableCell className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
                    <TableRowActions>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Edit Invoice"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/invoices/${invoice.id}/edit`);
                        }}
                        className="h-8 w-8 p-0"
                      >
                        <Edit3 className="w-4 h-4 text-secondary hover:text-primary" />
                      </Button>

                      {['draft', 'pending', 'partially_paid', 'overdue'].includes(invoice.status) && (
                        <Button
                          size="sm"
                          variant="secondary"
                          title="Record Payment"
                          onClick={(e) => handleOpenPaymentDialog(invoice, e)}
                          className="text-xs h-7 px-2.5 bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-200"
                        >
                          <DollarSign className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                          {invoice.status === 'partially_paid' ? 'Complete Payment' : 'Mark Paid'}
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="ghost"
                        title="Delete Invoice"
                        onClick={(e) => handleOpenDeleteDialog(invoice, e)}
                        className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Copy Client Link"
                        onClick={(e) => handleCopyLink(invoice, e)}
                        className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950"
                      >
                        <Link className="w-4 h-4" />
                      </Button>
                    </TableRowActions>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Slide-over Quick View Drawer */}
      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DrawerContent className="max-w-xl">
          {selectedInvoice && (
            <div className="space-y-6">
              <DrawerHeader className="p-0 border-b border-border pb-4">
                <div className="flex items-center justify-between">
                  <DrawerTitle className="text-xl font-bold font-mono">{selectedInvoice.invoiceNumber}</DrawerTitle>
                  <StatusBadge status={selectedInvoice.status} size="lg" />
                </div>
                <DrawerDescription className="mt-1">
                  Customer: <strong className="text-primary">{selectedInvoice.customerName}</strong>
                </DrawerDescription>
              </DrawerHeader>

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center gap-2 p-3 bg-subtle rounded-lg border border-border">
                <Button 
                  size="sm" 
                  onClick={() => navigate(`/invoices/${selectedInvoice.id}/edit`)}
                  className="gap-1.5"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  Edit Invoice
                </Button>

                {['draft', 'pending', 'partially_paid', 'overdue'].includes(selectedInvoice.status) && (
                  <Button 
                    size="sm" 
                    onClick={(e) => handleOpenPaymentDialog(selectedInvoice, e)}
                    className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                  >
                    <DollarSign className="w-3.5 h-3.5" />
                    {selectedInvoice.status === 'partially_paid' ? 'Complete Payment' : 'Record Payment'}
                  </Button>
                )}

                <Button 
                  size="sm" 
                  onClick={(e) => handleCopyLink(selectedInvoice, e)}
                  className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white font-medium"
                >
                  <Link className="w-3.5 h-3.5" />
                  Copy Client Link
                </Button>

                <Button 
                  size="sm" 
                  variant="ghost"
                  onClick={(e) => handleOpenDeleteDialog(selectedInvoice, e)}
                  className="gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950 ml-auto"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Invoice
                </Button>
              </div>

              {/* Financial Breakdown */}
              <div className="space-y-3 p-4 border border-border rounded-lg bg-surface">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-secondary">Summary Breakdown</h4>
                
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between text-secondary">
                    <span>Subtotal</span>
                    <span className="font-mono text-primary">${selectedInvoice.subtotal.toFixed(2)}</span>
                  </div>

                  {selectedInvoice.discountTotal > 0 && (
                    <div className="flex justify-between text-emerald-600">
                      <span>Discount</span>
                      <span className="font-mono">-${selectedInvoice.discountTotal.toFixed(2)}</span>
                    </div>
                  )}

                  <div className="flex justify-between text-secondary">
                    <span>Estimated Tax</span>
                    <span className="font-mono text-primary">${selectedInvoice.taxTotal.toFixed(2)}</span>
                  </div>

                  <div className="flex justify-between font-bold text-base text-primary pt-2 border-t border-border">
                    <span>Total Amount</span>
                    <span className="font-mono">${selectedInvoice.total.toFixed(2)}</span>
                  </div>

                  {selectedInvoice.balanceDue !== undefined && selectedInvoice.balanceDue !== selectedInvoice.total && (
                    <div className="flex justify-between font-bold text-base text-primary pt-2 border-t border-border mt-1">
                      <span>Balance Due</span>
                      <span className="font-mono text-amber-600">${selectedInvoice.balanceDue.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Payment History */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-secondary">Payment History</h4>
                {selectedInvoicePayments.length > 0 ? (
                  <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                    {selectedInvoicePayments.map((payment: any, idx: number) => (
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
                ) : (
                  <div className="p-4 border border-border rounded-lg bg-surface text-center text-sm text-secondary">
                    No payments recorded yet.
                  </div>
                )}
              </div>

              {/* Line Items List */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-secondary">Line Items ({selectedInvoice.lineItems.length})</h4>
                <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                  {selectedInvoice.lineItems.map((item, idx) => (
                    <div key={idx} className="p-3 text-sm flex items-start justify-between bg-surface">
                      <div>
                        <p className="font-medium text-primary">{item.description}</p>
                        <p className="text-xs text-secondary mt-0.5">
                          Qty: {item.quantity} × ${item.unitPrice.toFixed(2)} {item.taxRate > 0 && `(+${item.taxRate}% tax)`}
                        </p>
                      </div>
                      <span className="font-mono font-medium text-primary">${item.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!invoiceToDelete} onOpenChange={(open) => !open && setInvoiceToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Trash2 className="w-5 h-5" />
              <DialogTitle>Permanently Delete Invoice?</DialogTitle>
            </div>
            <DialogDescription className="pt-2 text-xs leading-relaxed text-secondary">
              Are you sure you want to delete <strong className="text-primary">Invoice #{invoiceToDelete?.invoiceNumber}</strong>?
              <span className="block mt-2 p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 rounded-lg text-rose-900 dark:text-rose-200 font-medium">
                ⚠️ Irreversible Action: This permanently deletes the invoice document from Firestore along with any associated payment records.
              </span>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setInvoiceToDelete(null)} disabled={isDeleting}>
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
      <Dialog open={!!invoiceToPay} onOpenChange={(open) => !open && setInvoiceToPay(null)}>
        <DialogContent className="max-w-md">
          <form onSubmit={handleConfirmPayment}>
            <DialogHeader>
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <DollarSign className="w-5 h-5" />
                <DialogTitle>Mark Invoice #{invoiceToPay?.invoiceNumber} as Paid</DialogTitle>
              </div>
              <DialogDescription className="text-xs text-secondary">
                Record a payment received from <strong className="text-primary">{invoiceToPay?.customerName}</strong>.
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
                  Current balance due: <strong className="font-mono text-primary">${((invoiceToPay?.balanceDue !== undefined && invoiceToPay?.balanceDue !== null) ? invoiceToPay.balanceDue : invoiceToPay?.total || 0).toFixed(2)}</strong>.
                  Partial payments will reduce balance; status changes to 'paid' when balance reaches $0.00.
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
              <Button type="button" variant="ghost" size="sm" onClick={() => setInvoiceToPay(null)} disabled={isRecordingPayment}>
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
