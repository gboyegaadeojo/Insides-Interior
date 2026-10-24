const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const importsToAdd = `
import Expenses from './routes/expenses/index';
import Payments from './routes/payments/index';
`;

code = code.replace("import Settings from './routes/settings/index';", "import Settings from './routes/settings/index';" + importsToAdd);

const routesToAdd = `
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/payments" element={<Payments />} />
`;

code = code.replace('<Route path="/items/new" element={<Items />} />', '<Route path="/items/new" element={<Items />} />' + routesToAdd);

fs.writeFileSync('src/App.tsx', code);
