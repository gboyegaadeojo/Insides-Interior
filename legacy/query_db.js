const project_id = process.env.VITE_FIREBASE_PROJECT_ID;
const api_key = process.env.VITE_FIREBASE_API_KEY;

async function query() {
  const invRes = await fetch(`https://firestore.googleapis.com/v1/projects/${project_id}/databases/(default)/documents/invoices?key=${api_key}`);
  const invData = await invRes.json();
  console.log("INVOICES:", JSON.stringify(invData, null, 2));

  const quoteRes = await fetch(`https://firestore.googleapis.com/v1/projects/${project_id}/databases/(default)/documents/quotes?key=${api_key}`);
  const quoteData = await quoteRes.json();
  console.log("QUOTES:", JSON.stringify(quoteData, null, 2));
}

query().catch(console.error);
