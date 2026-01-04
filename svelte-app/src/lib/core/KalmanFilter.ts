/**
 * Kalman Filter for smoothing velocity and position tracking
 */

export class KalmanFilter {
	private x: number; // State estimate
	private P: number; // Estimate error covariance
	private Q: number; // Process noise covariance
	private R: number; // Measurement noise covariance
	private K: number; // Kalman gain

	constructor(processNoise: number = 0.001, measurementNoise: number = 0.1, initialValue: number = 0) {
		this.x = initialValue;
		this.P = 1;
		this.Q = processNoise;
		this.R = measurementNoise;
		this.K = 0;
	}

	filter(measurement: number): number {
		// Prediction
		// x = x (no state transition in this simple model)
		this.P = this.P + this.Q;

		// Update
		this.K = this.P / (this.P + this.R);
		this.x = this.x + this.K * (measurement - this.x);
		this.P = (1 - this.K) * this.P;

		return this.x;
	}

	reset(value: number = 0): void {
		this.x = value;
		this.P = 1;
		this.K = 0;
	}

	getCurrentEstimate(): number {
		return this.x;
	}
}

/**
 * Velocity Kalman Filter - specialized for 3D velocity vectors
 */
export class VelocityKalmanFilter {
	private xFilter: KalmanFilter;
	private yFilter: KalmanFilter;
	private zFilter: KalmanFilter;
	private lastPosition: { x: number; y: number; z: number } | null = null;
	private lastTimestamp: number | null = null;

	constructor(processNoise: number = 0.001, measurementNoise: number = 0.1) {
		this.xFilter = new KalmanFilter(processNoise, measurementNoise);
		this.yFilter = new KalmanFilter(processNoise, measurementNoise);
		this.zFilter = new KalmanFilter(processNoise, measurementNoise);
	}

	update(position: { x: number; y: number; z: number }, timestamp: number): { x: number; y: number; z: number; magnitude: number } {
		if (this.lastPosition === null || this.lastTimestamp === null) {
			this.lastPosition = position;
			this.lastTimestamp = timestamp;
			return { x: 0, y: 0, z: 0, magnitude: 0 };
		}

		const dt = (timestamp - this.lastTimestamp) / 1000; // Convert to seconds
		if (dt <= 0) {
			return { x: 0, y: 0, z: 0, magnitude: 0 };
		}

		// Calculate raw velocity
		const rawVelocity = {
			x: (position.x - this.lastPosition.x) / dt,
			y: (position.y - this.lastPosition.y) / dt,
			z: (position.z - this.lastPosition.z) / dt
		};

		// Apply Kalman filtering
		const filteredVelocity = {
			x: this.xFilter.filter(rawVelocity.x),
			y: this.yFilter.filter(rawVelocity.y),
			z: this.zFilter.filter(rawVelocity.z)
		};

		// Calculate magnitude
		const magnitude = Math.sqrt(
			filteredVelocity.x * filteredVelocity.x +
			filteredVelocity.y * filteredVelocity.y +
			filteredVelocity.z * filteredVelocity.z
		);

		this.lastPosition = position;
		this.lastTimestamp = timestamp;

		return { ...filteredVelocity, magnitude };
	}

	reset(): void {
		this.xFilter.reset();
		this.yFilter.reset();
		this.zFilter.reset();
		this.lastPosition = null;
		this.lastTimestamp = null;
	}
}
