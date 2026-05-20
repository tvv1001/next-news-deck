/**
 * Domain-level rate limiter to prevent hammering individual sites.
 * Tracks request timestamps per domain and enforces minimum delay between requests.
 */

export class DomainRateLimiter {
	private lastRequestMs = new Map<string, number>();
	private pendingRequests = new Map<string, number>();
	private readonly delayMs: number;
	private readonly maxConcurrentDomains: number;

	constructor(delayMs = 300, maxConcurrentDomains = 2) {
		this.delayMs = Math.max(100, delayMs);
		this.maxConcurrentDomains = Math.max(1, maxConcurrentDomains);
	}

	private normalizeHost(url: string): string {
		try {
			const parsed = new URL(url);
			return parsed.hostname?.replace(/^www\./, '').toLowerCase() ?? '';
		} catch {
			return '';
		}
	}

	async waitForSlot(url: string): Promise<void> {
		const host = this.normalizeHost(url);
		if (!host) {
			return;
		}

		// Check concurrent limit
		while ((this.pendingRequests.get(host) ?? 0) >= 2) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}

		// Check rate limit
		const lastMs = this.lastRequestMs.get(host) ?? 0;
		const elapsedMs = Date.now() - lastMs;
		if (elapsedMs < this.delayMs) {
			await new Promise((resolve) => setTimeout(resolve, this.delayMs - elapsedMs));
		}

		// Mark as pending
		this.pendingRequests.set(host, (this.pendingRequests.get(host) ?? 0) + 1);
		this.lastRequestMs.set(host, Date.now());
	}

	release(url: string): void {
		const host = this.normalizeHost(url);
		if (!host) {
			return;
		}

		const pending = (this.pendingRequests.get(host) ?? 1) - 1;
		if (pending <= 0) {
			this.pendingRequests.delete(host);
		} else {
			this.pendingRequests.set(host, pending);
		}
	}

	reset(): void {
		this.lastRequestMs.clear();
		this.pendingRequests.clear();
	}
}
