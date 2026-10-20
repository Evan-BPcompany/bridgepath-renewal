import { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { FILE_VALIDATION } from '../utils/fileValidation';

const storage = multer.memoryStorage();

// A file of a type that is not allowed, found by Multer before the body is read.
export class UnsupportedFileTypeError extends Error {
  constructor(
    readonly filename: string,
    readonly mimeType: string
  ) {
    super(`MIME type ${mimeType} is not allowed`);
    this.name = 'UnsupportedFileTypeError';
  }
}

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: FILE_VALIDATION.MAX_FILE_SIZE,
    files: FILE_VALIDATION.MAX_FILES_PER_ESTIMATE
  },
  fileFilter: (_req, file, cb) => {
    if (!FILE_VALIDATION.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new UnsupportedFileTypeError(file.originalname, file.mimetype));
      return;
    }

    cb(null, true);
  }
});

// Multer reads the file name of a form as Latin-1, so a Korean name arrives as mojibake ("ë´ ë¡ê³ .png")
// although browsers send UTF-8. Reading the bytes again as UTF-8 gives the name back; a name that
// is not valid UTF-8 that way, or already holds characters Latin-1 cannot, is left as it is.
export function decodeFilename(name: string): string {
  if (/[^\u0000-\u00ff]/.test(name)) {
    return name;
  }
  const decoded = Buffer.from(name, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? name : decoded;
}

// Reads the files of POST /api/estimates. What Multer refuses is the customer's mistake, so it is
// answered with 400 and the same shape as the other file errors (details: [{ filename, errors }])
// instead of reaching the error handler as a 500. Nothing has been saved at that point.
export function receiveFiles(req: Request, res: Response, next: NextFunction): void {
  uploadMiddleware.array('files', FILE_VALIDATION.MAX_FILES_PER_ESTIMATE)(req, res, (err: unknown) => {
    if (!err) {
      for (const file of (req.files as Express.Multer.File[] | undefined) ?? []) {
        file.originalname = decodeFilename(file.originalname);
      }
      next();
      return;
    }

    let detail: { filename: string; errors: string[] } | null = null;
    if (err instanceof UnsupportedFileTypeError) {
      detail = { filename: err.filename, errors: [err.message] };
    } else if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        detail = { filename: '', errors: [`File size exceeds ${FILE_VALIDATION.MAX_FILE_SIZE / 1024 / 1024}MB limit`] };
      } else if (err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT') {
        detail = { filename: '', errors: [`Too many files: at most ${FILE_VALIDATION.MAX_FILES_PER_ESTIMATE} files per request`] };
      }
    }

    if (!detail) {
      next(err);
      return;
    }

    res.status(400).json({
      error: 'File validation failed',
      details: [detail],
      timestamp: new Date().toISOString()
    });
  });
}

// Thrown when specification_json arrives as text that is not valid JSON. It is the client's
// mistake, so the route answers 400 instead of treating it as a server error.
export class InvalidSpecificationJsonError extends Error {
  constructor() {
    super('Invalid specification_json JSON format');
    this.name = 'InvalidSpecificationJsonError';
  }
}

export function extractMultipartData(
  body: any,
  files: Express.Multer.File[] | undefined,
  options: { multipart?: boolean } = {}
): {
  category: string;
  specification_json: any;
  customer_email?: string;
  customer_name?: string;
  customer_phone?: string;
  company_name?: string;
  customer_type?: unknown;
  privacy_consent?: unknown;
  privacy_consent_version?: unknown;
  uploadedFiles?: Express.Multer.File[];
} {
  const category = body.category;
  const specString = body.specification_json;

  let specification_json;
  if (typeof specString === 'string') {
    try {
      specification_json = JSON.parse(specString);
    } catch (err) {
      throw new InvalidSpecificationJsonError();
    }
  } else {
    specification_json = specString;
  }

  return {
    category,
    specification_json,
    customer_email: body.customer_email,
    customer_name: body.customer_name,
    customer_phone: body.customer_phone,
    company_name: body.company_name,
    customer_type: body.customer_type,
    // Form data has no booleans: in a multipart request the text "true" stands for true.
    // Nothing else is converted ("True", "1", "on", "yes" stay what they are and are refused),
    // and a JSON request must send the real boolean.
    privacy_consent:
      options.multipart && body.privacy_consent === 'true' ? true : body.privacy_consent,
    privacy_consent_version: body.privacy_consent_version,
    uploadedFiles: files
  };
}
