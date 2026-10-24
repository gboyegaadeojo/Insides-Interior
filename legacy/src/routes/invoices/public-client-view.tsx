import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getInvoiceByShareToken } from '../../lib/invoice-service';
import { StatusBadge } from '../../components/shared/status-badge';
import { FileText, AlertCircle } from 'lucide-react';

export default function PublicClientInvoiceView() {
  const { shareToken } = useParams<{ shareToken: string }>();
  const [invoice, setInvoice] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadData() {
      if (!shareToken) return;
      setLoading(true);
      try {
        const data = await getInvoiceByShareToken(shareToken);
        if (data) {
          setInvoice(data);
        } else {
          setError('Invoice not found or link expired.');
        }
      } catch (err: any) {
        setError(`Failed to load invoice: ${err?.message || 'Error'}`);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [shareToken]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center space-y-4">
        <FileText className="w-10 h-10 text-secondary animate-bounce" />
        <p className="text-secondary font-medium">Loading Invoice...</p>
      </div>
    );
  }

  if (error || !invoice) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md bg-surface border border-border rounded-2xl p-8 space-y-4 shadow-sm">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto" />
          <h2 className="text-xl font-bold text-primary">Invoice Not Found</h2>
          <p className="text-sm text-secondary">{error || 'This link may have expired or is invalid.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 py-12 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Rendered PDF Document Canvas */}
        <div className="bg-white text-zinc-900 border border-zinc-200 rounded-xl shadow-lg p-8 sm:p-12 space-y-8 font-sans text-sm min-h-[700px] relative overflow-hidden">
          
          {/* Status Stamp Overlay */}
          <div className="absolute top-8 right-8 rotate-12 opacity-85 pointer-events-none">
            <StatusBadge status={invoice.status} size="lg" />
          </div>

          {/* Document Header */}
          <div className="border-b border-zinc-200 pb-6">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900 uppercase">INVOICE</h2>
            <p className="font-mono text-zinc-600 mt-2 font-semibold text-lg">{invoice.invoiceNumber}</p>
          </div>

          {/* Bill To & Metadata Grid */}
          <div className="grid grid-cols-2 gap-8 text-zinc-600">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">Billed To</span>
              <p className="font-bold text-zinc-900 text-lg">{invoice.customerName || 'Customer'}</p>
            </div>

            <div className="text-right space-y-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 block">Issue Date</span>
                <span className="font-medium text-zinc-800">{invoice.issueDate}</span>
              </div>
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 block">Due Date</span>
                <span className="font-medium text-zinc-800">{invoice.dueDate}</span>
              </div>
            </div>
          </div>

          {/* Itemized Table */}
          <div className="border border-zinc-200 rounded-lg overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200 font-semibold text-zinc-600 text-xs uppercase tracking-wider">
                <tr>
                  <th className="p-4">Description</th>
                  <th className="p-4 text-center">Qty</th>
                  <th className="p-4 text-right">Price</th>
                  <th className="p-4 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-zinc-800">
                {(invoice.lineItems || []).map((item: any, idx: number) => (
                  <tr key={idx}>
                    <td className="p-4 font-medium">{item.description || 'Line Item'}</td>
                    <td className="p-4 text-center font-mono">{item.quantity}</td>
                    <td className="p-4 text-right font-mono">${(item.unitPrice || 0).toFixed(2)}</td>
                    <td className="p-4 text-right font-mono font-semibold">${(item.amount || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Summary Totals Block */}
          <div className="flex justify-end pt-4 border-t border-zinc-200">
            <div className="w-64 space-y-2.5 text-zinc-700">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-mono font-medium">${(invoice.subtotal || 0).toFixed(2)}</span>
              </div>

              {invoice.discountTotal > 0 && (
                <div className="flex justify-between text-emerald-700">
                  <span>Discount</span>
                  <span className="font-mono">-${invoice.discountTotal.toFixed(2)}</span>
                </div>
              )}

              <div className="flex justify-between">
                <span>Tax</span>
                <span className="font-mono font-medium">${(invoice.taxTotal || 0).toFixed(2)}</span>
              </div>

              <div className="flex justify-between font-bold text-lg text-zinc-900 pt-3 border-t border-zinc-200">
                <span>Total Due</span>
                <span className="font-mono">${(invoice.total || 0).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Notes & Terms */}
          {(invoice.notes || invoice.terms) && (
            <div className="pt-8 border-t border-zinc-200 text-zinc-500 space-y-6">
              {invoice.notes && (
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">Notes</span>
                  <p className="italic text-sm">{invoice.notes}</p>
                </div>
              )}
              {invoice.terms && (
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">Payment Terms</span>
                  <p className="text-sm whitespace-pre-wrap">{invoice.terms}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
