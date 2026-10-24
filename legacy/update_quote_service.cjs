const fs = require('fs');

let content = fs.readFileSync('src/lib/quote-service.ts', 'utf8');

content = content.replace(
  `import { saveInvoice } from './invoice-service';`,
  `import { saveInvoice, logActivity } from './invoice-service';`
);

// Add logging to saveQuote
content = content.replace(
  `  setLocalData(LOCAL_QUOTES_KEY, local);\n\n  return completeQuote;\n}`,
  `  setLocalData(LOCAL_QUOTES_KEY, local);

  await logActivity({
    userId: currentUserId,
    entityType: 'quote',
    entityId: completeQuote.id,
    action: isEdit ? 'updated' : 'created',
    description: isEdit
      ? \`Updated quote \${completeQuote.quoteNumber} (Status: \${completeQuote.status})\`
      : \`Created quote \${completeQuote.quoteNumber}\`
  });

  return completeQuote;
}`
);

// Add logging to sendQuoteForApproval
content = content.replace(
  `  return { quote: updatedQuote, shareUrl };\n}`,
  `  await logActivity({
    userId: currentUserId,
    entityType: 'quote',
    entityId: updatedQuote.id,
    action: 'sent_for_approval',
    description: \`Sent quote \${updatedQuote.quoteNumber} to client\`
  });

  return { quote: updatedQuote, shareUrl };
}`
);

// Add logging to clientRequestQuoteChanges
content = content.replace(
  `    local[idx].updatedAt = nowStr;
    setLocalData(LOCAL_QUOTES_KEY, local);
  }
}`,
  `    local[idx].updatedAt = nowStr;
    setLocalData(LOCAL_QUOTES_KEY, local);
  }
  await logActivity({
    userId: quote.userId,
    entityType: 'quote',
    entityId: quote.id,
    action: 'changes_requested',
    description: \`Client requested changes for Quote #\${quote.quoteNumber}\`
  });
}`
);

// Add logging to deleteQuote
content = content.replace(
  `  setLocalData(LOCAL_QUOTES_KEY, updated);
}`,
  `  setLocalData(LOCAL_QUOTES_KEY, updated);
  
  await logActivity({
    userId: currentUserId || 'demo_user',
    entityType: 'quote',
    entityId: id,
    action: 'deleted',
    description: \`Quote \${id} was permanently deleted.\`
  });
}`
);

fs.writeFileSync('src/lib/quote-service.ts', content);
