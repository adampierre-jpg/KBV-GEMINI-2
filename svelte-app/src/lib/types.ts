/**
 * Type definitions for the Iron Eye VBT app
 */

export interface Landmark {
	x: number;
	y: number;
	z?: number;
	visibility?: number;
}

export interface PoseData {
	wrist: Landmark;
	elbow: Landmark;
	shoulder: Landmark;
	hip: Landmark;
	knee: Landmark;
	ankle: Landmark;
	nose?: Landmark;
}

export type TrackingMode = 'holistic-finger' | 'finger-with-kb' | 'kb-only' | 'pose-heavy' | 'yolo-kb';

export interface TrackingConfig {
	mode: TrackingMode;
	kettlebellWeight: number; // kg
	cameraResolution: { width: number; height: number };
	inferenceThrottle: number; // ms
}

export interface CalibrationData {
	heightCm: number;
	pixelsPerMeter: number;
	timestamp: number;
}

export interface SessionMetrics {
	reps: number;
	peakVelocity: number;
	avgVelocity: number;
	totalWork: number;
	totalPower: number;
	sessionDuration: number;
}

export interface RepData {
	repNumber: number;
	peakVelocity: number;
	avgVelocity: number;
	power: number;
	work: number;
	timestamp: number;
	phase: string;
}
