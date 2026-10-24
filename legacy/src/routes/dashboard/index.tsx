import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../../hooks/use-auth';
import { getInvoices, getAllPayments, getActivityLogs } from '../../lib/invoice-service';
import { getExpenses } from '../../lib/expense-service';
import { Expense } from '../../types';
import { getQuotes } from '../../lib/quote-service';
import { Invoice, Payment, Quote, ActivityLog } from '../../types';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { format, subMonths, startOfMonth, endOfMonth, isWithinInterval, parseISO, formatDistanceToNow } from 'date-fns';
import { 
  ArrowRight, 
  AlertCircle, 
  Clock, 
  FileEdit, 
  CheckCircle2, 
  MessageSquareQuote, 
  Activity, 
  Calendar 
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/button';

export default function Dashboard() {
  const { user, firstName } = useAuth();
  const navigate = useNavigate();
  
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadData(user.uid);
    }
  }, [user]);

  const loadData = async (userId: string) => {
    try {
      setLoading(true);
      const [invs, qts, pays, exps, acts] = await Promise.all([
        getInvoices(userId),
        getQuotes(userId),
        getAllPayments(userId),
        getExpenses(userId),
        getActivityLogs(userId)
      ]);
      setInvoices(invs);
      setQuotes(qts);
      setPayments(pays);
      setExpenses(exps);
      setActivities(acts);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // 1. Chart Data (Last 6 Months)
  const chartData = useMemo(() => {
    const data = [];
    const now = new Date();
    
    for (let i = 5; i >= 0; i--) {
      const month = subMonths(now, i);
      const start = startOfMonth(month);
      const end = endOfMonth(month);
      
      const monthPayments = payments.filter(p => {
        if (!p.date) return false;
        try {
          const d = parseISO(p.date);
          return isWithinInterval(d, { start, end });
        } catch { return false; }
      });
      
      const monthExpenses = expenses.filter(e => {
        if (!e.date) return false;
        try {
          const d = parseISO(e.date);
          return isWithinInterval(d, { start, end });
        } catch { return false; }
      });
      
      const moneyIn = monthPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const moneyOut = monthExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
      
      data.push({
        name: format(month, 'MMM'),
        moneyIn,
        moneyOut
      });
    }
    
    return data;
  }, [payments, expenses]);

  // 2. Action Inbox
  const actionInbox = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isActuallyOverdue = (inv: Invoice) => {
      if (inv.status === 'overdue') return true;
      if (['pending', 'partially_paid'].includes(inv.status) && inv.dueDate) {
        const dueDate = new Date(inv.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        return dueDate < today;
      }
      return false;
    };

    const overdue = invoices.filter(isActuallyOverdue);
    const quoteFeedback = quotes.filter(q => q.status === 'changes_requested').sort((a, b) => {
      const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return timeA - timeB;
    });
    const pending = invoices.filter(i => 
      ['pending', 'partially_paid'].includes(i.status) && !isActuallyOverdue(i)
    );
    const draft = invoices.filter(i => i.status === 'draft');
    
    return { overdue, quoteFeedback, pending, draft };
  }, [invoices, quotes]);

  // 3. Due Soon Invoices (next 7 days, not overdue)
  const dueSoonInvoices = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return invoices.filter(inv => {
      if (['pending', 'partially_paid'].includes(inv.status) && inv.dueDate) {
        const dueDate = new Date(inv.dueDate);
        dueDate.setHours(0, 0, 0, 0);
        const diffTime = dueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays >= 0 && diffDays <= 7;
      }
      return false;
    }).sort((a, b) => new Date(a.dueDate!).getTime() - new Date(b.dueDate!).getTime());
  }, [invoices]);

  // 4. Recent Activities (last 5-10 logs)
  const recentActivities = useMemo(() => {
    return activities.slice(0, 10);
  }, [activities]);

  const formatRelativeTime = (dateInput: any) => {
    if (!dateInput) return 'recently';
    try {
      const date = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
      if (isNaN(date.getTime())) return 'recently';
      return formatDistanceToNow(date, { addSuffix: true });
    } catch {
      return 'recently';
    }
  };

  const formatActivityLog = (act: ActivityLog) => {
    let title = act.description;
    let label = act.action;
    let icon = <Activity className="w-4 h-4" />;
    let color = "text-secondary";
    let bg = "bg-secondary/10";

    switch (act.action) {
      case 'payment_recorded':
        label = "Payment";
        icon = <CheckCircle2 className="w-4 h-4" />;
        color = "text-emerald-600";
        bg = "bg-emerald-100";
        const payMatch = act.description.match(/Recorded payment of (\$[\d,.]+) \((.*?)\) for Invoice (#[\w-]+)\. Remaining balance: (\$[\d,.]+)\./);
        if (payMatch) {
          const [, amount, , invNum, balance] = payMatch;
          if (balance === '$0.00') {
            title = `Payment of ${amount} received for ${invNum} — fully paid`;
          } else {
            title = `Payment of ${amount} received for ${invNum} — ${balance} remaining`;
          }
        }
        break;
      case 'approved':
        label = "Approved";
        icon = <CheckCircle2 className="w-4 h-4" />;
        color = "text-emerald-600";
        bg = "bg-emerald-100";
        if (act.description.startsWith('Client approved Quote ')) {
          title = act.description.replace('Client approved Quote ', 'Quote ') + ' approved by client';
        } else if (act.description.includes('approved')) {
          title = act.description;
        }
        break;
      case 'changes_requested':
        label = "Feedback";
        icon = <MessageSquareQuote className="w-4 h-4" />;
        color = "text-amber-600";
        bg = "bg-amber-100";
        if (act.description.startsWith('Client requested changes for Quote ')) {
           const qtMatch = act.description.match(/Quote (#QT-[\w-]+)/);
           if (qtMatch) {
             title = `Quote ${qtMatch[1]} changes requested by client`;
           }
        }
        break;
      case 'created':
        label = "New";
        icon = <FileEdit className="w-4 h-4" />;
        color = "text-blue-600";
        bg = "bg-blue-100";
        if (title.startsWith('Created invoice ')) title = title.replace('Created invoice ', 'Invoice ') + ' created';
        if (title.startsWith('Created quote ')) title = title.replace('Created quote ', 'Quote ') + ' created';
        break;
      case 'sent_for_approval':
        label = "Sent";
        icon = <ArrowRight className="w-4 h-4" />;
        color = "text-indigo-600";
        bg = "bg-indigo-100";
        if (title.startsWith('Sent quote ')) title = title.replace('Sent quote ', 'Quote ') + ' sent for approval';
        break;
      case 'updated':
        icon = <FileEdit className="w-4 h-4" />;
        color = "text-blue-600";
        bg = "bg-blue-100";
        
        const invoiceStatusMatch = title.match(/Updated invoice (INV-[\w-]+) \(Status: (.*?)\)/);
        const quoteStatusMatch = title.match(/Updated quote (QT-[\w-]+) \(Status: (.*?)\)/);
        
        if (invoiceStatusMatch) {
           const [, invNum, status] = invoiceStatusMatch;
           const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
           title = `Invoice ${invNum} marked as ${capitalizedStatus}`;
           label = "Status Update";
        } else if (quoteStatusMatch) {
           const [, quoteNum, status] = quoteStatusMatch;
           const capitalizedStatus = status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
           title = `Quote ${quoteNum} marked as ${capitalizedStatus}`;
           label = "Status Update";
        } else {
           if (title.startsWith('Updated invoice ')) title = title.replace('Updated invoice ', 'Invoice ') + ' updated';
           if (title.startsWith('Updated quote ')) title = title.replace('Updated quote ', 'Quote ') + ' updated';
           label = "Update";
        }
        break;
      case 'deleted':
        label = "Deleted";
        icon = <AlertCircle className="w-4 h-4" />;
        color = "text-rose-600";
        bg = "bg-rose-100";
        if (title.endsWith(' and all associated payments were permanently deleted.')) {
           title = title.replace(' and all associated payments were permanently deleted.', ' deleted');
        } else if (title.endsWith(' was permanently deleted.')) {
           title = title.replace(' was permanently deleted.', ' deleted');
        }
        break;
      default:
        label = act.action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        break;
    }

    return { title, label, icon, color, bg };
  };

  const hasActionItems = actionInbox.overdue.length > 0 || actionInbox.quoteFeedback.length > 0 || actionInbox.pending.length > 0 || actionInbox.draft.length > 0;
  const hasChartData = payments.length > 0 || expenses.length > 0;

  return (
    <div className="h-full bg-subtle">
      <div className="max-w-5xl mx-auto space-y-8 pb-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-primary">Overview</h1>
          <p className="text-secondary text-sm mt-1">Welcome back, {firstName}</p>
        </header>

        {loading ? (
          <div className="p-12 flex justify-center text-secondary text-sm">Loading workspace...</div>
        ) : (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Cash Flow Chart */}
              <div className="lg:col-span-2 space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary">Cash Flow</h2>
                <div className="bg-surface border border-border rounded-xl p-6 shadow-sm">
                  {!hasChartData ? (
                    <div className="h-72 flex flex-col items-center justify-center text-center">
                      <p className="text-primary font-medium">No financial data yet</p>
                      <p className="text-secondary text-sm mt-1 max-w-sm">
                        Record payments or log expenses to see your cash flow visualizer here.
                      </p>
                    </div>
                  ) : (
                    <div className="h-72">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <XAxis 
                            dataKey="name" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fontSize: 12, fill: '#71717a' }}
                            dy={10}
                          />
                          <YAxis 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fontSize: 12, fill: '#71717a' }}
                            tickFormatter={(value) => typeof value === 'number' ? `$${value.toLocaleString()}` : `$${value}`}
                            width={90}
                          />
                          <CartesianGrid vertical={false} stroke="#e4e4e7" strokeDasharray="4 4" />
                          <Tooltip 
                            contentStyle={{ borderRadius: '8px', border: '1px solid #e4e4e7', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            formatter={(value: number) => [`$${value.toFixed(2)}`, undefined]}
                          />
                          <Area 
                            type="monotone" 
                            dataKey="moneyIn" 
                            name="Money In"
                            stroke="#10b981" 
                            strokeWidth={2}
                            fillOpacity={1} 
                            fill="url(#colorIn)" 
                          />
                          <Area 
                            type="monotone" 
                            dataKey="moneyOut" 
                            name="Money Out"
                            stroke="#ef4444" 
                            strokeWidth={2}
                            fillOpacity={1} 
                            fill="url(#colorOut)" 
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Inbox */}
              <div className="space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary">Action Inbox</h2>
                <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden flex flex-col h-[336px]">
                  {!hasActionItems ? (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                      <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-3" />
                      <p className="text-primary font-medium">You're all caught up!</p>
                      <p className="text-secondary text-sm mt-1">No pending actions required.</p>
                    </div>
                  ) : (
                    <div className="flex-1 overflow-y-auto p-2">
                      {/* Overdue Invoices */}
                      {actionInbox.overdue.map(inv => (
                        <div key={inv.id} className="p-3 mb-2 rounded-lg hover:bg-subtle transition-colors flex items-start gap-3 group cursor-pointer" onClick={() => navigate(`/invoices/${inv.id}/edit`)}>
                          <div className="mt-0.5 bg-rose-100 text-rose-600 p-1.5 rounded-full shrink-0">
                            <AlertCircle className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-primary truncate">#{inv.invoiceNumber} is Overdue</p>
                            <p className="text-xs text-secondary mt-0.5">${(inv.balanceDue ?? inv.total).toFixed(2)} due</p>
                          </div>
                          <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 opacity-0 group-hover:opacity-100">
                            <ArrowRight className="w-4 h-4 text-secondary" />
                          </Button>
                        </div>
                      ))}

                      {/* Quote Feedback (Changes Requested) */}
                      {actionInbox.quoteFeedback.map(quote => (
                        <div key={quote.id} className="p-3 mb-2 rounded-lg hover:bg-subtle transition-colors flex items-center gap-3 group cursor-pointer" onClick={() => navigate(`/quotes/${quote.id}/edit`)}>
                          <div className="bg-purple-100 text-purple-600 p-1.5 rounded-full shrink-0">
                            <MessageSquareQuote className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-primary truncate">#{quote.quoteNumber}</p>
                            <p className="text-xs text-secondary mt-0.5 truncate">{quote.customerName} • Changes requested</p>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="shrink-0 text-xs font-medium px-2.5 h-7"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/quotes/${quote.id}/edit`);
                            }}
                          >
                            Review Feedback
                          </Button>
                        </div>
                      ))}
                      
                      {/* Pending Invoices */}
                      {actionInbox.pending.map(inv => (
                        <div key={inv.id} className="p-3 mb-2 rounded-lg hover:bg-subtle transition-colors flex items-start gap-3 group cursor-pointer" onClick={() => navigate(`/invoices/${inv.id}/edit`)}>
                          <div className="mt-0.5 bg-amber-100 text-amber-600 p-1.5 rounded-full shrink-0">
                            <Clock className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-primary truncate">Awaiting Payment</p>
                            <p className="text-xs text-secondary mt-0.5">#{inv.invoiceNumber} • ${(inv.balanceDue ?? inv.total).toFixed(2)}</p>
                          </div>
                          <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 opacity-0 group-hover:opacity-100">
                            <ArrowRight className="w-4 h-4 text-secondary" />
                          </Button>
                        </div>
                      ))}

                      {/* Draft Invoices */}
                      {actionInbox.draft.map(inv => (
                        <div key={inv.id} className="p-3 mb-2 rounded-lg hover:bg-subtle transition-colors flex items-start gap-3 group cursor-pointer" onClick={() => navigate(`/invoices/${inv.id}/edit`)}>
                          <div className="mt-0.5 bg-zinc-100 text-zinc-600 p-1.5 rounded-full shrink-0">
                            <FileEdit className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-primary truncate">Review Draft #{inv.invoiceNumber}</p>
                            <p className="text-xs text-secondary mt-0.5">${inv.total.toFixed(2)}</p>
                          </div>
                          <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 opacity-0 group-hover:opacity-100">
                            <ArrowRight className="w-4 h-4 text-secondary" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Row 2: Recent Activity & Due Soon */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Recent Activity Feed */}
              <div className={`${dueSoonInvoices.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3'} space-y-4`}>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  Recent Activity
                </h2>
                <div className="bg-surface border border-border rounded-xl p-5 shadow-sm min-h-[160px]">
                  {recentActivities.length === 0 ? (
                    <div className="py-8 flex flex-col items-center justify-center text-center">
                      <Activity className="w-8 h-8 text-secondary/40 mb-2" />
                      <p className="text-primary font-medium text-sm">No recent activity</p>
                      <p className="text-secondary text-xs mt-1">Actions taken across invoices, quotes, and payments will appear here.</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {recentActivities.map(act => {
                        const { title, label, icon, color, bg } = formatActivityLog(act);
                        return (
                          <div key={act.id} className="py-3 first:pt-0 last:pb-0 flex items-start gap-4 text-sm">
                            <div className={`mt-0.5 ${bg} ${color} p-1.5 rounded-full shrink-0`}>
                              {icon}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-primary font-medium">{title}</p>
                              <p className="text-xs text-secondary capitalize mt-0.5">{label}</p>
                            </div>
                            <span className="text-xs text-secondary shrink-0 whitespace-nowrap pt-0.5">
                              {formatRelativeTime(act.createdAt)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Due Soon Section (Omitted entirely if empty) */}
              {dueSoonInvoices.length > 0 && (
                <div className="space-y-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-secondary flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-amber-500" />
                    Due Soon
                  </h2>
                  <div className="bg-surface border border-border rounded-xl p-4 shadow-sm space-y-3">
                    {dueSoonInvoices.map(inv => {
                      const dueDate = new Date(inv.dueDate!);
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      dueDate.setHours(0, 0, 0, 0);
                      const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                      const daysText = diffDays === 0 ? 'Due today' : diffDays === 1 ? 'Due tomorrow' : `Due in ${diffDays} days`;

                      return (
                        <div key={inv.id} className="p-3 bg-subtle/50 rounded-lg border border-border/60 flex items-center justify-between text-sm">
                          <div className="min-w-0 pr-3">
                            <p className="font-medium text-primary truncate">{inv.customerName}</p>
                            <p className="text-xs text-secondary mt-0.5">#{inv.invoiceNumber} • <span className="text-amber-600 font-medium">{daysText}</span></p>
                          </div>
                          <p className="font-semibold text-primary shrink-0">${(inv.balanceDue ?? inv.total).toFixed(2)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
