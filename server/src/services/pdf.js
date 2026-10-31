import { PDFParse } from 'pdf-parse';
import { normalizeText } from '../utils/normalizeText.js';

/** Extract plain text from a PDF buffer. Throws a 422 error if the PDF has no usable text. */
export async function pdfToText(buffer) {
  const parser = new PDFParse({ data: buffer });
  let text;
  try {
    ({ text } = await parser.getText());
  } catch {
    const err = new Error('Could not read this PDF. Is it a valid, unprotected PDF file?');
    err.status = 422;
    throw err;
  } finally {
    await parser.destroy();
  }

  text = normalizeText(text.replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, '')); // drop pdf-parse page markers

  // Scanned resumes are images: there is no text layer to extract
  if (text.replace(/\s/g, '').length < 100) {
    const err = new Error(
      'Almost no text found in this PDF. It is probably a scanned image — please upload a text-based PDF (e.g. exported from Word or Google Docs).'
    );
    err.status = 422;
    throw err;
  }
  return text;
}
