import winston from 'winston';
import { config } from '../config/env';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(info => {
    if (info.stack) {
      return `${info.timestamp} ${info.level}: ${info.message}\n${info.stack}`;
    }
    return `${info.timestamp} ${info.level}: ${info.message}`;
  })
);

const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    winston.format.printf(info => {
      const timestamp = info.timestamp || new Date().toISOString();
      const level = info.level;
      const message = info.message;
      if (info.stack) {
        return `${timestamp} ${level}: ${message}\n${info.stack}`;
      }
      return `${timestamp} ${level}: ${message}`;
    })
  )
});

const transports: winston.transport[] = [consoleTransport];

const logger = winston.createLogger({
  level: config.logLevel || 'info',
  format: logFormat,
  transports,
  defaultMeta: { service: 'bridge-path-mvp' }
});

export default logger;
