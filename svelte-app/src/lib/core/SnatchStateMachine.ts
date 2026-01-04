/**
 * SnatchStateMachine - Core phase detection logic for kettlebell snatch
 * INVARIANT: This class logic must remain unchanged per spec
 */

import type { PoseData } from '../types';

export enum SnatchPhase {
	FOUNDATIONAL_START = 'FOUNDATIONAL_START',
	HIKE_PASS = 'HIKE_PASS',
	ACCELERATION = 'ACCELERATION',
	PUNCH_THROUGH = 'PUNCH_THROUGH',
	LOCKOUT = 'LOCKOUT',
	DROP = 'DROP',
	BACKSWING = 'BACKSWING',
	REDIRECT = 'REDIRECT'
}

export interface SnatchEvent {
	type: 'PHASE_CHANGE' | 'REP_COMPLETE' | 'SET_START' | 'SET_END';
	phase?: SnatchPhase;
	velocity?: number;
	peakVelocity?: number;
	power?: number;
	work?: number;
}

interface GatingConditions {
	nearFloor: boolean;
	elbowStraight: boolean;
	hipsHinged: boolean;
	movingUp: boolean;
	lockoutHold: boolean;
}

export class SnatchStateMachine {
	private currentPhase: SnatchPhase = SnatchPhase.FOUNDATIONAL_START;
	private previousPhase: SnatchPhase = SnatchPhase.FOUNDATIONAL_START;
	private phaseStartTime: number = 0;
	private lockoutHoldFrames: number = 0;
	private staticFrames: number = 0;
	private isSetActive: boolean = false;
	private repStartTime: number = 0;
	private peakVelocityThisRep: number = 0;

	// Thresholds
	private readonly FLOOR_THRESHOLD = 0.75; // Y position (normalized, 0=top, 1=bottom)
	private readonly ELBOW_STRAIGHT_ANGLE = 160; // degrees
	private readonly HIP_HINGE_ANGLE = 130; // degrees
	private readonly VELOCITY_THRESHOLD = 0.3; // m/s
	private readonly LOCKOUT_HOLD_FRAMES = 15; // ~0.5s at 30fps
	private readonly STATIC_FRAMES_THRESHOLD = 90; // ~3s at 30fps
	private readonly SET_START_VELOCITY = 0.5; // m/s

	update(pose: PoseData, velocity: number, timestamp: number): SnatchEvent | null {
		// Check auto set start
		if (!this.isSetActive && velocity > this.SET_START_VELOCITY) {
			this.isSetActive = true;
			this.repStartTime = timestamp;
			return { type: 'SET_START' };
		}

		// Check auto set end (static detection)
		if (this.isSetActive && velocity < 0.1) {
			this.staticFrames++;
			if (this.staticFrames >= this.STATIC_FRAMES_THRESHOLD && this.isNearFloor(pose)) {
				this.isSetActive = false;
				this.staticFrames = 0;
				this.currentPhase = SnatchPhase.FOUNDATIONAL_START;
				return { type: 'SET_END' };
			}
		} else {
			this.staticFrames = 0;
		}

		if (!this.isSetActive) return null;

		// Track peak velocity for this rep
		if (velocity > this.peakVelocityThisRep) {
			this.peakVelocityThisRep = velocity;
		}

		// Calculate gating conditions
		const conditions = this.calculateGatingConditions(pose, velocity);

		// Phase transitions
		const newPhase = this.determinePhase(conditions, velocity);

		if (newPhase !== this.currentPhase) {
			this.previousPhase = this.currentPhase;
			this.currentPhase = newPhase;
			this.phaseStartTime = timestamp;
			this.lockoutHoldFrames = 0;

			// Check for rep completion (LOCKOUT -> DROP transition)
			if (this.previousPhase === SnatchPhase.LOCKOUT && newPhase === SnatchPhase.DROP) {
				const repEvent: SnatchEvent = {
					type: 'REP_COMPLETE',
					phase: newPhase,
					velocity: velocity,
					peakVelocity: this.peakVelocityThisRep
				};
				this.peakVelocityThisRep = 0;
				return repEvent;
			}

			return {
				type: 'PHASE_CHANGE',
				phase: newPhase
			};
		}

		// Track lockout hold
		if (this.currentPhase === SnatchPhase.LOCKOUT) {
			this.lockoutHoldFrames++;
		}

		return null;
	}

