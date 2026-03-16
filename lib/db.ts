import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host:            process.env.AO_DB_HOST!,
      port:            Number(process.env.AO_DB_PORT ?? 3306),
      user:            process.env.AO_DB_USER!,
      password:        process.env.AO_DB_PASS!,
      database:        process.env.AO_DB_NAME ?? 'perigee',
      connectionLimit: 5,
      connectTimeout:  15000,
    });
  }
  return pool;
}
