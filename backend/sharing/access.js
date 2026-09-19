import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ApiError } from '../errors.js';

const digest = (value) => createHash('sha256').update(value).digest('hex');
export const defaultAccessPath = resolve('.runtime/access.sqlite');

// Only hashes, expiry/revocation and usage counters are persisted. No source text.
export class AccessStore {
  constructor(path = defaultAccessPath, { now = Date.now } = {}) {
    this.now = now;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, label TEXT NOT NULL, hash TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, network TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS usage (scope TEXT NOT NULL, bucket TEXT NOT NULL, amount INTEGER NOT NULL, PRIMARY KEY (scope, bucket));`);
  }
  create(label, hours = 24) {
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(label) || !Number.isFinite(hours) || hours < 1 || hours > 168) throw new Error('Use a short teammate name and an expiry of 1–168 hours.');
    const id = randomBytes(12).toString('hex'), secret = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO users (id,label,hash,expires) VALUES (?,?,?,?)')
      .run(id, label, digest(secret), this.now() + hours * 3_600_000);
    return { id, token: `${id}.${secret}` };
  }
  authenticate(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const [id, secret] = token.split('.');
    const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(id);
    const expected = Buffer.from(user?.hash ?? '0'.repeat(64), 'hex');
    if (!timingSafeEqual(Buffer.from(digest(secret), 'hex'), expected) || !user || !this.active(id)) return null;
    return { id: user.id, label: user.label };
  }
  active(id) {
    if (id.startsWith('visitor:')) return Boolean(this.db.prepare('SELECT id FROM visitors WHERE id=? AND expires>?').get(id, this.now()));
    const user = this.db.prepare('SELECT expires,revoked FROM users WHERE id=?').get(id);
    return Boolean(user && !user.revoked && user.expires > this.now());
  }
  revoke(id) { this.db.prepare('UPDATE users SET revoked=1 WHERE id=?').run(id); }
  list() { return this.db.prepare('SELECT id,label,expires,revoked FROM users').all(); }
  visitor(rawId, network) {
    if (!/^[a-f0-9]{32}$/.test(rawId ?? '') || !/^[a-f0-9]{64}$/.test(network ?? '')) return null;
    const id = `visitor:${rawId}`;
    this.db.prepare('DELETE FROM visitors WHERE expires<=?').run(this.now());
    // Keep usage across cookie renewal/restarts; prune only obsolete UTC buckets.
    this.db.prepare('DELETE FROM usage WHERE bucket<?').run(new Date(this.now() - 2 * 86400000).toISOString().slice(0, 10));
    const existing = this.db.prepare('SELECT id FROM visitors WHERE id=?').get(id);
    if (!existing && this.db.prepare('SELECT COUNT(*) AS n FROM visitors').get().n >= 1000) throw new ApiError(429, 'VISITOR_LIMIT', 'The demo is at capacity. Try again later.');
    this.db.prepare('INSERT INTO visitors VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET network=excluded.network').run(id, network, this.now() + 8 * 3600000);
    return { id, label: 'anonymous visitor' };
  }
  reserve(id, kind, input) {
    const date = new Date(this.now()).toISOString();
    const ai = kind === 'plan' || input.analyze ? 1 : 0;
    const search = kind === 'research' ? input.queries.length + Math.min(3, input.maxResults) : 0;
    const visitor = this.db.prepare('SELECT network FROM visitors WHERE id=?').get(id);
    const limits = [
      [`${id}:jobs`, date.slice(0, 13), 1, visitor ? 6 : 20],
      [`${id}:ai`, date.slice(0, 10), ai, visitor ? 8 : 20], ['global:ai', date.slice(0, 10), ai, 60],
      [`${id}:search`, date.slice(0, 10), search, visitor ? 24 : 60], ['global:search', date.slice(0, 10), search, 120],
    ];
    if (visitor) limits.push(
      [`network:${visitor.network}:jobs`, date.slice(0, 13), 1, 10],
      [`network:${visitor.network}:ai`, date.slice(0, 10), ai, 20],
      [`network:${visitor.network}:search`, date.slice(0, 10), search, 60],
    );
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [scope, bucket, amount, limit] of limits) {
        const used = this.db.prepare('SELECT amount FROM usage WHERE scope=? AND bucket=?').get(scope, bucket)?.amount ?? 0;
        if (used + amount > limit) throw new ApiError(429, 'USAGE_LIMIT', 'This demo has reached its hourly or daily usage limit. Contact the host.');
      }
      for (const [scope, bucket, amount] of limits) this.db.prepare('INSERT INTO usage VALUES (?,?,?) ON CONFLICT(scope,bucket) DO UPDATE SET amount=amount+excluded.amount').run(scope, bucket, amount);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
