const { Redis } = require('@upstash/redis');
const crypto = require('crypto');
const { validate } = require('../../validate');

const redis = new Redis({
  url: process.env.UPSTASH_KV_REST_API_URL,
  token: process.env.UPSTASH_KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  const auth = validate(req);
  if (!auth.ok) {
    return res.status(401).json({ error: auth.error });
  }

  const { id: groupId } = req.query;
  if (!groupId) {
    return res.status(400).json({ error: 'Missing group ID' });
  }

  const isMember = await redis.sismember(`group:${groupId}:members`, auth.userId);
  if (!isMember) {
    return res.status(403).json({ error: 'Not a member of this group' });
  }

  if (req.method === 'GET') {
    return listExpenses(req, res, groupId);
  }
  if (req.method === 'POST') {
    return addExpense(req, res, auth, groupId);
  }
  return res.status(405).json({ error: 'Method not allowed' });
};

async function listExpenses(req, res, groupId) {
  const expensesHash = await redis.hgetall(`group:${groupId}:expenses`);
  const expenses = Object.values(expensesHash || {}).map(e => {
    return typeof e === 'string' ? JSON.parse(e) : e;
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return res.json({ expenses });
}

async function addExpense(req, res, auth, groupId) {
  const { amount, category, note } = req.body || {};
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  const expenseId = crypto.randomBytes(8).toString('hex');
  const expense = {
    id: expenseId,
    amount: parseFloat(amount.toFixed(2)),
    category: category || 'other',
    note: (note || '').slice(0, 100),
    timestamp: new Date().toISOString(),
    addedBy: auth.userId,
    addedByName: auth.userName
  };

  await redis.hset(`group:${groupId}:expenses`, { [expenseId]: JSON.stringify(expense) });

  return res.status(201).json({ expense });
}
