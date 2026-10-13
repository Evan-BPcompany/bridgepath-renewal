export {};

// The AWS SDK is replaced by a module mock, so no request can ever be made. A fresh copy of
// the service is loaded for every test because it keeps one S3 client for the whole process.

type Config = typeof import('../config/env').config;

interface Loaded {
  config: Config;
  logger: { info: jest.Mock; error: jest.Mock; warn: jest.Mock };
  service: typeof import('../services/s3Service');
  S3Client: jest.Mock;
  PutObjectCommand: jest.Mock;
  DeleteObjectCommand: jest.Mock;
  send: jest.Mock;
}

// The service is loaded together with its own copy of the config, which the test then adjusts.
function load(settings: Partial<Config> = {}): Loaded {
  const send = jest.fn().mockResolvedValue({});
  const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
  let loaded!: Loaded;

  jest.isolateModules(() => {
    jest.doMock('../utils/logger', () => ({ __esModule: true, default: logger }));
    jest.doMock('@aws-sdk/client-s3', () => ({
      S3Client: jest.fn().mockImplementation(() => ({ send })),
      PutObjectCommand: jest.fn().mockImplementation(function (this: { input: unknown }, input: unknown) {
        this.input = input;
      }),
      DeleteObjectCommand: jest.fn().mockImplementation(function (this: { input: unknown }, input: unknown) {
        this.input = input;
      })
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('@aws-sdk/client-s3');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const service = require('../services/s3Service');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { config } = require('../config/env');
    Object.assign(config, {
      awsRegion: 'ap-northeast-2',
      awsAccessKeyId: 'FAKEKEYID0000000000',
      awsSecretAccessKey: 'fake-secret-access-key-for-tests',
      s3Bucket: 'test-bucket',
      ...settings
    });
    loaded = {
      config,
      logger,
      service,
      S3Client: sdk.S3Client,
      PutObjectCommand: sdk.PutObjectCommand,
      DeleteObjectCommand: sdk.DeleteObjectCommand,
      send
    };
  });

  return loaded;
}

describe('S3 service (mocked AWS SDK)', () => {
  afterEach(() => {
    jest.dontMock('@aws-sdk/client-s3');
    jest.dontMock('../utils/logger');
  });

  describe('client setup', () => {
    it('uses the configured region and explicit credentials when both keys are set', () => {
      const { service, S3Client } = load();

      service.initializeS3Client();

      expect(S3Client).toHaveBeenCalledWith({
        region: 'ap-northeast-2',
        credentials: { accessKeyId: 'FAKEKEYID0000000000', secretAccessKey: 'fake-secret-access-key-for-tests' }
      });
    });

    it('leaves credentials to the SDK default chain when a key is missing', () => {
      const { service, S3Client } = load({ awsSecretAccessKey: undefined });

      service.initializeS3Client();

      expect(S3Client).toHaveBeenCalledWith({ region: 'ap-northeast-2' });
    });

    it('creates the client once and reuses it', () => {
      const { service, S3Client } = load();

      const first = service.initializeS3Client();
      const second = service.initializeS3Client();

      expect(first).toBe(second);
      expect(S3Client).toHaveBeenCalledTimes(1);
    });
  });

  describe('uploadFileToS3', () => {
    it('puts the object in the configured bucket, encrypted, with its content type', async () => {
      const { service, PutObjectCommand, send } = load();
      const body = Buffer.from('file-bytes');

      await service.uploadFileToS3('estimates/e1/f1.png', body, 'image/png');

      expect(PutObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-bucket',
        Key: 'estimates/e1/f1.png',
        Body: body,
        ContentType: 'image/png',
        ServerSideEncryption: 'AES256'
      });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0][0].input.Key).toBe('estimates/e1/f1.png');
    });

    it('rethrows the SDK error and logs it without the file contents', async () => {
      const { service, send, logger } = load();
      send.mockRejectedValue(new Error('AccessDenied'));

      await expect(service.uploadFileToS3('estimates/e1/f1.png', Buffer.from('secret-bytes'), 'image/png')).rejects.toThrow(
        'AccessDenied'
      );

      const logged = JSON.stringify(logger.error.mock.calls);
      expect(logged).toContain('S3 upload failed');
      expect(logged).not.toContain('secret-bytes');
      expect(logged).not.toContain('fake-secret-access-key-for-tests');
    });
  });

  describe('deleteFileFromS3', () => {
    it('deletes the object from the configured bucket', async () => {
      const { service, DeleteObjectCommand, send } = load();

      await service.deleteFileFromS3('estimates/e1/f1.png');

      expect(DeleteObjectCommand).toHaveBeenCalledWith({ Bucket: 'test-bucket', Key: 'estimates/e1/f1.png' });
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('rethrows the SDK error', async () => {
      const { service, send, logger } = load();
      send.mockRejectedValue(new Error('NoSuchBucket'));

      await expect(service.deleteFileFromS3('estimates/e1/f1.png')).rejects.toThrow('NoSuchBucket');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getS3KeyForEstimate', () => {
    it('scopes the key to the estimate: estimates/{estimate}/{file}.{extension}', () => {
      const { service } = load();

      expect(service.getS3KeyForEstimate('est-1', 'file-1', 'pdf')).toBe('estimates/est-1/file-1.pdf');
    });
  });

  it('has no way to read or sign objects: only put and delete exist', () => {
    const { service } = load();

    expect(Object.keys(service).sort()).toEqual([
      'deleteFileFromS3',
      'getS3KeyForEstimate',
      'initializeS3Client',
      'uploadFileToS3'
    ]);
  });
});
