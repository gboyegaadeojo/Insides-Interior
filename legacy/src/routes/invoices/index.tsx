import React from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { InvoiceList } from '../../features/invoices/components/invoice-list';
import { InvoiceBuilder } from '../../features/invoices/components/invoice-builder';

export default function InvoicesPage() {
  const location = useLocation();
  const { id } = useParams();

  const isBuilder = location.pathname.includes('/new') || Boolean(id);

  if (isBuilder) {
    return <InvoiceBuilder />;
  }

  return <InvoiceList />;
}
