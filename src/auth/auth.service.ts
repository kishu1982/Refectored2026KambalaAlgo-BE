import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenService } from 'src/token/token.service';

// const NorenRestApi = require('norenrestapi/lib/restapi');
const NorenRestApi = require('../../norenrestapi/lib/RestApi');

@Injectable()
export class AuthService {
  private api: any;

  constructor(
    private readonly configService: ConfigService,
    private readonly tokenService: TokenService,
  ) {
    this.api = new NorenRestApi({});
  }

  /**
   * SDK way of building login URL
   */
  getLoginUrl(): string {
    const oauthUrl = this.configService.get<string>('NOREN_AUTH_URL');
    const clientId = this.configService.get<string>('NOREN_CLIENT_ID');

    if (!oauthUrl || !clientId) {
      throw new Error('Missing OAuth configuration');
    }

    // ✅ SDK METHOD
    return this.api.getOAuthURL(oauthUrl, clientId);
  }

  /**
   * SDK way of generating access token
   */
  // async generateAccessToken(authCode: string) {
  //   const clientId = this.configService.get<string>('NOREN_CLIENT_ID');
  //   const secretKey = this.configService.get<string>('NOREN_SECRET_KEY');

  //   if (!authCode || !clientId || !secretKey) {
  //     throw new Error('Missing OAuth parameters');
  //   }

  //   /**
  //    * ⚠️ SDK requires UID param, but real UID is NOT known yet
  //    * ✅ Pass clientId temporarily
  //    */
  //   const tempUid = clientId;

  //   const result = await this.api.getAccessToken(
  //     authCode,
  //     secretKey,
  //     clientId,
  //     tempUid,
  //   );

  //   /**
  //    * SDK returns:
  //    * [accessToken, userId, refreshToken, accountId]
  //    */
  //   const [accessToken, userId, refreshToken, accountId] = result;

  //   const tokenPayload = {
  //     Access_token: accessToken,
  //     UID: userId, // ✅ real UID from response
  //     Refresh_token: refreshToken,
  //     Account_ID: accountId,
  //   };

  //   // 🔐 Persist token YOUR way
  //   this.tokenService.saveToken(tokenPayload);

  //   // ✅ Inject header for future SDK calls
  //   this.api.injectOAuthHeader(accessToken);

  //   return tokenPayload;
  // }
  async generateAccessToken(authCode: string) {
    const clientId = this.configService.get<string>('NOREN_CLIENT_ID');
    const secretKey = this.configService.get<string>('NOREN_SECRET_KEY');

    if (!authCode || !clientId || !secretKey) {
      throw new Error('Missing OAuth parameters');
    }

    /**
     * ⚠️ SDK requires UID param, but real UID is NOT known yet
     * ✅ Pass clientId temporarily
     */
    const tempUid = clientId;

    try {
      const result = await this.api.getAccessToken(
        authCode,
        secretKey,
        clientId,
        tempUid,
      );

      /**
       * SDK returns:
       * [accessToken, userId, refreshToken, accountId]
       */
      const [accessToken, userId, refreshToken, accountId] = result;

      if (!accessToken) {
        throw new Error('Access token missing in SDK response');
      }

      const tokenPayload = {
        Access_token: accessToken,
        UID: userId,
        Refresh_token: refreshToken,
        Account_ID: accountId,
      };

      // 🔐 Persist token
      await this.tokenService.saveToken(tokenPayload);

      // ✅ Inject header for future SDK calls
      this.api.injectOAuthHeader(accessToken);

      return tokenPayload;
    } catch (error: any) {
      /**
       * ===============================
       * 🧠 SMART ERROR EXTRACTION
       * ===============================
       */

      // Axios / HTTP error with response
      if (error?.response) {
        const apiError =
          error.response?.data?.emsg ||
          error.response?.data?.message ||
          JSON.stringify(error.response.data);

        throw new Error(`Noren API Error: ${apiError}`);
      }

      // SDK sometimes throws plain objects / strings
      if (typeof error === 'string') {
        throw new Error(`Noren SDK Error: ${error}`);
      }

      if (error?.message) {
        throw new Error(`Noren SDK Error: ${error.message}`);
      }

      // Absolute fallback
      throw new Error(
        `Unknown error during access token generation: ${JSON.stringify(error)}`,
      );
    }
  }
}

// old working perfect
/*

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { generateChecksum } from '../utils/checksum.util';
import { TokenService } from 'src/token/token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly tokenService: TokenService,
  ) {}

  // 
  //  Build broker login URL
  //
  getLoginUrl(): string {
    const clientId = this.configService.get<string>('NOREN_CLIENT_ID');
    const authUrl = this.configService.get<string>('NOREN_AUTH_URL');

    if (!clientId || !authUrl) {
      throw new Error('Missing OAuth configuration');
    }

    return `${authUrl}?client_id=${clientId}`;
  }

  async generateAccessToken(code: string) {
    const clientId = this.configService.get<string>('NOREN_CLIENT_ID');
    const secretKey = this.configService.get<string>('NOREN_SECRET_KEY');
    const baseUrl = this.configService.get<string>('NOREN_BASE_URL');

    if (!clientId || !secretKey || !baseUrl) {
      throw new Error('Missing Noren API configuration');
    }

    const checksum = generateChecksum(clientId, secretKey, code);

    const jData = { code, checksum };

    const response = await axios.post(
      `${baseUrl}/GenAcsTok`,
      `jData=${JSON.stringify(jData)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      },
    );
    console.log('✅ Access Token Generated:', response.data);

    // 🔐 SAVE TOKEN LOCALLY
    this.tokenService.saveToken(response.data);
    
    return response.data;
  }
}
*/
