import test from 'node:test';
import assert from 'node:assert/strict';
import { validAmount, validDate, voucherInput } from '../src/routes/vouchers.js';

test('voucher amount must be finite, positive, and fit the database precision', () => {
  assert.equal(validAmount(1), true);
  assert.equal(validAmount('0'), false);
  assert.equal(validAmount(-5), false);
  assert.equal(validAmount('1.234'), false);
  assert.equal(validAmount('not a number'), false);
  assert.equal(validAmount('10000000000'), false);
});

test('expense date must be a real ISO calendar date', () => {
  assert.equal(validDate('2026-10-12'), true);
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('12/10/2026'), false);
});

test('voucher request requires all expense fields and trims entered text', () => {
  const valid = voucherInput({
    expense_date: '2026-10-12', department: ' Finance ', expense_title: ' Travel ',
    category: 'Travel', description: ' Visit office ', amount: '1250.50',
  });
  assert.deepEqual(valid, {
    expenseDate: '2026-10-12', department: 'Finance', title: 'Travel',
    category: 'Travel', description: 'Visit office', amount: 1250.5,
  });
  assert.equal(voucherInput({ expense_date: '2026-10-12', department: '', expense_title: 'Travel', category: 'Travel', description: 'Visit office', amount: '1250.50' }), null);
  assert.equal(voucherInput(null), null);
});
