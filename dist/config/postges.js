'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
const pg_1 = require('pg');
require('dotenv').config();
const psqlDBconfig = {
    host: process.env.PSQL_HOST || '',
    port: parseInt(process.env.PSQL_PORT || '5432'),
    database: process.env.PSQL_DATABASE || '',
    user: process.env.PSQL_USER || '',
    password: process.env.PSQL_PW || '',
    idleTimeoutMillis: 10 * 1000,
    connectionTimeoutMillis: 15 * 1000,
};
const pool = new pg_1.Pool(psqlDBconfig);
exports.default = pool;