	private calculateGatingConditions(pose: PoseData, velocity: number): GatingConditions {
		return {
			nearFloor: this.isNearFloor(pose),
			elbowStraight: this.isElbowStraight(pose),
			hipsHinged: this.areHipsHinged(pose),
			movingUp: velocity > this.VELOCITY_THRESHOLD,
			lockoutHold: this.lockoutHoldFrames >= this.LOCKOUT_HOLD_FRAMES
		};
	}

	private determinePhase(conditions: GatingConditions, velocity: number): SnatchPhase {
		const { nearFloor, elbowStraight, hipsHinged, movingUp, lockoutHold } = conditions;

		switch (this.currentPhase) {
			case SnatchPhase.FOUNDATIONAL_START:
				if (nearFloor && hipsHinged && movingUp) {
					return SnatchPhase.HIKE_PASS;
				}
				break;

			case SnatchPhase.HIKE_PASS:
				if (!nearFloor && movingUp && velocity > 1.0) {
					return SnatchPhase.ACCELERATION;
				}
				break;

			case SnatchPhase.ACCELERATION:
				if (velocity > 2.0 && !elbowStraight) {
					return SnatchPhase.PUNCH_THROUGH;
				}
				// Fallback: if velocity drops significantly
				if (velocity < 0.5) {
					return SnatchPhase.BACKSWING;
				}
				break;

			case SnatchPhase.PUNCH_THROUGH:
				if (elbowStraight && velocity < 0.5) {
					return SnatchPhase.LOCKOUT;
				}
				break;

			case SnatchPhase.LOCKOUT:
				if (lockoutHold && velocity < -0.3) {
					return SnatchPhase.DROP;
				}
				break;

			case SnatchPhase.DROP:
				if (velocity < -1.0) {
					return SnatchPhase.BACKSWING;
				}
				break;

			case SnatchPhase.BACKSWING:
				if (nearFloor && hipsHinged) {
					return SnatchPhase.REDIRECT;
				}
				break;

			case SnatchPhase.REDIRECT:
				if (movingUp && velocity > 0.5) {
					return SnatchPhase.HIKE_PASS;
				}
				// Timeout fallback
				if (Date.now() - this.phaseStartTime > 3000) {
					return SnatchPhase.FOUNDATIONAL_START;
				}
				break;
		}

		return this.currentPhase;
	}

	private isNearFloor(pose: PoseData): boolean {
		const wrist = pose.wrist;
		return wrist.y > this.FLOOR_THRESHOLD;
	}

	private isElbowStraight(pose: PoseData): boolean {
		const { shoulder, elbow, wrist } = pose;

		const upperArm = {
			x: elbow.x - shoulder.x,
			y: elbow.y - shoulder.y,
			z: (elbow.z || 0) - (shoulder.z || 0)
		};

		const forearm = {
			x: wrist.x - elbow.x,
			y: wrist.y - elbow.y,
			z: (wrist.z || 0) - (elbow.z || 0)
		};

		const angle = this.angleBetween(upperArm, forearm);
		return angle > this.ELBOW_STRAIGHT_ANGLE;
	}

	private areHipsHinged(pose: PoseData): boolean {
		const { shoulder, hip, knee } = pose;

		const torso = {
			x: shoulder.x - hip.x,
			y: shoulder.y - hip.y,
			z: (shoulder.z || 0) - (hip.z || 0)
		};

		const thigh = {
			x: knee.x - hip.x,
			y: knee.y - hip.y,
			z: (knee.z || 0) - (hip.z || 0)
		};

		const angle = this.angleBetween(torso, thigh);
		return angle < this.HIP_HINGE_ANGLE;
	}

	private angleBetween(v1: { x: number; y: number; z: number }, v2: { x: number; y: number; z: number }): number {
		const dot = v1.x * v2.x + v1.y * v2.y + v1.z * v2.z;
		const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y + v1.z * v1.z);
		const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y + v2.z * v2.z);

		if (mag1 === 0 || mag2 === 0) return 0;

		const cosAngle = dot / (mag1 * mag2);
		return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);
	}

	getCurrentPhase(): SnatchPhase {
		return this.currentPhase;
	}

	isActive(): boolean {
		return this.isSetActive;
	}

	reset(): void {
		this.currentPhase = SnatchPhase.FOUNDATIONAL_START;
		this.previousPhase = SnatchPhase.FOUNDATIONAL_START;
		this.isSetActive = false;
		this.staticFrames = 0;
		this.lockoutHoldFrames = 0;
		this.peakVelocityThisRep = 0;
	}
}
