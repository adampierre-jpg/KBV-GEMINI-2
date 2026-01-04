/**
 * Holistic Finger Tracker - Uses MediaPipe Holistic for finger tracking
 * Primary velocity source: middle finger tip
 * Fallback: wrist if hand confidence low
 */

import { HolisticLandmarker, FilesetResolver, type HolisticLandmarkerResult } from '@mediapipe/tasks-vision';
import type { TrackingResult, PoseData, Landmark } from '../types';
import { TrackerVariant } from './TrackingSystem';

export class HolisticFingerTracker extends TrackerVariant {
	private holisticLandmarker: HolisticLandmarker | null = null;
	private lastVideoTime: number = -1;
	private readonly CONFIDENCE_THRESHOLD = 0.5;

	async initialize(): Promise<void> {
		const vision = await FilesetResolver.forVisionTasks(
			'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
		);

		this.holisticLandmarker = await HolisticLandmarker.createFromOptions(vision, {
			baseOptions: {
				modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task',
				delegate: 'GPU'
			},
			runningMode: 'VIDEO',
			minPoseDetectionConfidence: 0.5,
			minPosePresenceConfidence: 0.5,
			minTrackingConfidence: 0.5
		});
	}

	async track(videoElement: HTMLVideoElement, timestamp: number): Promise<TrackingResult | null> {
		if (!this.holisticLandmarker || videoElement.currentTime === this.lastVideoTime) {
			return null;
		}

		this.lastVideoTime = videoElement.currentTime;

		const results = await this.holisticLandmarker.detectForVideo(videoElement, timestamp);

		if (!results || !results.poseLandmarks || results.poseLandmarks.length === 0) {
			return null;
		}

		// Extract pose landmarks
		const pose = this.extractPoseData(results);

		// Try to get finger tracking first
		let trackedPoint: Landmark;
		let confidence: number;

		if (results.leftHandLandmarks && results.leftHandLandmarks.length > 0) {
			// Middle finger tip is landmark 12 in MediaPipe Hands
			const fingerTip = results.leftHandLandmarks[0][12];
			trackedPoint = {
				x: fingerTip.x,
				y: fingerTip.y,
				z: fingerTip.z,
				visibility: 1.0
			};
			confidence = 0.9;
		} else if (results.rightHandLandmarks && results.rightHandLandmarks.length > 0) {
			const fingerTip = results.rightHandLandmarks[0][12];
			trackedPoint = {
				x: fingerTip.x,
				y: fingerTip.y,
				z: fingerTip.z,
				visibility: 1.0
			};
			confidence = 0.9;
		} else {
			// Fallback to wrist
			trackedPoint = pose.wrist;
			confidence = 0.7;
		}

		// Calculate velocity using Kalman filter
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
			confidence
		};
	}

	private extractPoseData(results: HolisticLandmarkerResult): PoseData {
		const landmarks = results.poseLandmarks[0];

		return {
			wrist: this.toLandmark(landmarks[15]), // Left wrist
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
		this.holisticLandmarker?.close();
		this.holisticLandmarker = null;
	}
}
