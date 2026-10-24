import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Quote, QuoteRevision } from '../../types';
import { 
  getQuoteByShareToken, 
  clientApproveQuote, 
  clientRequestChangesQuote, 
  getQuoteRevisions 
} from '../../lib/quote-service';
import { StatusBadge } from '../../components/shared/status-badge';
import { Button } from '../../components/ui/button';
import { 
  CheckCircle2, 
  MessageSquare, 
  Sparkles, 
  FileText, 
  Clock, 
  Send,
  AlertCircle,
  Building2,
  Calendar,
  DollarSign
} from 'lucide-react';

export function PublicClientQuoteView() {
  const { shareToken } = useParams<{ shareToken: string }>();

  const [quote, setQuote] = useState<Quote | null>(null);
  const [revisions, setRevisions] = useState<QuoteRevision[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Client Actions State
  const [isApproving, setIsApproving] = useState<boolean>(false);
  const [isRequestingChanges, setIsRequestingChanges] = useState<boolean>(false);
  const [showCommentForm, setShowCommentForm] = useState<boolean>(false);
  const [comment, setComment] = useState<string>('');
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadQuoteData() {
      if (!shareToken) {
        setError('Invalid share link.');
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const found = await getQuoteByShareToken(shareToken);
        if (found) {
          setQuote(found);
          const revs = await getQuoteRevisions(found.id, shareToken);
          setRevisions(revs);
        } else {
          setError('Quote not found or link expired.');
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to load quote details.');
      } finally {
        setLoading(false);
      }
    }
    loadQuoteData();
  }, [shareToken]);

  const handleApprove = async () => {
    if (!quote) return;
    setIsApproving(true);
    try {
      await clientApproveQuote(quote);
      setQuote(prev => prev ? { ...prev, status: 'approved' } : null);
      setActionSuccessMessage('Quote approved successfully! The business owner has been notified.');
    } catch (err: any) {
      setError(err?.message || 'Failed to approve quote.');
    } finally {
      setIsApproving(false);
    }
  };

  const handleRequestChanges = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quote) return;
    if (!comment.trim()) {
      setError('Please provide feedback describing requested changes.');
      return;
    }
    setIsRequestingChanges(true);
    try {
      await clientRequestChangesQuote(quote, comment);
      setQuote(prev => prev ? { ...prev, status: 'changes_requested' } : null);
      setShowCommentForm(false);
      setActionSuccessMessage('Your change request has been submitted to the business owner.');
      const revs = await getQuoteRevisions(quote.id, quote.shareToken);
      setRevisions(revs);
    } catch (err: any) {
      setError(err?.message || 'Failed to submit changes.');
    } finally {
      setIsRequestingChanges(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-6 text-zinc-500">
        <FileText className="w-10 h-10 animate-bounce mb-3 text-zinc-400" />
        <p className="text-sm font-medium">Loading official quote details...</p>
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-8 text-center shadow-lg space-y-4">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Unable to Display Quote</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{error || 'This link may be invalid or expired.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 py-10 px-4 md:px-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Banner Notification */}
        {actionSuccessMessage && (
          <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 flex items-center gap-3 shadow-sm">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <p className="text-sm font-medium">{actionSuccessMessage}</p>
          </div>
        )}

        {/* Top Header Card */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 md:p-8 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">Official Quote</span>
              <StatusBadge status={quote.status} size="md" />
              <span className="text-xs font-mono text-zinc-400">v{quote.version}</span>
            </div>
            <h1 className="text-2xl md:text-3xl font-extrabold font-mono text-zinc-900 dark:text-zinc-100">{quote.quoteNumber}</h1>
            <p className="text-sm text-zinc-500 flex items-center gap-2">
              <Building2 className="w-4 h-4 text-zinc-400" />
              <span>Prepared for: <strong>{quote.customerName}</strong></span>
            </p>
          </div>

          {/* Public Action Buttons */}
          <div className="flex items-center gap-3 flex-wrap">
            {quote.status === 'sent_for_approval' && (
              <>
                <Button
                  variant="outline"
                  onClick={() => setShowCommentForm(!showCommentForm)}
                  className="gap-2 border-zinc-300 dark:border-zinc-700"
                >
                  <MessageSquare className="w-4 h-4 text-rose-500" />
                  <span>Request Changes</span>
                </Button>

                <Button
                  onClick={handleApprove}
                  disabled={isApproving}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-2 shadow-sm"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{isApproving ? 'Approving...' : 'Approve Quote'}</span>
                </Button>
              </>
            )}

            {quote.status === 'approved' && (
              <div className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 px-4 py-2 rounded-lg text-sm font-semibold border border-emerald-200 dark:border-emerald-800 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Quote Approved</span>
              </div>
            )}

            {quote.status === 'converted' && (
              <div className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 px-4 py-2 rounded-lg text-sm font-semibold border border-indigo-200 dark:border-indigo-800 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <span>Converted to Invoice</span>
              </div>
            )}
          </div>
        </div>

        {/* Request Changes Form */}
        {showCommentForm && quote.status === 'sent_for_approval' && (
          <form onSubmit={handleRequestChanges} className="bg-white dark:bg-zinc-900 border border-rose-200 dark:border-rose-900/60 rounded-2xl p-6 shadow-md space-y-4">
            <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
              <MessageSquare className="w-5 h-5" />
              <h3 className="font-bold text-sm">Submit Change Request</h3>
            </div>
            <p className="text-xs text-zinc-500">Describe what updates or adjustments you would like made to this quote before approval.</p>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="e.g. Please update line item #2 to include 15 hours instead of 20..."
              maxLength={1000}
              rows={4}
              required
              className="w-full text-sm p-3 rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            <div className="flex justify-between items-center text-xs text-zinc-400">
              <span>{comment.length} / 1000 characters</span>
              <div className="flex gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowCommentForm(false)}>Cancel</Button>
                <Button type="submit" size="sm" disabled={isRequestingChanges} className="bg-rose-600 hover:bg-rose-700 text-white font-semibold">
                  {isRequestingChanges ? 'Submitting...' : 'Submit Feedback'}
                </Button>
              </div>
            </div>
          </form>
        )}

        {/* Quote Document Body */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-8 shadow-sm space-y-8">
          
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pb-6 border-b border-zinc-200 dark:border-zinc-800">
            <div>
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-1">Issue Date</span>
              <span className="text-sm font-medium flex items-center gap-1.5"><Calendar className="w-4 h-4 text-zinc-400" />{quote.issueDate}</span>
            </div>
            <div>
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-1">Expiry Date</span>
              <span className="text-sm font-medium flex items-center gap-1.5"><Calendar className="w-4 h-4 text-zinc-400" />{quote.expiryDate || 'N/A'}</span>
            </div>
            <div>
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-1">Total Amount</span>
              <span className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">${quote.total.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider block mb-1">Version</span>
              <span className="text-sm font-mono font-medium">v{quote.version}</span>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Services & Products Included</h3>
            <div className="border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50 dark:bg-zinc-800/60 text-zinc-500 font-medium text-xs uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
                  <tr>
                    <th className="p-3.5">Description</th>
                    <th className="p-3.5 text-right">Qty</th>
                    <th className="p-3.5 text-right">Unit Price</th>
                    <th className="p-3.5 text-right">Tax</th>
                    <th className="p-3.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  {quote.lineItems?.map((item, idx) => (
                    <tr key={idx} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30">
                      <td className="p-3.5 font-medium">{item.description}</td>
                      <td className="p-3.5 text-right font-mono text-xs">{item.quantity}</td>
                      <td className="p-3.5 text-right font-mono text-xs">${item.unitPrice.toFixed(2)}</td>
                      <td className="p-3.5 text-right font-mono text-xs text-zinc-500">{item.taxRate}%</td>
                      <td className="p-3.5 text-right font-mono text-sm font-semibold">${item.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals Summary */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 pt-4 border-t border-zinc-200 dark:border-zinc-800">
            <div className="max-w-md space-y-3">
              {quote.notes && (
                <div>
                  <h4 className="text-xs font-bold uppercase text-zinc-400 tracking-wider mb-1">Notes & Instructions</h4>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{quote.notes}</p>
                </div>
              )}
              {quote.terms && (
                <div>
                  <h4 className="text-xs font-bold uppercase text-zinc-400 tracking-wider mb-1">Terms & Conditions</h4>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">{quote.terms}</p>
                </div>
              )}
            </div>

            <div className="w-full md:w-72 bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2 text-sm">
              <div className="flex justify-between text-zinc-500 text-xs">
                <span>Subtotal</span>
                <span className="font-mono">${quote.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-zinc-500 text-xs">
                <span>Tax Total</span>
                <span className="font-mono">${quote.taxTotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t border-zinc-200 dark:border-zinc-700 pt-2 text-zinc-900 dark:text-zinc-100">
                <span>Total Quote</span>
                <span className="font-mono text-emerald-600 dark:text-emerald-400">${quote.total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Revision History Panel */}
        {revisions.length > 0 && (
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-bold flex items-center gap-2">
              <Clock className="w-4 h-4 text-zinc-400" />
              <span>Quote Revision History</span>
            </h3>
            <div className="space-y-3">
              {revisions.map((rev) => (
                <div key={rev.id} className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/30 flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold">Version {rev.version}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${rev.createdBy === 'client' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'}`}>
                        {rev.createdBy === 'client' ? 'Client Feedback' : 'Owner Update'}
                      </span>
                    </div>
                    {rev.clientComment && (
                      <p className="text-xs text-zinc-700 dark:text-zinc-300 italic mt-1 bg-white dark:bg-zinc-900 p-2 rounded border border-zinc-200 dark:border-zinc-800 font-serif">
                        "{rev.clientComment}"
                      </p>
                    )}
                  </div>
                  <span className="text-xs font-mono font-semibold text-zinc-500">${rev.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
