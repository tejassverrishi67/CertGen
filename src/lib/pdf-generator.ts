import JSZip from 'jszip';

/**
 * Converts a DOCX buffer to a PDF buffer using a Gotenberg API endpoint.
 * Gotenberg LibreOffice conversion endpoint accepts multipart/form-data with a "files" field.
 */
export async function convertDocxToPdf(docxBuffer: ArrayBuffer, gotenbergUrl: string, filename: string = 'document.docx'): Promise<ArrayBuffer> {
  const url = new URL('/forms/libreoffice/convert', gotenbergUrl).toString();
  
  const formData = new FormData();
  const blob = new Blob([docxBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  formData.append('files', blob, filename);

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gotenberg conversion failed (${response.status}): ${text}`);
  }

  return await response.arrayBuffer();
}

/**
 * Generates the standardized filename according to the user's constraints:
 * <last 3 digits of DOI>-<Name>-<index>.pdf
 */
export function generateFilename(doi: string, name: string, index: number): string {
  const safeDoi = doi.replace(/[^0-9]/g, '');
  const last3 = safeDoi.slice(-3).padStart(3, '0'); // If less than 3, pad with 0
  const safeName = name.replace(/[^a-zA-Z0-9\s]/g, '').trim().replace(/\s+/g, '_');
  
  return `${last3}-${safeName}-${index}.pdf`;
}

/**
 * Bundles a map of filenames to PDF buffers into a single ZIP file.
 */
export async function bundlePdfsToZip(pdfs: { filename: string; buffer: ArrayBuffer }[]): Promise<ArrayBuffer> {
  const zip = new JSZip();
  
  for (const pdf of pdfs) {
    zip.file(pdf.filename, pdf.buffer);
  }
  
  return await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}
