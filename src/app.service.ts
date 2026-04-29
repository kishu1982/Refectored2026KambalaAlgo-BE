import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Lets rock the World! with Algo Trading at mansukhFintech';
  }
}
