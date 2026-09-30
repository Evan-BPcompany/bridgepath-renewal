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

export function extractMultipartData(
  body: any,
  files: Express.Multer.File[] | undefined
): {
  category: string;
  specification_json: any;
  customer_email?: string;
  customer_name?: string;
  customer_phone?: string;
  company_name?: string;
  uploadedFiles?: Express.Multer.File[];
} {
  const category = body.category;
  const specString = body.specification_json;

  let specification_json;
  if (typeof specString === 'string') {
    try {
      specification_json = JSON.parse(specString);
    } catch (err) {
      throw new Error('Invalid specification_json JSON format');
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
    uploadedFiles: files
  };
}
