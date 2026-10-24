import React from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { QuoteList } from '../../features/quotes/components/quote-list';
import { QuoteBuilder } from '../../features/quotes/components/quote-builder';

export default function QuotesPage() {
  const location = useLocation();
  const { id } = useParams();

  const isBuilder = location.pathname.includes('/new') || Boolean(id);

  if (isBuilder) {
    return <QuoteBuilder />;
  }

  return <QuoteList />;
}
