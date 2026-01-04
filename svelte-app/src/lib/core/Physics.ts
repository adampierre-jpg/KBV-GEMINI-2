/**
 * Physics calculations for power and work
 */

export interface PhysicsMetrics {
	power: number; // Watts
	work: number; // Joules
	velocity: number; // m/s
	displacement: number; // meters
}

export class PhysicsEngine {
	private kettlebellMass: number; // kg
	private gravity: number = 9.81; // m/s²
	private totalWork: number = 0;
	private lastHeight: number | null = null;

	constructor(kettlebellWeightKg: number = 16) {
		this.kettlebellMass = kettlebellWeightKg;
	}

	/**
	 * Calculate instantaneous concentric power
	 * Power = Force × Velocity = (mass × gravity) × velocity
	 */
	calculatePower(velocity: number): number {
		if (velocity <= 0) return 0; // Only concentric (upward) movement
		const force = this.kettlebellMass * this.gravity;
		return force * velocity;
	}

	/**
	 * Calculate work done during a rep
	 * Work = Force × Displacement = (mass × gravity) × height change
	 */
	calculateWork(currentHeight: number, startHeight: number): number {
		const displacement = currentHeight - startHeight;
		if (displacement <= 0) return 0;
		return this.kettlebellMass * this.gravity * displacement;
	}

	/**
	 * Update metrics for current frame
	 */
	updateMetrics(height: number, velocity: number, isNewRep: boolean = false): PhysicsMetrics {
		if (isNewRep) {
			this.lastHeight = null;
			this.totalWork = 0;
		}

		const power = this.calculatePower(velocity);

		let work = 0;
		let displacement = 0;
		if (this.lastHeight !== null) {
			displacement = height - this.lastHeight;
			if (displacement > 0) {
				work = this.calculateWork(height, this.lastHeight);
				this.totalWork += work;
			}
		} else {
			this.lastHeight = height;
		}

		this.lastHeight = height;

		return {
			power,
			work: this.totalWork,
			velocity,
			displacement
		};
	}

	setKettlebellWeight(weightKg: number): void {
		this.kettlebellMass = weightKg;
	}

	reset(): void {
		this.totalWork = 0;
		this.lastHeight = null;
	}
}
