// Photos are shrunk in the browser before upload (owner request: lower storage
// costs): longest side 2000px, JPEG at 82%. A 4–6 MB phone photo becomes a few
// hundred KB and stays sharp enough to read a receipt. PDFs, small files and
// formats the browser can't decode (some HEIC) go up unchanged.

const MAX_SIDE = 2000;
const QUALITY = 0.82;
/** Under this, a file is left alone. */
const SMALL = 400 * 1024;

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml" || file.size <= SMALL) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return file;
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return file;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob || blob.size >= file.size) return file;
  const name = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
}

/**
 * For a plain `<input type="file">` in a form: replaces the chosen photo with
 * the shrunk one before the form is submitted.
 */
export async function shrinkInputFile(event: React.ChangeEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const smaller = await shrinkImage(file);
  if (smaller === file) return;
  const list = new DataTransfer();
  list.items.add(smaller);
  input.files = list.files;
}
