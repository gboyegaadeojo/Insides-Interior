import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Customer, Invoice, Quote, Payment } from '../../types';
import { useAuth } from '../../hooks/use-auth';
import { getCustomers, saveCustomer, getCustomerActivity, deleteCustomer } from '../../lib/customer-service';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card } from '../../components/ui/card';
import { 
  Plus, 
  Search, 
  MapPin, 
  Phone, 
  Mail, 
  Building, 
  FileText, 
  MessageSquareQuote,
  Activity,
  CreditCard,
  Edit,
  Trash2
} from 'lucide-react';
import { 
  Drawer, 
  DrawerContent, 
  DrawerHeader, 
  DrawerTitle
} from '../../components/ui/drawer';
import { cn } from '../../lib/utils';

// Helper for formatting date
const formatDate = (dateStr: any) => {
  if (!dateStr) return '';
  const d = new Date(typeof dateStr.toDate === 'function' ? dateStr.toDate() : dateStr);
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
};

export default function Customers() {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const data = await getCustomers(user.uid);
      setCustomers(data);
      setLoading(false);
    }
    load();
  }, [user]);

  const filteredCustomers = useMemo(() => {
    if (!search) return customers;
    const lower = search.toLowerCase();
    return customers.filter(c => 
      c.name.toLowerCase().includes(lower) || 
      (c.email && c.email.toLowerCase().includes(lower))
    );
  }, [customers, search]);

  const handleOpenProfile = (customer: Customer) => {
    setSelectedCustomer(customer);
    setIsCreating(false);
    setIsDrawerOpen(true);
  };

  const handleCreateNew = () => {
    setSelectedCustomer(null);
    setIsCreating(true);
    setIsDrawerOpen(true);
  };

  const handleSave = async (updated: Customer) => {
    if (!user) return;
    const saved = await saveCustomer(updated);
    setCustomers(prev => {
      const idx = prev.findIndex(c => c.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev].sort((a, b) => a.name.localeCompare(b.name));
    });
    if (isCreating) {
      setSelectedCustomer(saved);
      setIsCreating(false);
    } else {
      setSelectedCustomer(saved);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteCustomer(id);
    setCustomers(prev => prev.filter(c => c.id !== id));
    setIsDrawerOpen(false);
  };

  return (
    <div className="h-full bg-subtle">
      <div className="max-w-7xl mx-auto space-y-6 pb-8">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-primary">Customers</h1>
            <p className="text-secondary text-sm mt-1">Manage your client relationships and history</p>
          </div>
          <Button onClick={handleCreateNew} className="gap-2 shrink-0">
            <Plus className="w-4 h-4" />
            New Customer
          </Button>
        </header>

        <div className="flex items-center relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 text-secondary" />
          <Input 
            placeholder="Search customers..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="py-12 flex justify-center"><Activity className="w-6 h-6 text-secondary animate-spin" /></div>
        ) : filteredCustomers.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-12 flex flex-col items-center justify-center text-center">
            <Building className="w-12 h-12 text-secondary/40 mb-4" />
            <p className="text-primary font-medium">No customers found</p>
            <p className="text-secondary text-sm mt-1 mb-6 max-w-md">
              {search ? "We couldn't find any customers matching your search." : "You haven't added any customers yet. Add your first customer to start tracking invoices and payments."}
            </p>
            {!search && (
              <Button onClick={handleCreateNew} variant="outline" className="gap-2">
                <Plus className="w-4 h-4" />
                Add Customer
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredCustomers.map(customer => (
              <Card 
                key={customer.id} 
                className="cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => handleOpenProfile(customer)}
              >
                <div className="p-5 flex flex-col h-full">
                  <div className="flex-1 mb-4">
                    <h3 className="text-base font-medium text-primary line-clamp-1">{customer.name}</h3>
                    {customer.email && <p className="text-sm text-secondary line-clamp-1 mt-0.5">{customer.email}</p>}
                  </div>
                  <div className="pt-4 border-t border-border flex items-center justify-between text-sm">
                    <div className="flex flex-col">
                      <span className="text-secondary text-xs">Outstanding</span>
                      <span className="font-medium text-primary">
                        ${(customer.outstandingBalance || 0).toFixed(2)}
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-secondary text-xs">Lifetime</span>
                      <span className="font-medium text-primary">
                        ${(customer.totalBilled || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DrawerContent className="sm:max-w-xl p-0 flex flex-col overflow-hidden bg-surface">
          {isDrawerOpen && (
            <CustomerProfile 
              customer={selectedCustomer} 
              isCreating={isCreating}
              onSave={handleSave}
              onDelete={handleDelete}
              onClose={() => setIsDrawerOpen(false)}
            />
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

// --------------------------------------------------------
// Customer Profile Component (used inside the Drawer)
// --------------------------------------------------------
function CustomerProfile({ 
  customer, 
  isCreating,
  onSave,
  onDelete,
  onClose
}: { 
  customer: Customer | null;
  isCreating: boolean;
  onSave: (c: Customer) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [mode, setMode] = useState<'view' | 'edit'>(isCreating ? 'edit' : 'view');
  const [activeTab, setActiveTab] = useState<'activity' | 'notes' | 'details'>('activity');
  
  const [formData, setFormData] = useState<Partial<Customer>>(customer || {
    name: '',
    email: '',
    phone: '',
    billingAddress: '',
    taxId: '',
    notes: ''
  });

  const [activity, setActivity] = useState<{ invoices: Invoice[], quotes: Quote[], payments: Payment[] } | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);

  // Compute stats on the fly from activity if available, else fallback to denormalized
  const lifetimeValue = useMemo(() => {
    if (!activity) return customer?.totalBilled || 0;
    // Lifetime value is the sum of all actual payments received
    return activity.payments.reduce((acc, p) => acc + p.amount, 0);
  }, [activity, customer]);

  const outstanding = useMemo(() => {
    if (!activity) return customer?.outstandingBalance || 0;
    // Outstanding balance is the sum of balanceDue (or total if undefined) for unpaid invoices
    return activity.invoices
      .filter(i => ['pending', 'partially_paid', 'overdue'].includes(i.status))
      .reduce((acc, inv) => acc + (inv.balanceDue ?? inv.total), 0);
  }, [activity, customer]);

  // Keep refs for unmount autosave
  const notesRef = useRef(formData.notes);
  const customerRef = useRef(customer);
  const modeRef = useRef(mode);

  useEffect(() => { notesRef.current = formData.notes; }, [formData.notes]);
  useEffect(() => { customerRef.current = customer; }, [customer]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Unmount effect for auto-saving notes if the drawer is closed quickly
  useEffect(() => {
    return () => {
      if (modeRef.current === 'view' && customerRef.current) {
        if (notesRef.current !== customerRef.current.notes) {
          saveCustomer({ ...customerRef.current, notes: notesRef.current }).catch(console.warn);
        }
      }
    };
  }, []);

  useEffect(() => {
    if (mode === 'view' && customer && user) {
      setActivityLoading(true);
      getCustomerActivity(user.uid, customer.id).then(data => {
        setActivity(data);
        setActivityLoading(false);
      });
    }
  }, [mode, customer, user]);

  const handleChange = (field: keyof Customer, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(formData as Customer);
    setMode('view');
  };

  const handleNotesSave = () => {
    onSave({ ...customer!, notes: formData.notes });
  };

  // Compile timeline from invoices, quotes, payments
  const timeline = useMemo(() => {
    if (!activity) return [];
    const items: Array<{ id: string; type: string; title: string; date: string; amount?: number; status?: string }> = [];
    
    activity.invoices.forEach(inv => {
      items.push({
        id: `inv_${inv.id}`,
        type: 'invoice',
        title: `Invoice #${inv.invoiceNumber}`,
        date: inv.createdAt || inv.issueDate,
        amount: inv.total,
        status: inv.status
      });
    });
    
    activity.quotes.forEach(q => {
      items.push({
        id: `q_${q.id}`,
        type: 'quote',
        title: `Quote #${q.quoteNumber}`,
        date: q.createdAt || q.issueDate,
        amount: q.total,
        status: q.status
      });
    });
    
    activity.payments.forEach(p => {
      items.push({
        id: `p_${p.id}`,
        type: 'payment',
        title: `Payment Received (${p.method})`,
        date: p.createdAt || p.date,
        amount: p.amount
      });
    });

    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [activity]);

  if (mode === 'edit') {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <DrawerHeader className="shrink-0 px-6 py-4 border-b border-border mb-0">
          <DrawerTitle>{isCreating ? 'New Customer' : 'Edit Customer'}</DrawerTitle>
        </DrawerHeader>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Company / Name <span className="text-rose-500">*</span></label>
            <Input 
              value={formData.name || ''} 
              onChange={e => handleChange('name', e.target.value)}
              placeholder="Acme Corporation"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Email</label>
            <Input 
              type="email"
              value={formData.email || ''} 
              onChange={e => handleChange('email', e.target.value)}
              placeholder="billing@acme.com"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Phone</label>
            <Input 
              value={formData.phone || ''} 
              onChange={e => handleChange('phone', e.target.value)}
              placeholder="+1 (555) 000-0000"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Tax ID (Optional)</label>
            <Input 
              value={formData.taxId || ''} 
              onChange={e => handleChange('taxId', e.target.value)}
              placeholder="e.g. EU123456789"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Billing Address</label>
            <textarea 
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              value={formData.billingAddress || ''} 
              onChange={e => handleChange('billingAddress', e.target.value)}
              placeholder="123 Business Rd&#10;Suite 100&#10;City, State 12345"
            />
          </div>
        </div>
        <div className="shrink-0 p-6 border-t border-border flex items-center justify-between bg-surface">
          {!isCreating && (
            <Button variant="ghost" className="text-rose-600 hover:text-rose-700 hover:bg-rose-50" onClick={() => {
              if (confirm('Are you sure you want to delete this customer?')) {
                onDelete(customer!.id);
              }
            }}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <Button variant="outline" onClick={() => isCreating ? onClose() : setMode('view')}>Cancel</Button>
            <Button onClick={handleSave} disabled={!formData.name}>Save Customer</Button>
          </div>
        </div>
      </div>
    );
  }

  // View Mode
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header Profile Section */}
      <div className="shrink-0 bg-subtle/30 border-b border-border p-6 pt-10 relative">
        <Button 
          variant="ghost" 
          size="icon" 
          className="absolute top-4 right-12 h-8 w-8 text-secondary hover:text-primary"
          onClick={() => setMode('edit')}
        >
          <Edit className="w-4 h-4" />
        </Button>
        <h2 className="text-3xl font-semibold tracking-tight text-primary">{customer?.name}</h2>
        {customer?.email && (
          <p className="text-secondary mt-1">{customer.email}</p>
        )}
        
        <div className="flex items-center gap-8 mt-6">
          <div>
            <p className="text-xs text-secondary uppercase tracking-wider font-medium">Outstanding</p>
            <p className="text-2xl font-medium text-amber-600 mt-1">${outstanding.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-secondary uppercase tracking-wider font-medium">Lifetime Value</p>
            <p className="text-2xl font-medium text-emerald-600 mt-1">${lifetimeValue.toFixed(2)}</p>
          </div>
        </div>
      </div>

      {/* Custom Tabs */}
      <div className="shrink-0 flex items-center border-b border-border px-6">
        {(['activity', 'notes', 'details'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "py-4 px-4 text-sm font-medium border-b-2 transition-colors capitalize",
              activeTab === tab 
                ? "border-primary text-primary" 
                : "border-transparent text-secondary hover:text-primary"
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto bg-surface">
        {activeTab === 'activity' && (
          <div className="p-6">
            {activityLoading ? (
              <div className="py-8 flex justify-center"><Activity className="w-5 h-5 text-secondary animate-spin" /></div>
            ) : timeline.length === 0 ? (
              <div className="py-8 text-center text-secondary text-sm">No activity recorded yet.</div>
            ) : (
              <div className="relative border-l border-border/50 ml-3 space-y-6">
                {timeline.map((item, idx) => {
                  let Icon = FileText;
                  let colorClass = "text-blue-600 bg-blue-100";
                  
                  if (item.type === 'payment') {
                    Icon = CreditCard;
                    colorClass = "text-emerald-600 bg-emerald-100";
                  } else if (item.type === 'quote') {
                    Icon = MessageSquareQuote;
                    colorClass = "text-purple-600 bg-purple-100";
                  }

                  return (
                    <div key={item.id} className="relative pl-6">
                      <div className={cn("absolute -left-3.5 top-0.5 p-1.5 rounded-full ring-4 ring-surface", colorClass)}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-medium text-primary">{item.title}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-secondary">{formatDate(item.date)}</span>
                            {item.status && (
                              <>
                                <span className="text-xs text-secondary/40">•</span>
                                <span className="text-xs text-secondary capitalize">{item.status.replace(/_/g, ' ')}</span>
                              </>
                            )}
                          </div>
                        </div>
                        {item.amount !== undefined && (
                          <span className="text-sm font-medium text-primary">${item.amount.toFixed(2)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'notes' && (
          <div className="p-6 h-full flex flex-col">
            <textarea 
              className="flex-1 min-h-[200px] w-full resize-none rounded-md border border-input bg-transparent px-3 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              placeholder="Add private notes about this customer..."
              value={formData.notes || ''}
              onChange={e => handleChange('notes', e.target.value)}
              onBlur={handleNotesSave}
            />
            <p className="text-xs text-secondary mt-2">Notes are automatically saved when you click away, or when you close this panel.</p>
          </div>
        )}

        {activeTab === 'details' && (
          <div className="p-6 space-y-6">
            <div>
              <h4 className="text-sm font-medium text-primary mb-3">Contact Information</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-secondary shrink-0" />
                  <span className={customer?.email ? "text-primary" : "text-secondary italic"}>{customer?.email || 'No email provided'}</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="w-4 h-4 text-secondary shrink-0" />
                  <span className={customer?.phone ? "text-primary" : "text-secondary italic"}>{customer?.phone || 'No phone provided'}</span>
                </div>
              </div>
            </div>
            
            <div className="pt-6 border-t border-border">
              <h4 className="text-sm font-medium text-primary mb-3">Billing Details</h4>
              <div className="space-y-3">
                <div className="flex items-start gap-3 text-sm">
                  <MapPin className="w-4 h-4 text-secondary shrink-0 mt-0.5" />
                  <span className={customer?.billingAddress ? "text-primary whitespace-pre-wrap" : "text-secondary italic"}>
                    {customer?.billingAddress || 'No billing address provided'}
                  </span>
                </div>
                {customer?.taxId && (
                  <div className="flex items-center gap-3 text-sm pt-2">
                    <span className="text-secondary shrink-0 w-4 text-center font-medium">ID</span>
                    <span className="text-primary">{customer.taxId}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
