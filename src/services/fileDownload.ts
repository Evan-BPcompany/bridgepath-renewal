// Structure for admin file downloads. Downloads are intentionally blocked: ClamAV scanning
// does not exist yet, so no file can ever reach approved/passed, and there is no
// implementation that reads from S3 or issues signed URLs.

export interface DownloadableFile {
  id: string;
  file_status: string;
  virus_scan_status: string;
}

export interface DownloadUrl {
  url: string;
  expiresInSeconds: number;
}

export interface DownloadUrlProvider {
  // false for the placeholder; a real provider (signed S3 URLs) sets this to true.
  readonly implemented: boolean;
  issue(estimateId: string, file: DownloadableFile): Promise<DownloadUrl>;
}

export class DisabledDownloadProvider implements DownloadUrlProvider {
  readonly implemented = false;

  async issue(): Promise<DownloadUrl> {
    throw new Error('File downloads are disabled: no download provider is implemented');
  }
}

export const downloadProvider: DownloadUrlProvider = new DisabledDownloadProvider();

export function isFileApproved(file: DownloadableFile): boolean {
  return file.file_status === 'approved' && file.virus_scan_status === 'passed';
}

export type FileDownloadDecision = { allowed: true } | { allowed: false; code: 'FILE_NOT_APPROVED' };

// A download needs all three: the feature flag, a real provider, and an approved + scanned file.
export function decideFileDownload(params: {
  enabled: boolean;
  provider: DownloadUrlProvider;
  file: DownloadableFile;
}): FileDownloadDecision {
  if (!params.enabled || !params.provider.implemented || !isFileApproved(params.file)) {
    return { allowed: false, code: 'FILE_NOT_APPROVED' };
  }
  return { allowed: true };
}

// Refuses to start the server with FILE_DOWNLOAD_ENABLED=true while no provider exists,
// so the flag can never be silently ignored.
export function assertFileDownloadConfiguration(enabled: boolean, provider: DownloadUrlProvider): void {
  if (enabled && !provider.implemented) {
    throw new Error(
      'FILE_DOWNLOAD_ENABLED=true but no download provider is implemented. ' +
        'Keep it false until virus scanning and a signed-URL provider exist.'
    );
  }
}
