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
// wait, clientRequestQuoteChanges does batch.commit(). Let's put logActivity AFTER the fallback block.
// Let's find the end of clientRequestQuoteChanges
content = content.replace(
  `    setLocalData(LOCAL_QUOTES_KEY, local);\n  }\n}`,
  `    setLocalData(LOCAL_QUOTES_KEY, local);
  }

  // Also log activity via logActivity if client requested changes
  if (!db) {
     // Wait, logActivity handles fallback internally! So we can just call it unconditionally.
  }
}`
);

fs.writeFileSync('src/lib/quote-service.ts', content);
