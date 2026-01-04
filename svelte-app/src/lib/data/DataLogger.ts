/**
 * Data Logger - Silent Notion POST + CSV fallback
 */

import type { RepData, SessionMetrics } from '../types';

export class DataLogger {
	private notionApiKey: string | null = null;
	private notionDatabaseId: string | null = null;
	private sessionData: RepData[] = [];
	private sessionStartTime: number = Date.now();

	constructor(notionApiKey?: string, notionDatabaseId?: string) {
		this.notionApiKey = notionApiKey || null;
		this.notionDatabaseId = notionDatabaseId || null;
	}

	/**
	 * Log a completed rep
	 */
	async logRep(repData: RepData): Promise<void> {
		this.sessionData.push(repData);

		// Try Notion POST (silent, non-blocking)
		if (this.notionApiKey && this.notionDatabaseId) {
			this.postToNotion(repData).catch((err) => {
				console.warn('Notion POST failed (silent):', err.message);
			});
		}
	}

	/**
	 * Log session summary
	 */
	async logSessionSummary(metrics: SessionMetrics): Promise<void> {
		if (this.notionApiKey && this.notionDatabaseId) {
			this.postSessionToNotion(metrics).catch((err) => {
				console.warn('Notion session POST failed:', err.message);
			});
		}

		// Always save CSV fallback
		this.saveToCSV();
	}

	/**
	 * POST rep data to Notion
	 */
	private async postToNotion(repData: RepData): Promise<void> {
		if (!this.notionApiKey || !this.notionDatabaseId) return;

		const response = await fetch('https://api.notion.com/v1/pages', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.notionApiKey}`,
				'Content-Type': 'application/json',
				'Notion-Version': '2022-06-28'
			},
			body: JSON.stringify({
				parent: { database_id: this.notionDatabaseId },
				properties: {
					'Rep': { title: [{ text: { content: `Rep ${repData.repNumber}` } }] },
					'Peak Velocity': { number: repData.peakVelocity },
					'Avg Velocity': { number: repData.avgVelocity },
					'Power': { number: repData.power },
					'Work': { number: repData.work },
					'Phase': { rich_text: [{ text: { content: repData.phase } }] },
					'Timestamp': { date: { start: new Date(repData.timestamp).toISOString() } }
				}
			})
		});

		if (!response.ok) {
			throw new Error(`Notion API error: ${response.statusText}`);
		}
	}

	/**
	 * POST session summary to Notion
	 */
	private async postSessionToNotion(metrics: SessionMetrics): Promise<void> {
		if (!this.notionApiKey || !this.notionDatabaseId) return;

		const response = await fetch('https://api.notion.com/v1/pages', {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${this.notionApiKey}`,
				'Content-Type': 'application/json',
				'Notion-Version': '2022-06-28'
			},
			body: JSON.stringify({
				parent: { database_id: this.notionDatabaseId },
				properties: {
					'Session': { title: [{ text: { content: `Session ${new Date().toLocaleDateString()}` } }] },
					'Total Reps': { number: metrics.reps },
					'Peak Velocity': { number: metrics.peakVelocity },
					'Avg Velocity': { number: metrics.avgVelocity },
					'Total Work': { number: metrics.totalWork },
					'Total Power': { number: metrics.totalPower },
					'Duration': { number: metrics.sessionDuration }
				}
			})
		});

		if (!response.ok) {
			throw new Error(`Notion API error: ${response.statusText}`);
		}
	}

	/**
	 * Save session data to CSV (browser download)
	 */
	private saveToCSV(): void {
		if (this.sessionData.length === 0) return;

		const headers = ['Rep', 'Peak Velocity (m/s)', 'Avg Velocity (m/s)', 'Power (W)', 'Work (J)', 'Phase', 'Timestamp'];
		const rows = this.sessionData.map((rep) => [
			rep.repNumber,
			rep.peakVelocity.toFixed(2),
			rep.avgVelocity.toFixed(2),
			rep.power.toFixed(2),
			rep.work.toFixed(2),
			rep.phase,
			new Date(rep.timestamp).toISOString()
		]);

		const csvContent = [
			headers.join(','),
			...rows.map((row) => row.join(','))
		].join('\n');

		const blob = new Blob([csvContent], { type: 'text/csv' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `vbt-session-${new Date().toISOString().split('T')[0]}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}

	/**
	 * Get current session data
	 */
	getSessionData(): RepData[] {
		return [...this.sessionData];
	}

	/**
	 * Reset logger for new session
	 */
	reset(): void {
		this.sessionData = [];
		this.sessionStartTime = Date.now();
	}
}
