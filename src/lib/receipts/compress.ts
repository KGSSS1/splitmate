import { scaledSize } from "./files";

/** WebP where the browser can encode it, else JPEG. */
const OUTPUT_TYPES = ["image/webp", "image/jpeg"] as const;
const QUALITY = 0.82;

/**
 * Browser only: re-encodes a photo of a receipt at most 2000 px on its longest
 * side, to save free-tier storage (SPEC §8). Returns null when the browser
 * can't, or when the result isn't smaller than the original.
 */
export async function compressImage(file: Blob): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  const bitmap = await createImageBitmap(file);
  const { width, height } = scaledSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return null;
  }
  // JPEG has no transparency: paint transparent areas white rather than black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  for (const type of OUTPUT_TYPES) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));
    // Browsers that can't encode a type silently return PNG instead.
    if (blob && blob.type === type) return blob.size < file.size ? blob : null;
  }
  return null;
}
