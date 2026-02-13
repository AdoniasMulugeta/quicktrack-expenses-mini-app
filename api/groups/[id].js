const { Redis } = require('@upstash/redis');
const { validate } = require('../validate');

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

  if (req.method === 'GET') {
    return getGroup(req, res, auth, groupId);
  }
  if (req.method === 'DELETE') {
    return deleteGroup(req, res, auth, groupId);
  }
  return res.status(405).json({ error: 'Method not allowed' });
};

async function getGroup(req, res, auth, groupId) {
  const isMember = await redis.sismember(`group:${groupId}:members`, auth.userId);
  if (!isMember) {
    return res.status(403).json({ error: 'Not a member of this group' });
  }

  const [groupStr, memberNames, expensesHash] = await Promise.all([
    redis.get(`group:${groupId}`),
    redis.hgetall(`group:${groupId}:member_names`),
    redis.hgetall(`group:${groupId}:expenses`)
  ]);

  if (!groupStr) {
    return res.status(404).json({ error: 'Group not found' });
  }

  const group = typeof groupStr === 'string' ? JSON.parse(groupStr) : groupStr;

  const members = Object.entries(memberNames || {}).map(([id, name]) => ({ id, name }));

  const expenses = Object.values(expensesHash || {}).map(e => {
    return typeof e === 'string' ? JSON.parse(e) : e;
  }).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return res.json({ group, members, expenses });
}

async function deleteGroup(req, res, auth, groupId) {
  const groupStr = await redis.get(`group:${groupId}`);
  if (!groupStr) {
    return res.status(404).json({ error: 'Group not found' });
  }

  const group = typeof groupStr === 'string' ? JSON.parse(groupStr) : groupStr;
  if (group.createdBy !== auth.userId) {
    return res.status(403).json({ error: 'Only the group creator can delete it' });
  }

  const memberIds = await redis.smembers(`group:${groupId}:members`);

  const pipeline = redis.pipeline();
  pipeline.del(`group:${groupId}`);
  pipeline.del(`group:${groupId}:members`);
  pipeline.del(`group:${groupId}:member_names`);
  pipeline.del(`group:${groupId}:expenses`);
  pipeline.del(`invite:${group.inviteCode}`);
  for (const mid of memberIds || []) {
    pipeline.srem(`user:${mid}:groups`, groupId);
  }
  await pipeline.exec();

  return res.json({ ok: true });
}
