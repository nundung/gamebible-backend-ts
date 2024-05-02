import { Pool, PoolConfig } from 'pg';
require('dotenv').config();

const PoolConfig = {
    host: process.env.PSQL_HOST || '',
    port: parseInt(process.env.PSQL_PORT || '5432'),
    database: process.env.PSQL_DATABASE || '',
    user: process.env.PSQL_USER || '',
    password: process.env.PSQL_PW || '',
    idleTimeoutMillis: 10 * 1000,
    connectionTimeoutMillis: 15 * 1000,
};

const pool = new Pool(PoolConfig);

export default pool;
