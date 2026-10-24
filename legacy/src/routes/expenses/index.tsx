import React, { useEffect, useState, useMemo } from 'react';
import { Expense } from '../../types';
import { useAuth } from '../../hooks/use-auth';
import { getExpenses, saveExpense, deleteExpense } from '../../lib/expense-service';
import { storage } from '../../lib/firebase/config';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card } from '../../components/ui/card';
import { 
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
  TableRowActions
} from '../../components/ui/table';
import { 
  Plus, 
  Search, 
  Activity,
  Edit,
  Trash2,
  Receipt,
  Upload,
  Image as ImageIcon
} from 'lucide-react';
import { 
  Drawer, 
  DrawerContent, 
  DrawerHeader, 
  DrawerTitle
} from '../../components/ui/drawer';
import { cn } from '../../lib/utils';
import { format } from 'date-fns';

export default function Expenses() {
  const { user } = useAuth();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const data = await getExpenses(user.uid);
      setExpenses(data);
      setLoading(false);
    }
    load();
  }, [user]);

  const filteredExpenses = useMemo(() => {
    if (!search) return expenses;
    const lower = search.toLowerCase();
    return expenses.filter(e => 
      e.merchant.toLowerCase().includes(lower) || 
      (e.description && e.description.toLowerCase().includes(lower)) ||
      e.category.toLowerCase().includes(lower)
    );
  }, [expenses, search]);

  const handleEdit = (expense: Expense) => {
    setSelectedExpense(expense);
    setIsCreating(false);
    setIsDrawerOpen(true);
  };

  const handleCreateNew = () => {
    setSelectedExpense(null);
    setIsCreating(true);
    setIsDrawerOpen(true);
  };

  const handleSave = async (updated: Expense) => {
    if (!user) return;
    const saved = await saveExpense(updated);
    setExpenses(prev => {
      const idx = prev.findIndex(i => i.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    });
    setIsDrawerOpen(false);
  };

  const handleDelete = async (id: string) => {
    await deleteExpense(id);
    setExpenses(prev => prev.filter(i => i.id !== id));
    setIsDrawerOpen(false);
  };

  return (
    <div className="h-full bg-subtle">
      <div className="max-w-7xl mx-auto space-y-6 pb-8">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-primary">Expenses</h1>
            <p className="text-secondary text-sm mt-1">Track your business purchases and overhead</p>
          </div>
          <Button onClick={handleCreateNew} className="gap-2 shrink-0">
            <Plus className="w-4 h-4" />
            Add Expense
          </Button>
        </header>

        <div className="flex items-center relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 text-secondary" />
          <Input 
            placeholder="Search expenses..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="py-12 flex justify-center"><Activity className="w-6 h-6 text-secondary animate-spin" /></div>
        ) : filteredExpenses.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-12 flex flex-col items-center justify-center text-center">
            <Receipt className="w-12 h-12 text-secondary/40 mb-4" />
            <p className="text-primary font-medium">No expenses found</p>
            <p className="text-secondary text-sm mt-1 mb-6 max-w-md">
              {search ? "We couldn't find any expenses matching your search." : "You haven't recorded any expenses yet. Keep track of your business spending here."}
            </p>
            {!search && (
              <Button onClick={handleCreateNew} variant="outline" className="gap-2">
                <Plus className="w-4 h-4" />
                Record First Expense
              </Button>
            )}
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredExpenses.map(expense => (
                  <TableRow key={expense.id} className="group cursor-pointer" onClick={() => handleEdit(expense)}>
                    <TableCell>
                      <span className="text-primary font-medium">{format(new Date(expense.date), 'MMM d, yyyy')}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-primary">{expense.merchant}</span>
                        {expense.description && (
                          <span className="text-xs text-secondary truncate max-w-xs">{expense.description}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary/10 text-secondary capitalize">
                        {expense.category}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium text-primary">${(expense.amount || 0).toFixed(2)}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <TableRowActions className="justify-end">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(expense);
                          }}
                        >
                          <Edit className="w-4 h-4 text-secondary" />
                        </Button>
                      </TableRowActions>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <DrawerContent className="sm:max-w-md p-0 flex flex-col overflow-hidden bg-surface">
          {isDrawerOpen && (
            <ExpenseDrawer 
              expense={selectedExpense} 
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
// Expense Drawer Component
// --------------------------------------------------------
function ExpenseDrawer({ 
  expense, 
  isCreating,
  onSave,
  onDelete,
  onClose
}: { 
  expense: Expense | null;
  isCreating: boolean;
  onSave: (e: Expense) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [formData, setFormData] = useState<Partial<Expense>>(expense || {
    merchant: '',
    category: 'general',
    description: '',
    amount: 0,
    date: new Date().toISOString().split('T')[0]
  });

  const handleChange = (field: keyof Expense, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !storage) return;

    // We can generate a temporary ID for the expense if it's new
    const expenseId = expense?.id || `exp_${Date.now()}`;
    
    // Create the file metadata
    const metadata = {
      contentType: file.type
    };

    // Upload file and metadata to the object 'receipts/{userId}/{expenseId}/{filename}'
    const storageRef = ref(storage, `receipts/${user.uid}/${expenseId}/${file.name}`);
    const uploadTask = uploadBytesResumable(storageRef, file, metadata);

    setIsUploading(true);

    uploadTask.on('state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(progress);
      }, 
      (error) => {
        console.error('Upload failed:', error);
        setIsUploading(false);
      }, 
      () => {
        getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
          handleChange('receiptUrl', downloadURL);
          // If we created a temporary ID for a new expense, save it to formData
          if (!formData.id && !expense) {
            handleChange('id', expenseId);
          }
          setIsUploading(false);
        });
      }
    );
  };

  const handleSave = () => {
    onSave(formData as Expense);
  };

  const confirmDelete = () => {
    if (expense) onDelete(expense.id);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <DrawerHeader className="shrink-0 px-6 py-4 border-b border-border mb-0">
        <DrawerTitle>{isCreating ? 'Record Expense' : 'Edit Expense'}</DrawerTitle>
      </DrawerHeader>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Merchant <span className="text-rose-500">*</span></label>
            <Input 
              value={formData.merchant || ''} 
              onChange={e => handleChange('merchant', e.target.value)}
              placeholder="e.g., Apple Store, AWS, Upwork"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-primary">Amount <span className="text-rose-500">*</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary">$</span>
                <Input 
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.amount} 
                  onChange={e => handleChange('amount', parseFloat(e.target.value) || 0)}
                  className="pl-7"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-primary">Date <span className="text-rose-500">*</span></label>
              <Input 
                type="date"
                value={formData.date?.split('T')[0] || ''} 
                onChange={e => handleChange('date', e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Category</label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={formData.category}
              onChange={e => handleChange('category', e.target.value)}
            >
              <option value="general">General</option>
              <option value="software">Software & Subscriptions</option>
              <option value="equipment">Equipment</option>
              <option value="travel">Travel</option>
              <option value="marketing">Marketing</option>
              <option value="office">Office Supplies</option>
              <option value="meals">Meals & Entertainment</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Description (Optional)</label>
            <textarea 
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={formData.description || ''} 
              onChange={e => handleChange('description', e.target.value)}
              placeholder="What was this for?"
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Receipt (Optional)</label>
            
            {formData.receiptUrl ? (
              <div className="relative border border-border rounded-lg p-2 flex items-center justify-between">
                 <div className="flex items-center gap-2 truncate">
                   <Receipt className="w-4 h-4 text-secondary shrink-0" />
                   <a href={formData.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline truncate">View Receipt</a>
                 </div>
                 <Button variant="ghost" size="sm" onClick={() => handleChange('receiptUrl', null)} className="h-8 text-rose-500 hover:text-rose-600">Remove</Button>
              </div>
            ) : (
              <label className="border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-subtle transition-colors relative">
                {isUploading ? (
                  <div className="flex flex-col items-center w-full max-w-[200px]">
                     <Activity className="w-8 h-8 text-secondary/50 mb-2 animate-spin" />
                     <div className="w-full bg-border rounded-full h-2 mt-2">
                       <div className="bg-primary h-2 rounded-full" style={{ width: `${uploadProgress}%` }}></div>
                     </div>
                     <p className="text-xs text-secondary mt-2">Uploading... {Math.round(uploadProgress)}%</p>
                  </div>
                ) : (
                  <>
                    <input type="file" className="hidden" accept="image/jpeg,image/png,application/pdf" onChange={handleFileChange} />
                    <Upload className="w-8 h-8 text-secondary/50 mb-2" />
                    <p className="text-sm text-primary font-medium">Click to Upload Receipt</p>
                    <p className="text-xs text-secondary mt-1">JPEG, PNG, or PDF</p>
                  </>
                )}
              </label>
            )}
          </div>
        </div>
      </div>
      <div className="shrink-0 p-6 border-t border-border flex items-center justify-between bg-surface">
        {!isCreating && (
          <Button 
            variant="ghost" 
            className="text-rose-600 hover:text-rose-700 hover:bg-rose-50" 
            onClick={confirmDelete}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </Button>
        )}
        <div className={cn("flex items-center gap-2", isCreating ? "ml-auto" : "ml-auto")}>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!formData.merchant || !formData.amount || !formData.date}>Save Expense</Button>
        </div>
      </div>
    </div>
  );
}
