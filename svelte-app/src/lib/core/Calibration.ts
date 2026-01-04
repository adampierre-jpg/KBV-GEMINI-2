/**
 * Calibration system for height measurement and pixel-to-meter conversion
 */

import type { PoseData, CalibrationData, Landmark } from '../types';

export class CalibrationSystem {
	private frames: number[] = [];
	private calibrationData: CalibrationData | null = null;
	private readonly CALIBRATION_FRAMES = 60; // 2 seconds at 30fps
	private readonly HEAD_OFFSET_MULTIPLIER = 0.12; // ~12% of height is above nose

	/**
	 * Add a frame to calibration (user standing tall)
	 */
	captureFrame(pose: PoseData, canvasHeight: number): number {
		const ankle = pose.ankle;
		const nose = pose.nose;

		if (!ankle || !nose) return this.getProgress();

		// Calculate pixel height from ankle to nose
		const pixelHeight = Math.abs(nose.y - ankle.y) * canvasHeight;
		this.frames.push(pixelHeight);

		return this.getProgress();
	}

	/**
	 * Finalize calibration with user's actual height
	 */
	finalize(userHeightCm: number, canvasHeight: number): CalibrationData {
		if (this.frames.length === 0) {
			throw new Error('No calibration frames captured');
		}

		// Calculate average pixel height
		const avgPixelHeight = this.frames.reduce((a, b) => a + b, 0) / this.frames.length;

		// User height includes head above nose (~12% of total height)
		// Ankle-to-nose = ~88% of total height
		const effectiveHeightCm = userHeightCm * (1 - this.HEAD_OFFSET_MULTIPLIER);

		// Calculate pixels per meter
		const pixelsPerCm = avgPixelHeight / effectiveHeightCm;
		const pixelsPerMeter = pixelsPerCm * 100;

		this.calibrationData = {
			heightCm: userHeightCm,
			pixelsPerMeter,
			timestamp: Date.now()
		};

		return this.calibrationData;
	}

	/**
	 * Convert normalized coordinates to meters
	 */
	toMeters(normalizedValue: number, canvasHeight: number): number {
		if (!this.calibrationData) {
			throw new Error('Calibration not completed');
		}

		const pixels = normalizedValue * canvasHeight;
		return pixels / this.calibrationData.pixelsPerMeter;
	}

	/**
	 * Get calibration progress (0 to 1)
	 */
	getProgress(): number {
		return Math.min(1, this.frames.length / this.CALIBRATION_FRAMES);
	}

	/**
	 * Check if calibration is complete
	 */
	isComplete(): boolean {
		return this.frames.length >= this.CALIBRATION_FRAMES;
	}

	/**
	 * Reset calibration
	 */
	reset(): void {
		this.frames = [];
	}

	/**
	 * Get current calibration data
	 */
	getData(): CalibrationData | null {
		return this.calibrationData;
	}

	/**
	 * Load calibration from storage
	 */
	load(data: CalibrationData): void {
		this.calibrationData = data;
	}
}
