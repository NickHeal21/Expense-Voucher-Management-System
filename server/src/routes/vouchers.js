import { Router } from 'express';
import { mkdir } from 'node:fs/promises';
import { readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import pool from '../db.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = Router();
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const uploadDirectory = path.resolve(currentDirectory, '../../uploads');
const imageTypes = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
await mkdir(uploadDirectory, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDirectory,
    filename: (_request, file, callback) => callback(null, `${randomUUID()}${imageTypes[file.mimetype] || ''}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    if (!imageTypes[file.mimetype]) return callback(new Error('Only PNG, JPEG, and WebP images are allowed.'));
    return callback(null, true);
  },
});

router.use(authenticateToken);

function validText(value, maxLength = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

function validAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= 9999999999.99 &&
    Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-8;
}

function validateVoucherId(request, response, next) {
  if (!/^\d+$/.test(request.params.id)) return response.status(400).json({ error: 'Invalid voucher id.' });
  return next();
}

function voucherInput(body = {}) {
  body = body && typeof body === 'object' ? body : {};
  const amount = Number(body.amount);
  if (!validDate(body.expense_date) || !validText(body.department, 120) ||
      !validText(body.expense_title, 200) || !validText(body.category, 120) ||
      !validText(body.description, 4000) || !validAmount(body.amount)) {
    return null;
  }
  return {
    expenseDate: body.expense_date,
    department: body.department.trim(),
    title: body.expense_title.trim(),
    category: body.category.trim(),
    description: body.description.trim(),
    amount,
  };
}

async function uploadedImageIsValid(file) {
  const bytes = await readFile(file.path);
  if (file.mimetype === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (file.mimetype === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.mimetype === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

async function rejectInvalidImage(file, response) {
  if (await uploadedImageIsValid(file)) return false;
  await unlink(file.path).catch(() => {});
  response.status(400).json({ error: 'The uploaded file is not a valid PNG, JPEG, or WebP image.' });
  return true;
}

const detailSql = `
  SELECT v.id, v.voucher_number, v.employee_id, u.full_name AS employee_name,
    u.email AS employee_email, v.voucher_date, v.department, v.expense_title, v.expense_date,
    v.category, v.description, v.amount, v.status, v.employee_signature_path,
    v.created_at, v.updated_at, v.submitted_at,
    a.decision, a.rejection_reason, a.director_signature_path, a.decided_at,
    director.full_name AS director_name
  FROM vouchers v
  JOIN users u ON u.id = v.employee_id
  LEFT JOIN voucher_approvals a ON a.voucher_id = v.id
  LEFT JOIN users director ON director.id = a.director_id
`;

router.post('/signature', requireRole('employee'), upload.single('signature'), async (request, response, next) => {
  if (!request.file) return response.status(400).json({ error: 'Choose a signature image.' });
  try {
    if (await rejectInvalidImage(request.file, response)) return;
    await pool.query(
      'UPDATE users SET employee_signature_path = $1, updated_at = NOW() WHERE id = $2',
      [request.file.filename, request.user.id],
    );
    return response.status(201).json({ signature: request.file.filename });
  } catch (error) { return next(error); }
});

router.post('/director-signature', requireRole('director'), upload.single('signature'), async (request, response, next) => {
  if (!request.file) return response.status(400).json({ error: 'Choose a signature image.' });
  try {
    if (await rejectInvalidImage(request.file, response)) return;
    await pool.query(
      'UPDATE users SET director_signature_path = $1, updated_at = NOW() WHERE id = $2',
      [request.file.filename, request.user.id],
    );
    return response.status(201).json({ signature: request.file.filename });
  } catch (error) { return next(error); }
});

router.get('/signature/me', async (request, response, next) => {
  if (!['employee', 'director'].includes(request.user.role)) {
    return response.json({ signature: null });
  }
  const column = request.user.role === 'employee' ? 'employee_signature_path' : 'director_signature_path';
  try {
    const result = await pool.query(`SELECT ${column} AS signature FROM users WHERE id=$1`, [request.user.id]);
    return response.json({ signature: result.rows[0]?.signature ?? null });
  } catch (error) { return next(error); }
});

router.get('/signatures/:filename', async (request, response, next) => {
  const { filename } = request.params;
  if (!/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(filename)) {
    return response.status(404).json({ error: 'Signature not found.' });
  }
  try {
    const found = await pool.query(
      `SELECT
        EXISTS (SELECT 1 FROM users WHERE employee_signature_path = $1 OR director_signature_path = $1)
        OR EXISTS (SELECT 1 FROM vouchers WHERE employee_signature_path = $1)
        OR EXISTS (SELECT 1 FROM voucher_approvals WHERE director_signature_path = $1) AS is_found`,
      [filename],
    );
    if (!found.rows[0].is_found) return response.status(404).json({ error: 'Signature not found.' });
    if (request.user.role === 'employee') {
      const own = await pool.query(
        `SELECT
          EXISTS (SELECT 1 FROM users WHERE id = $1 AND employee_signature_path = $2)
          OR EXISTS (SELECT 1 FROM vouchers WHERE employee_id = $1 AND employee_signature_path = $2)
          OR EXISTS (SELECT 1 FROM voucher_approvals a JOIN vouchers v ON v.id=a.voucher_id
            WHERE v.employee_id=$1 AND a.director_signature_path=$2) AS allowed`,
        [request.user.id, filename],
      );
      if (!own.rows[0].allowed) return response.status(403).json({ error: 'You do not have permission to view this signature.' });
    }
    return response.sendFile(path.join(uploadDirectory, filename));
  } catch (error) { return next(error); }
});

router.get('/dashboard', async (request, response, next) => {
  try {
    const employeeOnly = request.user.role === 'employee';
    const values = employeeOnly ? [request.user.id] : [];
    const statsResult = await pool.query(
      `SELECT COUNT(*)::int AS total_vouchers,
        COUNT(*) FILTER (WHERE status = 'draft')::int AS drafts,
        COUNT(*) FILTER (WHERE status = 'pending_approval')::int AS pending,
        COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected,
        COALESCE(SUM(amount), 0)::numeric(14,2) AS total_amount,
        COALESCE(SUM(amount) FILTER (WHERE status = 'pending_approval'), 0)::numeric(14,2) AS pending_amount,
        COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)::numeric(14,2) AS approved_amount,
        COUNT(*) FILTER (WHERE status = 'approved' AND decided_at::date = CURRENT_DATE)::int AS approved_today,
        COUNT(*) FILTER (WHERE status = 'rejected' AND decided_at::date = CURRENT_DATE)::int AS rejected_today
       FROM (
         SELECT v.*, a.decided_at FROM vouchers v
         LEFT JOIN voucher_approvals a ON a.voucher_id = v.id
         ${employeeOnly ? 'WHERE v.employee_id = $1' : ''}
       ) items`, values,
    );
    const recentCondition = employeeOnly ? 'WHERE v.employee_id = $1'
      : request.user.role === 'accounts' ? "WHERE v.status='approved'" : '';
    const recent = await pool.query(
      `${detailSql} ${recentCondition}
       ORDER BY v.created_at DESC LIMIT 5`, values,
    );
    return response.json({ role: request.user.role, stats: statsResult.rows[0], recent: recent.rows });
  } catch (error) { return next(error); }
});

router.get('/', async (request, response, next) => {
  const { search, status, department, category, employee, dateFrom, dateTo,
    amountMin, amountMax, sort = 'newest' } = request.query;
  const validStatuses = ['draft', 'pending_approval', 'approved', 'rejected'];
  const sortOptions = {
    newest: 'v.created_at DESC', oldest: 'v.created_at ASC',
    highest: 'v.amount DESC, v.created_at DESC', lowest: 'v.amount ASC, v.created_at DESC',
  };
  if ((status && !validStatuses.includes(status)) || (sort && !sortOptions[sort]) ||
      (dateFrom && !validDate(dateFrom)) || (dateTo && !validDate(dateTo)) ||
      (amountMin !== undefined && !validAmount(amountMin)) ||
      (amountMax !== undefined && !validAmount(amountMax)) ||
      (amountMin !== undefined && amountMax !== undefined && Number(amountMin) > Number(amountMax)) ||
      (dateFrom && dateTo && dateFrom > dateTo)) {
    return response.status(400).json({ error: 'Invalid filter or sort value.' });
  }

  const conditions = [];
  const values = [];
  const add = (sql, value) => { values.push(value); conditions.push(sql.replace('?', `$${values.length}`)); };
  if (request.user.role === 'employee') add('v.employee_id = ?', request.user.id);
  if (status) add('v.status = ?', status);
  if (department) add('v.department ILIKE ?', `%${String(department).slice(0, 120)}%`);
  if (category) add('v.category ILIKE ?', `%${String(category).slice(0, 120)}%`);
  if (employee && request.user.role !== 'employee') add('u.full_name ILIKE ?', `%${String(employee).slice(0, 120)}%`);
  if (dateFrom) add('v.expense_date >= ?', dateFrom);
  if (dateTo) add('v.expense_date <= ?', dateTo);
  if (amountMin !== undefined) add('v.amount >= ?', Number(amountMin));
  if (amountMax !== undefined) add('v.amount <= ?', Number(amountMax));
  if (search) {
    values.push(`%${String(search).slice(0, 150)}%`);
    const index = values.length;
    conditions.push(`(v.voucher_number::text ILIKE $${index} OR v.expense_title ILIKE $${index}
      OR v.department ILIKE $${index} OR v.category ILIKE $${index} OR u.full_name ILIKE $${index})`);
  }

  try {
    const result = await pool.query(
      `${detailSql} ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
       ORDER BY ${sortOptions[sort]} LIMIT 250`, values,
    );
    return response.json({ vouchers: result.rows });
  } catch (error) { return next(error); }
});

router.post('/', requireRole('employee'), async (request, response, next) => {
  const input = voucherInput(request.body);
  if (!input) return response.status(400).json({ error: 'Complete all required fields and enter an amount greater than zero.' });
  try {
    const result = await pool.query(
      `INSERT INTO vouchers
        (employee_id, expense_date, department, expense_title, category, description, amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, voucher_number, status`,
      [request.user.id, input.expenseDate, input.department, input.title, input.category, input.description, input.amount],
    );
    return response.status(201).json({ voucher: result.rows[0] });
  } catch (error) { return next(error); }
});

router.get('/:id', validateVoucherId, async (request, response, next) => {
  try {
    const values = [request.params.id];
    const ownerCondition = request.user.role === 'employee' ? 'AND v.employee_id = $2' : '';
    if (ownerCondition) values.push(request.user.id);
    const result = await pool.query(`${detailSql} WHERE v.id = $1 ${ownerCondition}`, values);
    if (!result.rowCount) return response.status(404).json({ error: 'Voucher not found.' });
    return response.json({ voucher: result.rows[0] });
  } catch (error) { return next(error); }
});

router.put('/:id', validateVoucherId, requireRole('employee'), async (request, response, next) => {
  const input = voucherInput(request.body);
  if (!input) return response.status(400).json({ error: 'Complete all required fields and enter an amount greater than zero.' });
  try {
    const result = await pool.query(
      `UPDATE vouchers SET expense_date=$1, department=$2, expense_title=$3, category=$4,
        description=$5, amount=$6, updated_at=NOW()
       WHERE id=$7 AND employee_id=$8 AND status='draft' RETURNING id, voucher_number, status`,
      [input.expenseDate, input.department, input.title, input.category, input.description,
        input.amount, request.params.id, request.user.id],
    );
    if (!result.rowCount) return response.status(404).json({ error: 'Draft voucher not found.' });
    return response.json({ voucher: result.rows[0] });
  } catch (error) { return next(error); }
});

router.delete('/:id', validateVoucherId, requireRole('employee'), async (request, response, next) => {
  try {
    const result = await pool.query(
      "DELETE FROM vouchers WHERE id=$1 AND employee_id=$2 AND status='draft' RETURNING id",
      [request.params.id, request.user.id],
    );
    if (!result.rowCount) return response.status(404).json({ error: 'Draft voucher not found.' });
    return response.status(204).end();
  } catch (error) { return next(error); }
});

router.post('/:id/submit', validateVoucherId, requireRole('employee'), async (request, response, next) => {
  try {
    const result = await pool.query(
      `UPDATE vouchers v SET status='pending_approval', submitted_at=NOW(), updated_at=NOW(),
        employee_signature_path=(SELECT employee_signature_path FROM users WHERE id=$2)
       WHERE v.id=$1 AND v.employee_id=$2 AND v.status='draft'
         AND EXISTS (SELECT 1 FROM users WHERE id=$2 AND employee_signature_path IS NOT NULL)
       RETURNING v.id, v.voucher_number, v.status`,
      [request.params.id, request.user.id],
    );
    if (result.rowCount) return response.json({ voucher: result.rows[0] });
    const existing = await pool.query(
      `SELECT v.status, u.employee_signature_path FROM vouchers v JOIN users u ON u.id=v.employee_id
       WHERE v.id=$1 AND v.employee_id=$2`, [request.params.id, request.user.id],
    );
    if (!existing.rowCount) return response.status(404).json({ error: 'Draft voucher not found.' });
    if (existing.rows[0].status !== 'draft') return response.status(409).json({ error: 'Only draft vouchers can be submitted.' });
    return response.status(400).json({ error: 'Upload your employee signature before submitting.' });
  } catch (error) { return next(error); }
});

router.post('/:id/decision', validateVoucherId, requireRole('director'), async (request, response, next) => {
  const { decision, rejection_reason: reason } = request.body ?? {};
  if (!['approved', 'rejected'].includes(decision)) {
    return response.status(400).json({ error: 'Decision must be approved or rejected.' });
  }
  if (decision === 'rejected' && !validText(reason, 2000)) {
    return response.status(400).json({ error: 'A rejection reason is required.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT v.status, u.director_signature_path FROM vouchers v
       JOIN users u ON u.id=$2 WHERE v.id=$1 FOR UPDATE OF v`,
      [request.params.id, request.user.id],
    );
    if (!locked.rowCount) {
      await client.query('ROLLBACK');
      return response.status(404).json({ error: 'Voucher not found.' });
    }
    if (locked.rows[0].status !== 'pending_approval') {
      await client.query('ROLLBACK');
      return response.status(409).json({ error: 'Only pending vouchers can be decided.' });
    }
    const signature = decision === 'approved' ? locked.rows[0].director_signature_path : null;
    if (decision === 'approved' && !signature) {
      await client.query('ROLLBACK');
      return response.status(400).json({ error: 'Upload your Director signature before approving.' });
    }

    await client.query(
      "UPDATE vouchers SET status=$1, updated_at=NOW() WHERE id=$2 AND status='pending_approval'",
      [decision, request.params.id],
    );
    const approval = await client.query(
      `INSERT INTO voucher_approvals
        (voucher_id, director_id, decision, director_signature_path, rejection_reason)
       VALUES ($1, $2, $3, $4, $5) RETURNING decided_at`,
      [request.params.id, request.user.id, decision, signature, decision === 'rejected' ? reason.trim() : null],
    );
    await client.query('COMMIT');
    return response.json({ decision, decided_at: approval.rows[0].decided_at });
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally { client.release(); }
});

export default router;
export { validAmount, validDate, voucherInput };
