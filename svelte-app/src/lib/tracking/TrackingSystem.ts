/**
 * Tracking System - Modular tracking with multiple variant support
 */

import type { TrackingMode, PoseData, Landmark } from '../types';
import { VelocityKalmanFilter } from '../core/KalmanFilter';

export interface TrackingResult {
	pose: PoseData;
	trackedPoint: Landmark;
	velocity: { x: number; y: number; z: number; magnitude: number };
	confidence: number;
}

export abstract class TrackerVariant {
	protected kalmanFilter: VelocityKalmanFilter;

	constructor() {
		this.kalmanFilter = new VelocityKalmanFilter(0.001, 0.05);
	}

	abstract initialize(): Promise<void>;
	abstract track(videoElement: HTMLVideoElement, timestamp: number): Promise<TrackingResult | null>;
	abstract cleanup(): void;

	reset(): void {
		this.kalmanFilter.reset();
	}
}

export class TrackingSystem {
	private currentVariant: TrackerVariant | null = null;
	private mode: TrackingMode;

	constructor(mode: TrackingMode = 'holistic-finger') {
		this.mode = mode;
	}

	async initialize(videoElement: HTMLVideoElement): Promise<void> {
		// Dynamically load the appropriate tracker
		this.currentVariant = await this.createVariant(this.mode);
		await this.currentVariant.initialize();
	}

	async track(videoElement: HTMLVideoElement, timestamp: number): Promise<TrackingResult | null> {
		if (!this.currentVariant) {
			throw new Error('Tracking system not initialized');
		}
		return this.currentVariant.track(videoElement, timestamp);
	}

	async switchMode(newMode: TrackingMode): Promise<void> {
		if (this.currentVariant) {
			this.currentVariant.cleanup();
		}
		this.mode = newMode;
		this.currentVariant = await this.createVariant(newMode);
		await this.currentVariant.initialize();
	}

	reset(): void {
		this.currentVariant?.reset();
	}

	cleanup(): void {
		this.currentVariant?.cleanup();
	}

	private async createVariant(mode: TrackingMode): Promise<TrackerVariant> {
		switch (mode) {
			case 'holistic-finger':
				const { HolisticFingerTracker } = await import('./HolisticFingerTracker');
				return new HolisticFingerTracker();
			case 'pose-heavy':
				const { PoseHeavyTracker } = await import('./PoseHeavyTracker');
				return new PoseHeavyTracker();
			case 'finger-with-kb':
			case 'kb-only':
			case 'yolo-kb':
				// These would be implemented similarly
				throw new Error(`Tracking mode ${mode} not yet implemented`);
			default:
				throw new Error(`Unknown tracking mode: ${mode}`);
		}
	}
}
