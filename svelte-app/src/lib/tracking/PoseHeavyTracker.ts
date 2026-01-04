/**
 * Pose Heavy Tracker - Uses MediaPipe Pose with heavy Kalman filtering
 * Velocity from wrist, enhanced filtering
 */

import { PoseLandmarker, FilesetResolver, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { TrackingResult, PoseData, Landmark } from '../types';
import { TrackerVariant } from './TrackingSystem';

export class PoseHeavyTracker extends TrackerVariant {
	private poseLandmarker: PoseLandmarker | null = null;
	private lastVideoTime: number = -1;

	async initialize(): Promise<void> {
		const vision = await FilesetResolver.forVisionTasks(
			'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
		);

		this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
			baseOptions: {
				modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
				delegate: 'GPU'
			},
			runningMode: 'VIDEO',
			numPoses: 1,
			minPoseDetectionConfidence: 0.5,
			minPosePresenceConfidence: 0.5,
			minTrackingConfidence: 0.5
		});

		// Use heavier filtering for this variant
		this.kalmanFilter = new VelocityKalmanFilter(0.0005, 0.08);
	}

	async track(videoElement: HTMLVideoElement, timestamp: number): Promise<TrackingResult | null> {
		if (!this.poseLandmarker || videoElement.currentTime === this.lastVideoTime) {
			return null;
		}

		this.lastVideoTime = videoElement.currentTime;

		const results = this.poseLandmarker.detectForVideo(videoElement, timestamp);

		if (!results || !results.landmarks || results.landmarks.length === 0) {
			return null;
		}

		const pose = this.extractPoseData(results);
		const trackedPoint = pose.wrist;

		// Calculate velocity with heavy Kalman filtering
		const velocity = this.kalmanFilter.update(
			{
				x: trackedPoint.x,
				y: trackedPoint.y,
				z: trackedPoint.z || 0
			},
			timestamp
		);

		return {
			pose,
			trackedPoint,
			velocity,
			confidence: trackedPoint.visibility || 0.8
		};
	}

	private extractPoseData(results: PoseLandmarkerResult): PoseData {
		const landmarks = results.landmarks[0];

		return {
			wrist: this.toLandmark(landmarks[15]), // Left wrist (or choose dynamically)
			elbow: this.toLandmark(landmarks[13]),
			shoulder: this.toLandmark(landmarks[11]),
			hip: this.toLandmark(landmarks[23]),
			knee: this.toLandmark(landmarks[25]),
			ankle: this.toLandmark(landmarks[27]),
			nose: this.toLandmark(landmarks[0])
		};
	}

	private toLandmark(lm: any): Landmark {
		return {
			x: lm.x,
			y: lm.y,
			z: lm.z,
			visibility: lm.visibility
		};
	}

	cleanup(): void {
		this.poseLandmarker?.close();
		this.poseLandmarker = null;
	}
}
