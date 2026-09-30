import { v4 as uuidv4 } from 'uuid';

interface FileValidationResult {
  valid: boolean;
  errors: string[];
}

interface FileSignature {
  mimeType: string;
  extensions: string[];
  magicBytes: number[];
}

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
  'image/gif': {
    mimeType: 'image/gif',
    extensions: ['gif'],
    magicBytes: [0x47, 0x49, 0x46]
  },
  'application/pdf': {
    mimeType: 'application/pdf',
    extensions: ['pdf'],
    magicBytes: [0x25, 0x50, 0x44, 0x46]
  }
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_FILES_PER_ESTIMATE = 10;

export function validateFileBuffer(buffer: Buffer, mimeType: string, filename: string): FileValidationResult {
  const errors: string[] = [];

  if (!buffer || buffer.length === 0) {
    errors.push('File is empty');
    return { valid: false, errors };
  }

  if (buffer.length > MAX_FILE_SIZE) {
    errors.push(`File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
  }

  const signature = ALLOWED_FILE_SIGNATURES[mimeType];
  if (!signature) {
    errors.push(`MIME type ${mimeType} is not allowed`);
    return { valid: false, errors };
  }

  const magicBytes = buffer.slice(0, Math.max(...signature.magicBytes.map((_, i) => i + 1)));
  const expectedBytes = Buffer.from(signature.magicBytes);
  if (!magicBytes.equals(expectedBytes)) {
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

export function generateSafeFileId(): string {
  return uuidv4().replace(/-/g, '');
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

export const FILE_VALIDATION = {
  MAX_FILE_SIZE,
  MAX_FILES_PER_ESTIMATE,
  ALLOWED_MIME_TYPES: Object.keys(ALLOWED_FILE_SIGNATURES)
};
