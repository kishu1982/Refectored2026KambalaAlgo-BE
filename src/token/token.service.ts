// import { Injectable } from '@nestjs/common';
// import * as fs from 'fs';
// import * as path from 'path';

// @Injectable()
// export class TokenService {
//   private readonly tokenDir = path.join(
//     process.cwd(),
//     'data',
//     'accessTokenInfo',
//     //'access-token.json',
//   );

//   private readonly tokenFilePath = path.join(
//     this.tokenDir,
//     'access-token.json',
//   );

//   // ✅ REQUIRED BY AuthService
//   saveToken(tokenData: any): void {
//     if (!fs.existsSync(this.tokenDir)) {
//       fs.mkdirSync(this.tokenDir, { recursive: true });
//     }

//     fs.writeFileSync(
//       this.tokenFilePath,
//       JSON.stringify(
//         {
//           ...tokenData,
//           savedAt: new Date().toISOString(),
//         },
//         null,
//         2,
//       ),
//       'utf-8',
//     );
//   }

//   getToken(): {
//     Access_token: string;
//     UID: string;
//     Account_ID: string;
//   } {
//     if (!fs.existsSync(this.tokenFilePath)) {
//       throw new Error('Access token file not found');
//     }

//     return JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf-8'));
//   }

//   /**
//    * 🔑 Inject token + uid + account id into SDK
//    */
//   prepareSdk(api: any) {
//     const token = this.getToken();

//     if (!token?.Access_token || !token?.UID || !token?.Account_ID) {
//       throw new Error('Invalid token data: UID / Account_ID missing');
//     }

//     // 🔥 THESE THREE MUST BE SET (EXACT NAMES)
//     api.__susertoken = token.Access_token; // ⬅️ THIS WAS MISSING
//     api.__username = token.UID;
//     api.__accountid = token.Account_ID;

//     // Optional but good
//     api.injectOAuthHeader(token.Access_token);

//     return api;
//   }
// }

import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  private readonly tokenDir = path.join(
    process.cwd(),
    'data',
    'accessTokenInfo',
  );

  private readonly tokenFilePath = path.join(
    this.tokenDir,
    'access-token.json',
  );

  /* ================= SAVE TOKEN ================= */
  // ✅ REQUIRED BY AuthService (unchanged behavior)

  saveToken(tokenData: any): void {
    if (!fs.existsSync(this.tokenDir)) {
      fs.mkdirSync(this.tokenDir, { recursive: true });
    }

    fs.writeFileSync(
      this.tokenFilePath,
      JSON.stringify(
        {
          ...tokenData,
          savedAt: new Date().toISOString(),
          expired: false, // 🔥 NEW (safe default)
        },
        null,
        2,
      ),
      'utf-8',
    );

    this.logger.log('💾 Access token saved');
  }

  /* ================= READ TOKEN ================= */

  getToken(): {
    Access_token: string;
    UID: string;
    Account_ID: string;
    expired?: boolean;
    expiredAt?: string;
    reason?: string;
  } {
    if (!fs.existsSync(this.tokenFilePath)) {
      throw new Error('Access token file not found');
    }

    return JSON.parse(fs.readFileSync(this.tokenFilePath, 'utf-8'));
  }

  /* ================= SESSION GUARD ================= */

  ensureValidSession(): void {
    const token = this.getToken();

    if (token.expired) {
      throw new Error(
        `Session expired. ${token.reason || 'Please login again.'}`,
      );
    }
  }

  /* ================= MARK SESSION EXPIRED ================= */

  markExpired(reason?: string): void {
    if (!fs.existsSync(this.tokenFilePath)) return;

    const token = this.getToken();

    token.expired = true;
    token.expiredAt = new Date().toISOString();
    token.reason = reason || 'Session expired';

    fs.writeFileSync(
      this.tokenFilePath,
      JSON.stringify(token, null, 2),
      'utf-8',
    );

    this.logger.error(`🔐 Token expired → ${token.reason}`);
  }

  /* ================= SDK PREPARATION ================= */
  /**
   * 🔑 Inject token + uid + account id into SDK
   * (Fully backward compatible)
   */

  prepareSdk(api: any) {
    const token = this.getToken();

    if (!token?.Access_token || !token?.UID || !token?.Account_ID) {
      throw new Error('Invalid token data: UID / Account_ID missing');
    }

    if (token.expired) {
      throw new Error('Session expired. Please login again.');
    }

    // 🔥 REQUIRED INTERNAL SDK PROPS
    api.__susertoken = token.Access_token;
    api.__username = token.UID;
    api.__accountid = token.Account_ID;

    // Optional but recommended
    api.injectOAuthHeader(token.Access_token);

    return api;
  }
}
