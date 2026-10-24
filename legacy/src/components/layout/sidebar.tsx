import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FileText, FileSignature, Users, Package, PieChart, Settings as SettingsIcon, Receipt, Banknote } from 'lucide-react';
import { cn } from '../../lib/utils';

const navItems = [
  { name: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { name: 'Invoices', to: '/invoices', icon: FileText },
  { name: 'Quotes', to: '/quotes', icon: FileSignature },
  { name: 'Customers', to: '/customers', icon: Users },
  { name: 'Items', to: '/items', icon: Package },
  { name: 'Expenses', to: '/expenses', icon: Receipt },
  { name: 'Payments', to: '/payments', icon: Banknote },
];

interface SidebarProps {
  onOpenSettings: () => void;
}

export default function Sidebar({ onOpenSettings }: SidebarProps) {
  return (
    <>
      {/* Desktop & Tablet Sidebar */}
      <aside className="hidden md:flex flex-col border-r border-border bg-surface w-16 lg:w-60 shrink-0 transition-all duration-300">
        <div className="h-16 flex items-center justify-center lg:justify-start lg:px-6 border-b border-border">
          <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center shrink-0">
            <span className="text-primary-foreground font-bold text-lg leading-none">I</span>
          </div>
          <span className="ml-3 font-semibold text-lg hidden lg:block truncate">InvoiceOS</span>
        </div>
        
        <nav className="flex-1 overflow-y-auto py-4 px-2 lg:px-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.name}
              to={item.to}
              className={({ isActive }) => cn(
                "flex items-center justify-center lg:justify-start gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive ? "bg-subtle text-primary" : "text-secondary hover:bg-subtle hover:text-primary"
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span className="hidden lg:block truncate">{item.name}</span>
            </NavLink>
          ))}
          <NavLink
            to="/reports"
            className={({ isActive }) => cn(
              "flex items-center justify-center lg:justify-start gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "bg-subtle text-primary" : "text-secondary hover:bg-subtle hover:text-primary"
            )}
          >
            <PieChart className="h-5 w-5 shrink-0" />
            <span className="hidden lg:block truncate">Reports</span>
          </NavLink>
        </nav>

        <div className="p-2 lg:p-3 border-t border-border">
          <button
            onClick={onOpenSettings}
            className="flex w-full items-center justify-center lg:justify-start gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors text-secondary hover:bg-subtle hover:text-primary"
          >
            <SettingsIcon className="h-5 w-5 shrink-0" />
            <span className="hidden lg:block truncate">Settings</span>
          </button>
        </div>
      </aside>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-surface border-t border-border flex items-center justify-around px-2 z-50">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.to}
            className={({ isActive }) => cn(
              "flex flex-col items-center justify-center w-full h-full space-y-1",
              isActive ? "text-primary" : "text-secondary hover:text-primary"
            )}
          >
            <item.icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{item.name}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
