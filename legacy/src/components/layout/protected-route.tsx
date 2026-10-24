import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../hooks/use-auth';

interface ProtectedRouteProps {
  requireAuth?: boolean;
  redirectTo?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  requireAuth = true, 
  redirectTo = '/login' 
}) => {
  const { user, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-8 h-8 border-4 border-border border-t-primary rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error && requireAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface p-4">
        <div className="p-4 bg-error/10 border border-error/20 rounded-md text-error max-w-md w-full text-center">
          <h3 className="font-semibold mb-2">Authentication Error</h3>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (requireAuth && !user) {
    return <Navigate to={redirectTo} replace />;
  }

  if (!requireAuth && user) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
};
