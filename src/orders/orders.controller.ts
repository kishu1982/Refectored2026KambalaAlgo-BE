import {
  Controller,
  Post,
  Body,
  BadRequestException,
  UsePipes,
  ValidationPipe,
  Get,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { PlaceOrderDto } from './dto/place-order.dto';
import { ModifyOrderDto } from './dto/modify-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('place')
  @UsePipes(
    new ValidationPipe({
      transform: true,
      skipMissingProperties: true,
      forbidUnknownValues: false,
    }),
  )
  placeOrder(@Body() body: PlaceOrderDto) {
    return this.ordersService.placeOrder(body);
  }

  /* ================= MODIFY ================= */

  @Post('modify')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  )
  modifyOrder(@Body() body: ModifyOrderDto) {
    return this.ordersService.modifyOrder(body);
  }

  /* ================= CANCEL ================= */

  @Post('cancel')
  cancelOrder(@Body() body: { orderno: string }) {
    if (!body.orderno) {
      throw new BadRequestException('orderno is required');
    }

    return this.ordersService.cancelOrder(body.orderno);
  }

  /* ================= EXIT ================= */

  @Post('exit')
  exitOrder(@Body() body: { orderno: string; prd: 'H' | 'B' }) {
    if (!body.orderno || !body.prd) {
      throw new BadRequestException('orderno and prd are required');
    }

    return this.ordersService.exitOrder(body);
  }

  @Post('order-margin')
  getOrderMargin(
    @Body()
    body: {
      exchange: string;
      tradingsymbol: string;
      quantity: number;
      price: number;
      product: string;
      transactionType: 'B' | 'S';
      priceType: string;
    },
  ) {
    return this.ordersService.getOrderMargin(body);
  }

  // /*============= trade book ======*/
  // @Post('trade-book')
  // getTradeBook() {
  //   return this.ordersService.getTradeBook();
  // }

  /* ===================== POSITION BOOK ===================== */

  @Post('position-book')
  getPositionBook() {
    return this.ordersService.getPositionBook();
  }

  /* ===================== HOLDINGS ===================== */

  @Post('holdings')
  getHoldings(@Body('prd') prd: 'C' | 'M' | 'H') {
    return this.ordersService.getHoldings(prd || 'C');
  }

  /* ===================== ORDER REPORT ===================== */

  @Post('order-report')
  getOrderReport(
    @Body()
    body: {
      from_date: string;
      to_date: string;
      brkname?: string;
    },
  ) {
    console.log('📥 OrderReport body:', body);
    return this.ordersService.getOrderReport(body);
  }

  /* ========================= TRADE REPORT ========================= */

  @Post('trade-report')
  getTradeReport(
    @Body()
    body: {
      from_date: string;
      to_date: string;
      brkname?: string;
    },
  ) {
    return this.ordersService.getTradeReport(body);
  }

  /* ========================= NET POSITIONS ========================= */

  @Post('net-positions')
  getNetPositions() {
    return this.ordersService.getNetPositions();
  }

  /* ================= GET ORDER BOOK ================= */

  @Get('order-book')
  async getOrderBook() {
    return this.ordersService.getOrderBook();
  }
  /* ================= GET TRADE BOOK ================= */

  @Get('trade-book')
  async getTradeBook() {
    return this.ordersService.getTradeBook();
  }
}
