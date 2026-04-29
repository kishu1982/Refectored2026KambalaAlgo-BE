import { Controller, Get, Query, Res } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { Response } from 'express'; // ✅ FIX HERE

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * STEP 1:
   * Redirect user to Noren login page
   */
  @Get('login')
  redirectToLogin(@Res() res: any) {
    const loginUrl = this.authService.getLoginUrl();
    return res.redirect(loginUrl);
  }

  /**
   * STEP 2:
   * OAuth callback – receives code automatically
   * Example:
   * http://localhost:3000/auth/callback?code=XXXX
   */
  @Get('callback')
  async callback(@Query('code') code: string, @Res() res: Response) {
    console.log('request received : ',code)
    const tokenData = await this.authService.generateAccessToken(code);

    return res.json({
      message: 'OAuth success, access token generated',
      tokenData,
    });
  }
}
