const fs = require('fs');
let code = fs.readFileSync('src/routes/expenses/index.tsx', 'utf8');

// Add imports for storage
code = code.replace("import { getExpenses, saveExpense, deleteExpense } from '../../lib/expense-service';",
"import { getExpenses, saveExpense, deleteExpense } from '../../lib/expense-service';\nimport { storage } from '../../lib/firebase/config';\nimport { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';");

const drawerTop = `
function ExpenseDrawer({ 
  expense, 
  isCreating,
  onSave,
  onDelete,
  onClose
}: { 
  expense: Expense | null;
  isCreating: boolean;
  onSave: (e: Expense) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
`;

code = code.replace(`
function ExpenseDrawer({ 
  expense, 
  isCreating,
  onSave,
  onDelete,
  onClose
}: { 
  expense: Expense | null;
  isCreating: boolean;
  onSave: (e: Expense) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {`.trim(), drawerTop.trim());

const handleUpload = `
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user || !storage) return;

    // We can generate a temporary ID for the expense if it's new
    const expenseId = expense?.id || \`exp_\${Date.now()}\`;
    
    // Create the file metadata
    const metadata = {
      contentType: file.type
    };

    // Upload file and metadata to the object 'receipts/{userId}/{expenseId}/{filename}'
    const storageRef = ref(storage, \`receipts/\${user.uid}/\${expenseId}/\${file.name}\`);
    const uploadTask = uploadBytesResumable(storageRef, file, metadata);

    setIsUploading(true);

    uploadTask.on('state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        setUploadProgress(progress);
      }, 
      (error) => {
        console.error('Upload failed:', error);
        setIsUploading(false);
      }, 
      () => {
        getDownloadURL(uploadTask.snapshot.ref).then((downloadURL) => {
          handleChange('receiptUrl', downloadURL);
          // If we created a temporary ID for a new expense, save it to formData
          if (!formData.id && !expense) {
            handleChange('id', expenseId);
          }
          setIsUploading(false);
        });
      }
    );
  };
`;

code = code.replace("const handleSave = () => {", handleUpload + "\n  const handleSave = () => {");

const receiptUI = `
          <div className="space-y-2">
            <label className="text-sm font-medium text-primary">Receipt (Optional)</label>
            
            {formData.receiptUrl ? (
              <div className="relative border border-border rounded-lg p-2 flex items-center justify-between">
                 <div className="flex items-center gap-2 truncate">
                   <Receipt className="w-4 h-4 text-secondary shrink-0" />
                   <a href={formData.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline truncate">View Receipt</a>
                 </div>
                 <Button variant="ghost" size="sm" onClick={() => handleChange('receiptUrl', null)} className="h-8 text-rose-500 hover:text-rose-600">Remove</Button>
              </div>
            ) : (
              <label className="border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer hover:bg-subtle transition-colors relative">
                {isUploading ? (
                  <div className="flex flex-col items-center w-full max-w-[200px]">
                     <Activity className="w-8 h-8 text-secondary/50 mb-2 animate-spin" />
                     <div className="w-full bg-border rounded-full h-2 mt-2">
                       <div className="bg-primary h-2 rounded-full" style={{ width: \`\${uploadProgress}%\` }}></div>
                     </div>
                     <p className="text-xs text-secondary mt-2">Uploading... {Math.round(uploadProgress)}%</p>
                  </div>
                ) : (
                  <>
                    <input type="file" className="hidden" accept="image/jpeg,image/png,application/pdf" onChange={handleFileChange} />
                    <Upload className="w-8 h-8 text-secondary/50 mb-2" />
                    <p className="text-sm text-primary font-medium">Click to Upload Receipt</p>
                    <p className="text-xs text-secondary mt-1">JPEG, PNG, or PDF</p>
                  </>
                )}
              </label>
            )}
          </div>
`;

code = code.replace(/<div className="space-y-2">\s*<label className="text-sm font-medium text-primary">Receipt \(Optional\)<\/label>[\s\S]*?<\/div>/, receiptUI.trim());

fs.writeFileSync('src/routes/expenses/index.tsx', code);
