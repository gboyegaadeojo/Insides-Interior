const fs = require('fs');

let content = fs.readFileSync('src/lib/quote-service.ts', 'utf8');

// Add logging to saveQuote
content = content.replace(
  `  setLocalData(LOCAL_QUOTES_KEY, local);\n  return completeQuote;\n}`,
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

fs.writeFileSync('src/lib/quote-service.ts', content);
