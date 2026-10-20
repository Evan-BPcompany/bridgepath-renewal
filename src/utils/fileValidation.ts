import { randomUUID } from 'crypto';

interface FileValidationResult {
  valid: boolean;
  errors: string[];
}

interface FileSignature {
  mimeType: string;
  extensions: string[];
  // The first bytes of the file.
  magicBytes: number[];
  // Bytes that must be found further in (WEBP: "RIFF", four bytes of size, then "WEBP").
  laterBytes?: Array<{ offset: number; bytes: number[] }>;
}

// PRD FR-2.6: JPG, JPEG, PNG, WEBP and PDF. The type is judged by the content (FR-2.7), never by
// the extension alone.
const ALLOWED_FILE_SIGNATURES: Record<string, FileSignature> = {
  'image/jpeg': {
    mimeType: 'image/jpeg',
    extensions: ['jpg', 'jpeg'],
    magicBytes: [0xff, 0xd8, 0xff]
  },
  'image/png': {
    mimeType: 'image/png',
    extensions: ['png'],
    magicBytes: [0x89, 0x50, 0x4e, 0x47]
  },
  'image/webp': {
    mimeType: 'image/webp',
    extensions: ['webp'],
    magicBytes: [0x52, 0x49, 0x46, 0x46],
    laterBytes: [{ offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }]
  },
  'application/pdf': {
    mimeType: 'application/pdf',
    extensions: ['pdf'],
    magicBytes: [0x25, 0x50, 0x44, 0x46]
  }
};

const MB = 1024 * 1024;

// PRD FR-2.6: at most 10 MB per file, 5 files and 30 MB in all for one estimate request. The
// browser checks the same numbers (estimate-api.js, FILE_POLICY).
const MAX_FILE_SIZE = 10 * MB;
const MAX_FILES_PER_ESTIMATE = 5;
const MAX_TOTAL_FILE_SIZE = 30 * MB;

export function validateFileBuffer(buffer: Buffer, mimeType: string, filename: string): FileValidationResult {
  const errors: string[] = [];

  if (!buffer || buffer.length === 0) {
    errors.push('File is empty');
    return { valid: false, errors };
  }

  if (buffer.length > MAX_FILE_SIZE) {
    errors.push(`File size exceeds ${MAX_FILE_SIZE / MB}MB limit`);
  }

  const signature = ALLOWED_FILE_SIGNATURES[mimeType];
  if (!signature) {
    errors.push(`MIME type ${mimeType} is not allowed`);
    return { valid: false, errors };
  }

  const startsRight = buffer.subarray(0, signature.magicBytes.length).equals(Buffer.from(signature.magicBytes));
  const laterRight = (signature.laterBytes || []).every(({ offset, bytes }) =>
    buffer.subarray(offset, offset + bytes.length).equals(Buffer.from(bytes))
  );
  if (!startsRight || !laterRight) {
    errors.push('File magic bytes do not match MIME type');
  }

  const ext = getFileExtension(filename);
  if (!signature.extensions.includes(ext)) {
    errors.push(`File extension .${ext} does not match MIME type ${mimeType}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// The limits of the whole set of files of one request: how many, and how large together.
export function validateFileSet(sizes: number[]): FileValidationResult {
  const errors: string[] = [];

  if (sizes.length > MAX_FILES_PER_ESTIMATE) {
    errors.push(`Too many files: at most ${MAX_FILES_PER_ESTIMATE} files per request`);
  }
  if (sizes.reduce((sum, size) => sum + size, 0) > MAX_TOTAL_FILE_SIZE) {
    errors.push(`Total file size exceeds ${MAX_TOTAL_FILE_SIZE / MB}MB limit`);
  }

  return { valid: errors.length === 0, errors };
}

export function generateSafeFileId(): string {
  return randomUUID().replace(/-/g, '');
}

export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  if (parts.length < 2) {
    return 'unknown';
  }
  const ext = parts.pop()?.toLowerCase();
  return ext || 'unknown';
}

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^\w\-. ]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 255);
}

// The original name of a file, kept only to be shown to the staff (PRD FR-2.8: the stored object
// gets an internal id). Letters of any language stay; folders, control characters and anything
// that could pass for markup do not. Never used in a path or a key.
export function displayFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() || '';
  const cleaned = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>"'`]/g, '')
    .trim()
    .substring(0, 255);
  return cleaned || 'file';
}

export const FILE_VALIDATION = {
  MAX_FILE_SIZE,
  MAX_FILES_PER_ESTIMATE,
  MAX_TOTAL_FILE_SIZE,
  ALLOWED_MIME_TYPES: Object.keys(ALLOWED_FILE_SIGNATURES)
};
