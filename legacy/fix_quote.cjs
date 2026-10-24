const fs = require('fs');
let code = fs.readFileSync('src/features/quotes/components/quote-builder.tsx', 'utf8');
code = code.replace(`import { getCustomers }
import { getItems } from "../../../lib/item-service"; from '../../../lib/invoice-service';`, 
`import { getCustomers } from '../../../lib/invoice-service';
import { getItems } from '../../../lib/item-service';`);
fs.writeFileSync('src/features/quotes/components/quote-builder.tsx', code);
