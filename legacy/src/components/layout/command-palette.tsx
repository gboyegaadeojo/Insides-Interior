import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '../ui/command';
import { 
  FileText, 
  FileSignature, 
  Users, 
  Package, 
  LayoutDashboard, 
  PieChart, 
  Settings
} from 'lucide-react';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSettings: () => void;
}

export function CommandPalette({ open, onOpenChange, onOpenSettings }: CommandPaletteProps) {
  const navigate = useNavigate();

  const runCommand = (command: () => void) => {
    onOpenChange(false);
    command();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        
        <CommandGroup heading="Create New">
          <CommandItem onSelect={() => runCommand(() => navigate('/invoices/new'))}>
            <FileText className="mr-2 h-4 w-4" />
            <span>Create Invoice</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/quotes/new'))}>
            <FileSignature className="mr-2 h-4 w-4" />
            <span>Create Quote</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/customers/new'))}>
            <Users className="mr-2 h-4 w-4" />
            <span>Add Customer</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/items/new'))}>
            <Package className="mr-2 h-4 w-4" />
            <span>Add Item</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />
        
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => runCommand(() => navigate('/dashboard'))}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            <span>Dashboard</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/invoices'))}>
            <FileText className="mr-2 h-4 w-4" />
            <span>Invoices</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/quotes'))}>
            <FileSignature className="mr-2 h-4 w-4" />
            <span>Quotes</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/customers'))}>
            <Users className="mr-2 h-4 w-4" />
            <span>Customers</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/items'))}>
            <Package className="mr-2 h-4 w-4" />
            <span>Items</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(() => navigate('/reports'))}>
            <PieChart className="mr-2 h-4 w-4" />
            <span>Reports</span>
          </CommandItem>
          <CommandItem onSelect={() => runCommand(onOpenSettings)}>
            <Settings className="mr-2 h-4 w-4" />
            <span>Settings</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
