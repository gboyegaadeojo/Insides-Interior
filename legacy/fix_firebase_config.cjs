const fs = require('fs');
let code = fs.readFileSync('src/lib/firebase/config.ts', 'utf8');
code = code.replace("import { getFirestore } from 'firebase/firestore';", 
"import { getFirestore } from 'firebase/firestore';\nimport { getStorage } from 'firebase/storage';");

code += "\nexport const storage = app ? getStorage(app) : null;\n";
fs.writeFileSync('src/lib/firebase/config.ts', code);
