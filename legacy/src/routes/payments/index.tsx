import React, { useEffect, useState, useMemo } from 'react';
import { Payment, Customer, Invoice } from '../../types';
import { useAuth } from '../../hooks/use-auth';
import { getAllPayments, getCustomers, getLocalData } from '../../lib/invoice-service';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { 
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell
} from '../../components/ui/table';
import { 
  Search, 
  Activity,
  Banknote
} from 'lucide-react';
import { format } from 'date-fns';

export default function Payments() {
  const { user } = useAuth();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [customers, setCustomers] = useState<Record<string, string>>({});
  const [invoices, setInvoices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function load() {
      if (!user) return;
      const [paymentData, custData] = await Promise.all([
        getAllPayments(user.uid),
        getCustomers(user.uid)
      ]);
      setPayments(paymentData);
      
      const custMap: Record<string, string> = {};
      custData.forEach(c => custMap[c.id] = c.name);
      setCustomers(custMap);
      
      // Load invoices to get invoice numbers (since payments just have invoiceId)
      // Ideally we would denormalize invoiceNumber and customerName onto Payment
      const invs = getLocalData<Invoice>('invoiceos_demo_invoices', []);
      const invMap: Record<string, string> = {};
      invs.forEach(i => invMap[i.id] = i.invoiceNumber);
      setInvoices(invMap);
      
      setLoading(false);
    }
    load();
  }, [user]);

  const filteredPayments = useMemo(() => {
    if (!search) return payments;
    const lower = search.toLowerCase();
    return payments.filter(p => {
      const custName = customers[p.customerId] || '';
      const invNum = invoices[p.invoiceId] || p.invoiceId;
      return custName.toLowerCase().includes(lower) || 
             invNum.toLowerCase().includes(lower) ||
             p.method.toLowerCase().includes(lower) ||
             (p.notes && p.notes.toLowerCase().includes(lower));
    });
  }, [payments, customers, invoices, search]);

  return (
    <div className="h-full bg-subtle">
      <div className="max-w-7xl mx-auto space-y-6 pb-8">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-primary">Payments Ledger</h1>
            <p className="text-secondary text-sm mt-1">Global view of all recorded cash receipts</p>
          </div>
        </header>

        <div className="flex items-center relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 text-secondary" />
          <Input 
            placeholder="Search by customer, invoice #, or method..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="py-12 flex justify-center"><Activity className="w-6 h-6 text-secondary animate-spin" /></div>
        ) : filteredPayments.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-12 flex flex-col items-center justify-center text-center">
            <Banknote className="w-12 h-12 text-secondary/40 mb-4" />
            <p className="text-primary font-medium">No payments found</p>
            <p className="text-secondary text-sm mt-1 max-w-md">
              {search ? "We couldn't find any payments matching your search." : "You haven't recorded any payments yet. When clients pay your invoices, they will appear here."}
            </p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments.map(payment => (
                  <TableRow key={payment.id}>
                    <TableCell>
                      <span className="text-primary font-medium">{format(new Date(payment.date), 'MMM d, yyyy')}</span>
                    </TableCell>
                    <TableCell>
                      <span className="font-medium text-primary">{customers[payment.customerId] || 'Unknown Customer'}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-secondary">{invoices[payment.invoiceId] || payment.invoiceId}</span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary/10 text-secondary capitalize">
                        {payment.method}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium text-emerald-600">+${(payment.amount || 0).toFixed(2)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
