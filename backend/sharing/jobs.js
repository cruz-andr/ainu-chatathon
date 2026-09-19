import { randomUUID } from 'node:crypto';
import { ApiError } from '../errors.js';

export class Jobs {
  constructor({ execute, access, now = Date.now, ttlMs = 3_600_000, limit = 100, maxPending = 5 }) {
    Object.assign(this, { execute, access, now, ttlMs, limit, maxPending });
    this.entries = new Map();
    this.pending = [];
    this.running = false;
  }
  prune() {
    for (const [id, job] of this.entries) if (job.finishedAt !== undefined && this.now() - job.finishedAt >= this.ttlMs) this.entries.delete(id);
  }
  submit(owner, kind, input) {
    this.prune();
    const active = [...this.entries.values()].filter((job) => ['queued', 'running'].includes(job.status));
    if (active.length >= this.maxPending || active.filter((job) => job.owner === owner).length >= 2) throw new ApiError(429, 'QUEUE_FULL', 'The demo queue is full. Wait for your current jobs to finish.');
    // Reserve worst-case costs before any external work. Failed jobs are not refunded.
    this.access.reserve(owner, kind, input);
    while (this.entries.size >= this.limit) {
      const oldest = [...this.entries.values()].find((job) => job.finishedAt !== undefined);
      if (!oldest) throw new ApiError(429, 'QUEUE_FULL', 'The demo queue is full.');
      this.entries.delete(oldest.id);
    }
    const job = { id: randomUUID(), owner, kind, status: 'queued', createdAt: this.now() };
    this.entries.set(job.id, job);
    this.pending.push({ job, input });
    queueMicrotask(() => this.drain());
    return this.view(job);
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) {
        const { job, input } = this.pending.shift();
        try {
          if (!this.access.active(job.owner)) throw new ApiError(401, 'ACCESS_REVOKED', 'Access expired or was revoked before this job started.');
          job.status = 'running';
          job.result = await this.execute(job.kind, input);
          job.status = 'completed';
        } catch (error) {
          job.status = 'failed';
          job.error = { code: error instanceof ApiError ? error.code : 'JOB_FAILED',
            message: error instanceof ApiError ? error.message : 'Research failed. Contact the host.' };
        } finally { job.finishedAt = this.now(); }
      }
    } finally { this.running = false; }
  }
  view(job) { return { jobId: job.id, status: job.status, ...(job.result ? { result: job.result } : {}), ...(job.error ? { error: job.error } : {}) }; }
  get(id, owner) {
    this.prune();
    const job = this.entries.get(id);
    return job?.owner === owner ? this.view(job) : null;
  }
  report(id, owner) {
    this.prune();
    return [...this.entries.values()].find((job) => job.owner === owner && job.kind === 'research' && job.status === 'completed' && job.result.id === id)?.result;
  }
}
