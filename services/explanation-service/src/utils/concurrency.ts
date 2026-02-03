export class QueueFullError extends Error {
  constructor(message = 'Queue limit reached') {
    super(message);
    this.name = 'QueueFullError';
  }
}

export class ConcurrencyLimiter {
  private active = 0;
  private readonly max: number;
  private readonly queueLimit: number;
  private readonly queue: Array<(release: () => void) => void> = [];

  constructor(max: number, queueLimit: number) {
    this.max = Math.max(1, Math.floor(max));
    this.queueLimit = Math.max(0, Math.floor(queueLimit));
  }

  stats() {
    return { active: this.active, queued: this.queue.length, max: this.max, queueLimit: this.queueLimit };
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
      return this.release.bind(this);
    }

    if (this.queue.length >= this.queueLimit) {
      throw new QueueFullError('Analyze queue is full');
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release() {
    const next = this.queue.shift();
    if (next) {
      next(this.release.bind(this));
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }
}
