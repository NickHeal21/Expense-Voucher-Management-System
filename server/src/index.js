import 'dotenv/config';
import express from 'express';
import pool from './db.js';
import authRoutes from './routes/auth.js';
import voucherRoutes from './routes/vouchers.js';

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/vouchers', voucherRoutes);

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', message: 'Backend is running.' });
});

app.get('/api/health/db', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1');
    response.json({ status: 'ok', message: 'Database connection is healthy.' });
  } catch (error) {
    next(error);
  }
});

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API route not found.' });
});

app.use((error, _request, response, _next) => {
  console.error('Request failed:', error.message);
  if (error.code === 'LIMIT_FILE_SIZE') {
    return response.status(413).json({ error: 'Signature image must be 5 MB or smaller.' });
  }
  if (error.message === 'Only PNG, JPEG, and WebP images are allowed.') {
    return response.status(400).json({ error: error.message });
  }
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
    ? error.status
    : 500;
  return response.status(status).json({
    error: status === 400 ? 'Invalid request body.' : 'An internal server error occurred.',
  });
});

app.listen(port, () => {
  console.log(`Backend listening on port ${port}`);
});
