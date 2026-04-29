import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import * as dotenv from 'dotenv';

dotenv.config();
const baseDbName = process.env.MONGO_DB_NAME;
const norenAccId = process.env.NOREN_ACC_ID;


if (!baseDbName || !norenAccId) {
  throw new Error(
    'MONGO_DB_NAME or NOREN_ACC_ID is missing in environment variables',
  );
}

export const databaseConfig: TypeOrmModuleOptions = {
  type: 'mongodb',
  url: process.env.MONGO_URI,
  //database: process.env.MONGO_DB_NAME,
  // ✅ dynamic database name
  database: `${baseDbName}_${norenAccId}`,

  autoLoadEntities: true,
  synchronize: false,

  logging: ['error'],
};
