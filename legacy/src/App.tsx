import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './hooks/use-auth';
import { ProtectedRoute } from './components/layout/protected-route';
import AppShell from './components/layout/app-shell';
import Login from './routes/auth/login';
import Register from './routes/auth/register';
import Dashboard from './routes/dashboard/index';
import DesignSystem from './routes/design-system';
import Invoices from './routes/invoices/index';
import PublicClientInvoiceView from './routes/invoices/public-client-view';
import Quotes from './routes/quotes/index';
import { PublicClientQuoteView } from './routes/quotes/public-client-view';
import Customers from './routes/customers/index';
import Items from './routes/items/index';
import Reports from './routes/reports/index';
import Settings from './routes/settings/index';
import Expenses from './routes/expenses/index';
import Payments from './routes/payments/index';


export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Standalone Public Client Views (NO App Shell, NO Auth Guard) */}
          <Route path="/i/:shareToken" element={<PublicClientInvoiceView />} />
          <Route path="/q/:shareToken" element={<PublicClientQuoteView />} />

          {/* Public Auth Routes */}
          <Route element={<ProtectedRoute requireAuth={false} />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Route>

          {/* Protected Owner Routes */}
          <Route element={<ProtectedRoute requireAuth={true} />}>
            <Route element={<AppShell />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/invoices/new" element={<Invoices />} />
              <Route path="/invoices/:id/edit" element={<Invoices />} />
              <Route path="/quotes" element={<Quotes />} />
              <Route path="/quotes/new" element={<Quotes />} />
              <Route path="/quotes/:id/edit" element={<Quotes />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/customers/new" element={<Customers />} />
              <Route path="/items" element={<Items />} />
              <Route path="/items/new" element={<Items />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/payments" element={<Payments />} />

              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/design" element={<DesignSystem />} />
            </Route>
          </Route>

          {/* Redirect root to dashboard (which will redirect to login if unauth) */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
