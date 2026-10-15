import multer from 'multer';
import { FILE_VALIDATION } from '../utils/fileValidation';

const storage = multer.memoryStorage();

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: FILE_VALIDATION.MAX_FILE_SIZE,
    files: FILE_VALIDATION.MAX_FILES_PER_ESTIMATE
  },
  fileFilter: (_req, file, cb) => {
    if (!FILE_VALIDATION.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
      return;
    }

    cb(null, true);
  }
});

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
