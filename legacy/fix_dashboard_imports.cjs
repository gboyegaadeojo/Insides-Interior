const fs = require('fs');
let code = fs.readFileSync('src/routes/dashboard/index.tsx', 'utf8');

code = code.replace("import { getInvoices, getAllPayments, getAllExpenses, getActivityLogs, Expense } from '../../lib/invoice-service';",
"import { getInvoices, getAllPayments, getActivityLogs } from '../../lib/invoice-service';\nimport { getExpenses } from '../../lib/expense-service';\nimport { Expense } from '../../types';");

code = code.replace("getAllExpenses(userId),", "getExpenses(userId),");
fs.writeFileSync('src/routes/dashboard/index.tsx', code);
