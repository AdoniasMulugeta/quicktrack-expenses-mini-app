const { Redis } = require('@upstash/redis');
const crypto = require('crypto');
const { validate } = require('./validate');

const redis = new Redis({
  url: process.env.UPSTASH_KV_REST_API_URL,
  token: process.env.UPSTASH_KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  const auth = validate(req);
  if (!auth.ok) {
    return res.status(401).json({ error: auth.error });
  }

  if (req.method === 'GET') {
    return listGroups(req, res, auth);
  }
  if (req.method === 'POST') {
    return createGroup(req, res, auth);
  }
  return res.status(405).json({ error: 'Method not allowed' });
};

async function listGroups(req, res, auth) {
  const groupIds = await redis.smembers(`user:${auth.userId}:groups`);
  if (!groupIds || groupIds.length === 0) {
    return res.json({ groups: [] });
  }

  const pipeline = redis.pipeline();
  for (const gid of groupIds) {
    pipeline.get(`group:${gid}`);
  }
  const results = await pipeline.exec();

  const groups = results.filter(Boolean).map(g => {
    if (typeof g === 'string') return JSON.parse(g);
    return g;
  });

  return res.json({ groups });
}

async function createGroup(req, res, auth) {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Group name is required' });
  }

  const groupId = crypto.randomBytes(8).toString('hex');
  const inviteCode = crypto.randomBytes(6).toString('base64url');

  const group = {
    id: groupId,
    name: name.trim().slice(0, 50),
    createdBy: auth.userId,
    createdByName: auth.userName,
    createdAt: new Date().toISOString(),
    inviteCode
  };

  const pipeline = redis.pipeline();
  pipeline.set(`group:${groupId}`, JSON.stringify(group));
  pipeline.sadd(`group:${groupId}:members`, auth.userId);
  pipeline.hset(`group:${groupId}:member_names`, { [auth.userId]: auth.userName });
  pipeline.sadd(`user:${auth.userId}:groups`, groupId);
  pipeline.set(`invite:${inviteCode}`, groupId);
  await pipeline.exec();

  return res.status(201).json({ group });
}
