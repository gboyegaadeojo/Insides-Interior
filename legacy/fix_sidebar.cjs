const fs = require('fs');
let code = fs.readFileSync('src/components/layout/sidebar.tsx', 'utf8');
code = code.replace("import { LayoutDashboard, FileText, FileSignature, Users, Package, PieChart, Settings as SettingsIcon } from 'lucide-react';", 
"import { LayoutDashboard, FileText, FileSignature, Users, Package, PieChart, Settings as SettingsIcon, Receipt, Banknote } from 'lucide-react';");

const newNavItems = `const navItems = [
  { name: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { name: 'Invoices', to: '/invoices', icon: FileText },
  { name: 'Quotes', to: '/quotes', icon: FileSignature },
  { name: 'Customers', to: '/customers', icon: Users },
  { name: 'Items', to: '/items', icon: Package },
  { name: 'Expenses', to: '/expenses', icon: Receipt },
  { name: 'Payments', to: '/payments', icon: Banknote },
];`;

code = code.replace(/const navItems = \[\s*\{ name: 'Dashboard'[\s\S]*?\];/, newNavItems);
fs.writeFileSync('src/components/layout/sidebar.tsx', code);
