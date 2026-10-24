import React, { useEffect, useState, useMemo } from 'react';
import { Item } from '../../types';
import { useAuth } from '../../hooks/use-auth';
import { getItems, saveItem, deleteItem, checkItemUsage } from '../../lib/item-service';
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
  Package,
  Wrench,
  AlertTriangle
} from 'lucide-react';
import { 
  Drawer, 
  DrawerContent, 
  DrawerHeader, 
  DrawerTitle
} from '../../components/ui/drawer';
import { cn } from '../../lib/utils';

export default function Items() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    async function load() {
      if (!user) return;
      const data = await getItems(user.uid);
      setItems(data);
      setLoading(false);
    }
    load();
  }, [user]);

  const filteredItems = useMemo(() => {
    if (!search) return items;
    const lower = search.toLowerCase();
    return items.filter(i => 
      i.name.toLowerCase().includes(lower) || 
      (i.description && i.description.toLowerCase().includes(lower))
    );
  }, [items, search]);

  const handleEdit = (item: Item) => {
    setSelectedItem(item);
    setIsCreating(false);
    setIsDrawerOpen(true);
  };

  const handleCreateNew = () => {
    setSelectedItem(null);
    setIsCreating(true);
    setIsDrawerOpen(true);
  };

  const handleSave = async (updated: Item) => {
    if (!user) return;
    const saved = await saveItem(updated);
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev].sort((a, b) => a.name.localeCompare(b.name));
    });
    setIsDrawerOpen(false);
  };

  const handleDelete = async (id: string) => {
    await deleteItem(id);
    setItems(prev => prev.filter(i => i.id !== id));
    setIsDrawerOpen(false);
  };

  return (
    <div className="h-full bg-subtle">
      <div className="max-w-7xl mx-auto space-y-6 pb-8">
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-primary">Items</h1>
            <p className="text-secondary text-sm mt-1">Manage your catalog of products and services</p>
          </div>
          <Button onClick={handleCreateNew} className="gap-2 shrink-0">
            <Plus className="w-4 h-4" />
            New Item
          </Button>
        </header>

        <div className="flex items-center relative max-w-md">
          <Search className="w-4 h-4 absolute left-3 text-secondary" />
          <Input 
            placeholder="Search catalog..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {loading ? (
          <div className="py-12 flex justify-center"><Activity className="w-6 h-6 text-secondary animate-spin" /></div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-12 flex flex-col items-center justify-center text-center">
            <Package className="w-12 h-12 text-secondary/40 mb-4" />
            <p className="text-primary font-medium">No items found</p>
            <p className="text-secondary text-sm mt-1 mb-6 max-w-md">
              {search ? "We couldn't find any items matching your search." : "Your catalog is empty. Add your first product or service to easily reuse it in invoices and quotes."}
            </p>
            {!search && (
              <Button onClick={handleCreateNew} variant="outline" className="gap-2">
                <Plus className="w-4 h-4" />
                Add Item
              </Button>
            )}
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40%]">Item Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map(item => (
                  <TableRow key={item.id} className="group cursor-pointer" onClick={() => handleEdit(item)}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-primary">{item.name}</span>
                        {item.description && (
                          <span className="text-xs text-secondary truncate max-w-xs">{item.description}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium capitalize",
                        item.type === 'service' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'
                      )}>
                        {item.type === 'service' ? <Wrench className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                        {item.type}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-medium text-primary">${(item.unitPrice || 0).toFixed(2)}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <TableRowActions className="justify-end">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEdit(item);
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
            <ItemDrawer 
              item={selectedItem} 
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
// Item Drawer Component
// --------------------------------------------------------
function ItemDrawer({ 
  item, 
  isCreating,
  onSave,
  onDelete,
  onClose
}: { 
  item: Item | null;
  isCreating: boolean;
  onSave: (i: Item) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [formData, setFormData] = useState<Partial<Item>>(item || {
    name: '',
    type: 'product',
    description: '',
    unitPrice: 0,
    isTaxable: true
  });

  const [checkingUsage, setCheckingUsage] = useState(false);
  const [usage, setUsage] = useState<{ invoiceCount: number, quoteCount: number } | null>(null);

  const handleChange = (field: keyof Item, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(formData as Item);
  };

  const initiateDelete = async () => {
    if (!item || !user) return;
    setCheckingUsage(true);
    const result = await checkItemUsage(user.uid, item.id);
    setUsage(result);
    setCheckingUsage(false);
  };

  const confirmDelete = () => {
    if (item) onDelete(item.id);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <DrawerHeader className="shrink-0 px-6 py-4 border-b border-border mb-0">
        <DrawerTitle>{isCreating ? 'New Item' : 'Edit Item'}</DrawerTitle>
      </DrawerHeader>
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {usage && (
          <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-amber-800">Confirm Deletion</h4>
              <p className="text-xs text-amber-700 mt-1">
                {usage.invoiceCount === 0 && usage.quoteCount === 0 
                  ? "This item is not currently used in any invoices or quotes." 
                  : `This item has been used in ${usage.invoiceCount} invoices and ${usage.quoteCount} quotes.`}
                {' '}Deleting this item from your catalog will not change past invoices or quotes, but it will no longer be available for new ones.
              </p>
              <div className="flex items-center gap-3 mt-4">
                <Button variant="outline" size="sm" onClick={() => setUsage(null)}>Cancel</Button>
                <Button variant="destructive" size="sm" onClick={confirmDelete}>Yes, Delete Item</Button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-4" style={{ display: usage ? 'none' : 'block' }}>
          <div className="flex items-center gap-4 bg-subtle p-1 rounded-lg w-full max-w-[240px]">
            <button
              className={cn(
                "flex-1 text-sm font-medium py-1.5 rounded-md transition-colors",
                formData.type === 'product' ? "bg-surface text-primary shadow-sm" : "text-secondary hover:text-primary"
              )}
              onClick={() => handleChange('type', 'product')}
            >
              Product
            </button>
            <button
              className={cn(
                "flex-1 text-sm font-medium py-1.5 rounded-md transition-colors",
                formData.type === 'service' ? "bg-surface text-primary shadow-sm" : "text-secondary hover:text-primary"
              )}
              onClick={() => handleChange('type', 'service')}
            >
              Service
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Item Name <span className="text-rose-500">*</span></label>
            <Input 
              value={formData.name || ''} 
              onChange={e => handleChange('name', e.target.value)}
              placeholder="e.g., Website Redesign"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Price</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-secondary">$</span>
              <Input 
                type="number"
                min="0"
                step="0.01"
                value={formData.unitPrice} 
                onChange={e => handleChange('unitPrice', parseFloat(e.target.value) || 0)}
                className="pl-7"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Description (Optional)</label>
            <textarea 
              className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={formData.description || ''} 
              onChange={e => handleChange('description', e.target.value)}
              placeholder="Appears on invoices and quotes"
            />
          </div>
          
          <div className="pt-2">
            <label className="flex items-center gap-3 cursor-pointer">
              <input 
                type="checkbox" 
                checked={!!formData.isTaxable}
                onChange={(e) => handleChange('isTaxable', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
              <div>
                <p className="text-sm font-medium text-primary">Taxable Item</p>
                <p className="text-xs text-secondary mt-0.5">Apply default tax rate to this item</p>
              </div>
            </label>
          </div>
        </div>
      </div>
      {!usage && (
        <div className="shrink-0 p-6 border-t border-border flex items-center justify-between bg-surface">
          {!isCreating && (
            <Button 
              variant="ghost" 
              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50" 
              onClick={initiateDelete}
              disabled={checkingUsage}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete
            </Button>
          )}
          <div className={cn("flex items-center gap-2", isCreating ? "ml-auto" : "ml-auto")}>
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSave} disabled={!formData.name}>Save Item</Button>
          </div>
        </div>
      )}
    </div>
  );
}
