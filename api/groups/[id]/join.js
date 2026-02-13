const { Redis } = require('@upstash/redis');
const { validate } = require('../../validate');

const redis = new Redis({
  url: process.env.UPSTASH_KV_REST_API_URL,
  token: process.env.UPSTASH_KV_REST_API_TOKEN,
});

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = validate(req);
  if (!auth.ok) {
    return res.status(401).json({ error: auth.error });
  }

  const { id: groupId } = req.query;
  const { invite } = req.query;

  if (!groupId || !invite) {
    return res.status(400).json({ error: 'Missing group ID or invite code' });
  }

  // Verify invite code maps to this group
  const mappedGroupId = await redis.get(`invite:${invite}`);
  if (mappedGroupId !== groupId) {
    return res.status(400).json({ error: 'Invalid invite code' });
  }

  // Check group exists
  const groupStr = await redis.get(`group:${groupId}`);
  if (!groupStr) {
    return res.status(404).json({ error: 'Group not found' });
  }

  // Check if already a member
  const isMember = await redis.sismember(`group:${groupId}:members`, auth.userId);
  if (isMember) {
    const group = typeof groupStr === 'string' ? JSON.parse(groupStr) : groupStr;
    return res.json({ group, alreadyMember: true });
  }

  // Add user to group
  const pipeline = redis.pipeline();
  pipeline.sadd(`group:${groupId}:members`, auth.userId);
  pipeline.hset(`group:${groupId}:member_names`, { [auth.userId]: auth.userName });
  pipeline.sadd(`user:${auth.userId}:groups`, groupId);
  await pipeline.exec();

  const group = typeof groupStr === 'string' ? JSON.parse(groupStr) : groupStr;

  return res.json({ group, alreadyMember: false });
};
