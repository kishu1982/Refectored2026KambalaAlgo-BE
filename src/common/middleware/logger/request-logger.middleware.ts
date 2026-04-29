import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('RequestURLLogger');

  private readonly logDir = path.join(process.cwd(), 'data', 'loggerFile');
  private readonly logFile = path.join(
    this.logDir,
    `requests-${new Date().toISOString().slice(0, 10)}.log`,
  );

  constructor() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  use(req: Request, res: Response, next: NextFunction) {
    const sanitizedBody = { ...req.body };

    if (sanitizedBody?.password) sanitizedBody.password = '***masked***';
    // if (sanitizedBody?.token) sanitizedBody.token = '***masked***';

    const clientIp =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.ip ||
      req.socket?.remoteAddress ||
      undefined;

    // 🔹 Timestamps
    const utcTimestamp = new Date().toISOString();
    const istTimestamp = new Date().toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
    });

    const logData = {
      timestamp: utcTimestamp, // UTC
      ISTtimeStamp: istTimestamp, // India time
      ip: clientIp,
      method: req.method,
      url: req.originalUrl,
      params: req.params,
      query: req.query,
      body: sanitizedBody,
      headers: {
        'user-agent': req.headers['user-agent'],
        authorization: req.headers['authorization']
          ? '***masked***'
          : undefined,
      },
    };

    const logLine = JSON.stringify(logData) + '\n';

    fs.appendFile(this.logFile, logLine, (err) => {
      if (err) {
        this.logger.error('Failed to write request log file', err);
      }
    });

    this.logger.log(logLine.trim());

    next(); // VERY IMPORTANT
  }
}
