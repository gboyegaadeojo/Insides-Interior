import React, { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Plus, LogOut } from 'lucide-react';
import { Button } from '../ui/button';
import { useAuth } from '../../hooks/use-auth';

interface TopbarProps {
  onOpenCommandPalette: () => void;
}

export default function Topbar({ onOpenCommandPalette }: TopbarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, displayName, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // Create breadcrumb from pathname
  const pathnames = location.pathname.split('/').filter(x => x);
  const title = pathnames.length > 0 
    ? pathnames[0].charAt(0).toUpperCase() + pathnames[0].slice(1)
    : 'Dashboard';

  const handleQuickAdd = () => {
    switch(title.toLowerCase()) {
      case 'invoices':
        navigate('/invoices/new');
        break;
      case 'quotes':
        navigate('/quotes/new');
        break;
      case 'customers':
        navigate('/customers/new');
        break;
      case 'items':
        navigate('/items/new');
        break;
      default:
        onOpenCommandPalette();
    }
  };

  const initial = (displayName || user?.email || 'U').charAt(0).toUpperCase();

  return (
    <header className="h-16 flex items-center justify-between px-4 md:px-8 border-b border-border bg-surface shrink-0">
      <div className="flex items-center">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      </div>

      <div className="flex items-center gap-2 md:gap-4">
        <Button 
          variant="outline" 
          className="hidden md:flex text-secondary hover:text-primary w-64 justify-start text-sm"
          onClick={onOpenCommandPalette}
        >
          <Search className="mr-2 h-4 w-4" />
          <span>Search...</span>
          <kbd className="ml-auto pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border border-border bg-subtle px-1.5 font-mono text-[10px] font-medium text-secondary opacity-100">
            <span className="text-xs">⌘</span>K
          </kbd>
        </Button>
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onOpenCommandPalette}>
          <Search className="h-5 w-5" />
        </Button>

        <Button size="icon" className="rounded-full h-8 w-8" onClick={handleQuickAdd}>
          <Plus className="h-4 w-4" />
        </Button>

        <div className="relative ml-2" ref={menuRef}>
          <button 
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <span className="text-xs font-semibold">{initial}</span>
          </button>
          
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-md border border-border bg-surface shadow-lg z-50 overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-subtle">
                {displayName && <p className="text-sm font-semibold text-primary truncate">{displayName}</p>}
                <p className="text-xs text-secondary truncate">{user?.email}</p>
              </div>
              <div className="p-1">
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    signOut();
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-sm text-error hover:bg-error/10 transition-colors text-left"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
