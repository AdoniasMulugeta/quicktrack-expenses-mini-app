const { Redis } = require('@upstash/redis');
const { validate } = require('../../../validate');

const redis = new Redis({
  url: process.env.UPSTASH_KV_REST_API_URL,
  token: process.env.UPSTASH_KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  const auth = validate(req);
  if (!auth.ok) {
    return res.status(401).json({ error: auth.error });
  }

  const { id: groupId, eid: expenseId } = req.query;
  if (!groupId || !expenseId) {
    return res.status(400).json({ error: 'Missing group or expense ID' });
  }

  const isMember = await redis.sismember(`group:${groupId}:members`, auth.userId);
  if (!isMember) {
    return res.status(403).json({ error: 'Not a member of this group' });
  }

  if (req.method === 'PUT') {
    return updateExpense(req, res, auth, groupId, expenseId);
  }
  if (req.method === 'DELETE') {
    return deleteExpense(req, res, auth, groupId, expenseId);
  }
  return res.status(405).json({ error: 'Method not allowed' });
};

async function getExpenseFromRedis(groupId, expenseId) {
  const raw = await redis.hget(`group:${groupId}:expenses`, expenseId);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

async function updateExpense(req, res, auth, groupId, expenseId) {
  const existing = await getExpenseFromRedis(groupId, expenseId);
  if (!existing) {
    return res.status(404).json({ error: 'Expense not found' });
  }
  if (existing.addedBy !== auth.userId) {
    return res.status(403).json({ error: 'Only the expense creator can edit it' });
  }

  const { amount, category, note } = req.body || {};
  const updated = {
    ...existing,
    amount: (amount && typeof amount === 'number' && amount > 0) ? parseFloat(amount.toFixed(2)) : existing.amount,
    category: category || existing.category,
    note: note !== undefined ? (note || '').slice(0, 100) : existing.note
  };

  await redis.hset(`group:${groupId}:expenses`, { [expenseId]: JSON.stringify(updated) });

  return res.json({ expense: updated });
}

async function deleteExpense(req, res, auth, groupId, expenseId) {
  const existing = await getExpenseFromRedis(groupId, expenseId);
  if (!existing) {
    return res.status(404).json({ error: 'Expense not found' });
  }
  if (existing.addedBy !== auth.userId) {
    return res.status(403).json({ error: 'Only the expense creator can delete it' });
  }

  await redis.hdel(`group:${groupId}:expenses`, expenseId);

  return res.json({ ok: true });
}
