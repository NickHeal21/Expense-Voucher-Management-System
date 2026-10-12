import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool from './db.js';

const accounts = [
  { role: 'employee', prefix: 'SEED_EMPLOYEE' },
  { role: 'director', prefix: 'SEED_DIRECTOR' },
  { role: 'accounts', prefix: 'SEED_ACCOUNTS' },
];

async function seed() {
  for (const account of accounts) {
    const fullName = process.env[`${account.prefix}_NAME`]?.trim();
    const email = process.env[`${account.prefix}_EMAIL`]?.trim();
    const password = process.env[`${account.prefix}_PASSWORD`];

    if (!fullName || !email || !password || password.length < 8) {
      throw new Error(`Set ${account.prefix}_NAME, ${account.prefix}_EMAIL, and ${account.prefix}_PASSWORD (at least 8 characters).`);
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES ($1, lower($2), $3, $4)
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [fullName, email, passwordHash, account.role],
    );

    console.log(result.rowCount === 1
      ? `Created ${account.role} account for ${email}.`
      : `Account ${email} already exists; left unchanged.`);
  }
}

seed()
  .catch((error) => {
    console.error('Seeding failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
