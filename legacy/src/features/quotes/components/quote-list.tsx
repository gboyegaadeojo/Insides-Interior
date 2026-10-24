import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Quote, QuoteStatus } from '../../../types';
import { getQuotes, deleteQuote, convertQuoteToInvoice } from '../../../lib/quote-service';
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
  Search, 
  ExternalLink, 
  Trash2, 
  Eye, 
  Edit3, 
  ArrowRightCircle, 
  FileText, 
  Sparkles,
  Copy,
  Building2,
  Calendar
} from 'lucide-react';

export function QuoteList() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.uid || 'demo_user';

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<QuoteStatus | 'all'>('all');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Quick View Drawer State
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);

  // Delete Dialog State
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState<boolean>(false);
  const [quoteToDelete, setQuoteToDelete] = useState<Quote | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Convert State
  const [isConverting, setIsConverting] = useState<boolean>(false);

  const fetchQuotesList = async () => {
    setLoading(true);
    try {
      const data = await getQuotes(userId);
      setQuotes(data);
    } catch (err: any) {
      showToast(`Failed to load quotes: ${err?.message || 'Error'}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchQuotesList();
  }, [userId]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const filteredQuotes = quotes.filter((q) => {
    const matchesSearch = 
      q.quoteNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      q.customerName.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;
    if (activeTab === 'all') return true;
    return q.status === activeTab;
  });

  const handleOpenDrawer = (quote: Quote) => {
    setSelectedQuote(quote);
    setIsDrawerOpen(true);
  };

  const handleCopyLink = async (shareToken: string) => {
    const shareUrl = `${window.location.origin}/q/${shareToken}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Public quote link copied to clipboard!');
    } catch (err) {
      showToast(`Public link: ${shareUrl}`);
    }
  };

  const handleConvertToInvoice = async (quote: Quote) => {
    setIsConverting(true);
    try {
      const invoice = await convertQuoteToInvoice(quote.id);
      showToast(`Quote #${quote.quoteNumber} converted to Invoice #${invoice.invoiceNumber}! Redirecting...`);
      setIsDrawerOpen(false);
      setTimeout(() => {
        navigate(`/invoices/${invoice.id}/edit`);
      }, 1000);
    } catch (err: any) {
      showToast(`Failed to convert quote: ${err?.message || 'Error'}`);
    } finally {
      setIsConverting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!quoteToDelete) return;
    setIsDeleting(true);
    try {
      await deleteQuote(quoteToDelete.id, quoteToDelete.shareToken);
      showToast(`Quote #${quoteToDelete.quoteNumber} permanently deleted.`);
      setIsDeleteDialogOpen(false);
      setQuoteToDelete(null);
      if (selectedQuote?.id === quoteToDelete.id) {
        setIsDrawerOpen(false);
      }
      await fetchQuotesList();
    } catch (err: any) {
      showToast(`Failed to delete quote: ${err?.message || 'Error'}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-zinc-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-2 border border-zinc-700 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <Sparkles className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl font-bold text-primary">Quotes Management</h1>
          <p className="text-xs text-secondary mt-0.5">Manage quotes, send for client approval, and convert approved quotes to invoices.</p>
        </div>

        <Button
          onClick={() => navigate('/quotes/new/edit')}
          className="bg-primary text-primary-foreground hover:opacity-90 font-medium gap-1.5 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>Create New Quote</span>
        </Button>
      </div>

      {/* Search & Tabs Controls */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {[
            { id: 'all', label: 'All Quotes' },
            { id: 'draft', label: 'Drafts' },
            { id: 'sent_for_approval', label: 'Sent for Approval' },
            { id: 'changes_requested', label: 'Changes Requested' },
            { id: 'approved', label: 'Approved' },
            { id: 'converted', label: 'Converted' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 shadow-xs'
                  : 'text-secondary hover:bg-subtle'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-64">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-secondary" />
          <Input
            placeholder="Search quotes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-xs"
          />
        </div>
      </div>

      {/* Quotes Table */}
      {loading ? (
        <div className="p-12 text-center text-secondary flex flex-col items-center justify-center space-y-2">
          <FileText className="w-8 h-8 animate-bounce text-secondary" />
          <p className="text-xs">Loading quotes list...</p>
        </div>
      ) : filteredQuotes.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border rounded-xl bg-subtle/30 space-y-3">
          <FileText className="w-10 h-10 text-secondary mx-auto" />
          <p className="text-sm font-semibold text-primary">No quotes found</p>
          <p className="text-xs text-secondary max-w-sm mx-auto">
            {searchQuery || activeTab !== 'all' ? 'Try adjusting your filters or search terms.' : 'Create your first quote to start sending proposals to clients.'}
          </p>
          <Button size="sm" onClick={() => navigate('/quotes/new/edit')} className="gap-1.5">
            <Plus className="w-4 h-4" /> Create Quote
          </Button>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden bg-surface shadow-xs">
          <table className="w-full text-left text-xs">
            <thead className="bg-subtle text-secondary font-semibold uppercase tracking-wider border-b border-border">
              <tr>
                <th className="p-3.5">Quote #</th>
                <th className="p-3.5">Customer</th>
                <th className="p-3.5">Issue Date</th>
                <th className="p-3.5">Expiry Date</th>
                <th className="p-3.5 text-right">Total</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredQuotes.map((quote) => (
                <tr key={quote.id} className="hover:bg-subtle/50 transition-colors">
                  <td className="p-3.5 font-mono font-bold text-primary">
                    <button
                      onClick={() => handleOpenDrawer(quote)}
                      className="hover:underline text-left"
                    >
                      {quote.quoteNumber}
                    </button>
                  </td>
                  <td className="p-3.5 font-medium text-primary">{quote.customerName}</td>
                  <td className="p-3.5 font-mono text-secondary">{quote.issueDate}</td>
                  <td className="p-3.5 font-mono text-secondary">{quote.expiryDate || 'N/A'}</td>
                  <td className="p-3.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    ${quote.total.toFixed(2)}
                  </td>
                  <td className="p-3.5">
                    <StatusBadge status={quote.status} size="sm" />
                  </td>
                  <td className="p-3.5 text-right space-x-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenDrawer(quote)}
                      title="Quick View Drawer"
                      className="h-8 w-8 p-0"
                    >
                      <Eye className="w-4 h-4 text-secondary" />
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/quotes/${quote.id}/edit`)}
                      title="Edit Quote"
                      className="h-8 w-8 p-0"
                    >
                      <Edit3 className="w-4 h-4 text-secondary" />
                    </Button>

                    {(quote.status === 'approved' || quote.status === 'converted') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleConvertToInvoice(quote)}
                        title="Convert to Invoice"
                        className="h-8 w-8 p-0 text-indigo-600 hover:text-indigo-700"
                      >
                        <ArrowRightCircle className="w-4 h-4" />
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setQuoteToDelete(quote);
                        setIsDeleteDialogOpen(true);
                      }}
                      title="Delete Quote"
                      className="h-8 w-8 p-0 text-rose-600 hover:text-rose-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Quick View Drawer */}
      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DrawerContent className="max-w-2xl mx-auto p-6 space-y-6">
          {selectedQuote && (
            <>
              <DrawerHeader className="p-0 border-b border-border pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-secondary uppercase tracking-wider">Quote Drawer</span>
                    <DrawerTitle className="text-xl font-bold font-mono text-primary">{selectedQuote.quoteNumber}</DrawerTitle>
                  </div>
                  <StatusBadge status={selectedQuote.status} size="md" />
                </div>
                <DrawerDescription className="text-xs text-secondary mt-1">
                  Prepared for: <strong>{selectedQuote.customerName}</strong>
                </DrawerDescription>
              </DrawerHeader>

              {/* Detail Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                <div className="p-3 bg-subtle rounded-lg border border-border">
                  <span className="text-secondary block font-medium">Issue Date</span>
                  <span className="font-mono font-semibold text-primary">{selectedQuote.issueDate}</span>
                </div>
                <div className="p-3 bg-subtle rounded-lg border border-border">
                  <span className="text-secondary block font-medium">Expiry Date</span>
                  <span className="font-mono font-semibold text-primary">{selectedQuote.expiryDate || 'N/A'}</span>
                </div>
                <div className="p-3 bg-subtle rounded-lg border border-border">
                  <span className="text-secondary block font-medium">Version</span>
                  <span className="font-mono font-semibold text-primary">v{selectedQuote.version}</span>
                </div>
                <div className="p-3 bg-subtle rounded-lg border border-border">
                  <span className="text-secondary block font-medium">Total Amount</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">${selectedQuote.total.toFixed(2)}</span>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="flex items-center justify-between gap-3 pt-4 border-t border-border flex-wrap">
                <div className="flex items-center gap-2">
                  {selectedQuote.shareToken && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCopyLink(selectedQuote.shareToken)}
                        className="gap-1.5 text-xs"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy Share Link
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(`/q/${selectedQuote.shareToken}`, '_blank')}
                        className="gap-1.5 text-xs"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Public View
                      </Button>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setIsDrawerOpen(false);
                      navigate(`/quotes/${selectedQuote.id}/edit`);
                    }}
                  >
                    Edit Quote
                  </Button>

                  {(selectedQuote.status === 'approved' || selectedQuote.status === 'converted') && (
                    <Button
                      size="sm"
                      onClick={() => handleConvertToInvoice(selectedQuote)}
                      disabled={isConverting}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold gap-1.5"
                    >
                      <ArrowRightCircle className="w-4 h-4" />
                      <span>{isConverting ? 'Converting...' : 'Convert to Invoice'}</span>
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </DrawerContent>
      </Drawer>

      {/* Delete Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-rose-600 flex items-center gap-2">
              <Trash2 className="w-5 h-5" />
              <span>Delete Quote #{quoteToDelete?.quoteNumber}?</span>
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-xs text-secondary pt-2">
                This operation is <strong>irreversible</strong>. Deleting this quote will permanently remove:
                <ul className="list-disc list-inside mt-2 space-y-1 font-mono text-[11px] text-primary">
                  <li>Main Quote Document (#{quoteToDelete?.quoteNumber})</li>
                  <li>Public Client Share Link (/q/{quoteToDelete?.shareToken})</li>
                  <li>Associated Quote Revision Snapshots</li>
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
