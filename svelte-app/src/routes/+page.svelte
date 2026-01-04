<script lang="ts">
	import { onMount } from 'svelte';
	import { SnatchStateMachine, SnatchPhase } from '$lib/core/SnatchStateMachine';
	import { CalibrationSystem } from '$lib/core/Calibration';
	import { PhysicsEngine } from '$lib/core/Physics';
	import { TrackingSystem } from '$lib/tracking/TrackingSystem';
	import { DataLogger } from '$lib/data/DataLogger';
	import type { TrackingMode } from '$lib/types';
	import MetricsDisplay from '$lib/components/MetricsDisplay.svelte';
	import DebugOverlay from '$lib/components/DebugOverlay.svelte';
	import TrailVisualization from '$lib/components/TrailVisualization.svelte';

	let videoElement: HTMLVideoElement;
	let canvasElement: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D;

	// State
	let isInitialized = $state(false);
	let showDebug = $state(false);
	let isCalibrating = $state(false);
	let calibrationProgress = $state(0);
	let userHeight = $state(170); // cm
	let kettlebellWeight = $state(16); // kg
	let trackingMode: TrackingMode = $state('holistic-finger');

	// Metrics
	let currentVelocity = $state(0);
	let peakVelocity = $state(0);
	let reps = $state(0);
	let currentPhase = $state(SnatchPhase.FOUNDATIONAL_START);
	let power = $state(0);
	let work = $state(0);
	let trailPoints: Array<{ x: number; y: number; opacity: number }> = $state([]);

	// Core systems
	let stateMachine: SnatchStateMachine;
	let calibration: CalibrationSystem;
	let physics: PhysicsEngine;
	let tracker: TrackingSystem;
	let logger: DataLogger;

	// Debug data
	let debugData = $state({
		nearFloor: false,
		elbowStraight: false,
		hipsHinged: false,
		movingUp: false,
		lockoutHold: false,
		elbowAngle: 0,
		hipAngle: 0
	});

	onMount(async () => {
		// Initialize canvas
		ctx = canvasElement.getContext('2d')!;

		// Initialize systems
		stateMachine = new SnatchStateMachine();
		calibration = new CalibrationSystem();
		physics = new PhysicsEngine(kettlebellWeight);
		tracker = new TrackingSystem(trackingMode);
		logger = new DataLogger();

		// Request camera
		const stream = await navigator.mediaDevices.getUserMedia({
			video: {
				facingMode: 'user',
				width: { ideal: 1280 },
				height: { ideal: 720 }
			}
		});
		videoElement.srcObject = stream;

		// Wait for video to load
		await new Promise((resolve) => {
			videoElement.onloadedmetadata = resolve;
		});

		// Initialize tracker
		await tracker.initialize(videoElement);

		isInitialized = true;

		// Start main loop
		requestAnimationFrame(mainLoop);
	});

	async function mainLoop(timestamp: number) {
		requestAnimationFrame(mainLoop);

		if (!isInitialized) return;

		// Resize canvas
		if (canvasElement.width !== window.innerWidth || canvasElement.height !== window.innerHeight) {
			canvasElement.width = window.innerWidth;
			canvasElement.height = window.innerHeight;
		}

		// Clear canvas
		ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);

		// Draw video (mirrored)
		ctx.save();
		ctx.scale(-1, 1);
		ctx.drawImage(videoElement, -canvasElement.width, 0, canvasElement.width, canvasElement.height);
		ctx.restore();

		// Track
		const result = await tracker.track(videoElement, timestamp);

		if (!result) return;

		// Calibration mode
		if (isCalibrating) {
			calibrationProgress = calibration.captureFrame(result.pose, canvasElement.height);

			if (calibration.isComplete()) {
				calibration.finalize(userHeight, canvasElement.height);
				isCalibrating = false;
			}
			return;
		}

		// Skip if not calibrated
		if (!calibration.getData()) return;

		// Update metrics
		const velocityMagnitude = calibration.toMeters(result.velocity.magnitude, canvasElement.height);
		currentVelocity = velocityMagnitude;

		// Update state machine
		const event = stateMachine.update(result.pose, velocityMagnitude, timestamp);

		if (event) {
			if (event.type === 'PHASE_CHANGE' && event.phase) {
				currentPhase = event.phase;
			}

			if (event.type === 'REP_COMPLETE') {
				reps++;
				if (event.peakVelocity && event.peakVelocity > peakVelocity) {
					peakVelocity = event.peakVelocity;
				}

				// Log rep
				logger.logRep({
					repNumber: reps,
					peakVelocity: event.peakVelocity || 0,
					avgVelocity: velocityMagnitude,
					power,
					work,
					timestamp: Date.now(),
					phase: currentPhase
				});
			}
		}

		// Update physics
		const trackedHeight = calibration.toMeters(result.trackedPoint.y, canvasElement.height);
		const physicsMetrics = physics.updateMetrics(trackedHeight, velocityMagnitude, event?.type === 'REP_COMPLETE');
		power = physicsMetrics.power;
		work = physicsMetrics.work;

		// Update trail
		updateTrail(result.trackedPoint.x * canvasElement.width, result.trackedPoint.y * canvasElement.height);

		// Update debug data
		if (showDebug) {
			updateDebugData(result.pose, velocityMagnitude);
		}
	}

	function updateTrail(x: number, y: number) {
		// Add new point
		trailPoints.push({ x, y, opacity: 1.0 });

		// Fade and remove old points
		trailPoints = trailPoints
			.map((p) => ({ ...p, opacity: p.opacity - 0.02 }))
			.filter((p) => p.opacity > 0)
			.slice(-50); // Keep last 50 points
	}

	function updateDebugData(pose: any, velocity: number) {
		debugData.movingUp = velocity > 0.3;
		debugData.nearFloor = pose.wrist.y > 0.75;
		// Calculate angles (simplified)
		debugData.elbowAngle = 160; // Placeholder
		debugData.hipAngle = 130; // Placeholder
		debugData.elbowStraight = debugData.elbowAngle > 160;
		debugData.hipsHinged = debugData.hipAngle < 130;
		debugData.lockoutHold = currentPhase === SnatchPhase.LOCKOUT;
	}

	function startCalibration() {
		calibration.reset();
		isCalibrating = true;
		calibrationProgress = 0;
	}

	function recalibrate() {
		if (!stateMachine.isActive()) {
			startCalibration();
		}
	}

	function toggleDebug() {
		showDebug = !showDebug;
	}
</script>

<div class="fixed inset-0 bg-black">
	<!-- Video (hidden) -->
	<video bind:this={videoElement} class="hidden" playsinline muted autoplay></video>

	<!-- Canvas -->
	<canvas bind:this={canvasElement} class="absolute inset-0 w-full h-full"></canvas>

	<!-- Trail Visualization -->
	<TrailVisualization points={trailPoints} />

	<!-- UI Layer -->
	<div class="absolute inset-0 pointer-events-none">
		<!-- Header -->
		<div class="absolute top-4 left-0 right-0 flex justify-between items-center px-6">
			<h1 class="text-2xl font-bold tracking-tight text-gray-100">
				IRON EYE <span class="text-copper">VBT</span>
			</h1>

			<button
				onclick={toggleDebug}
				class="pointer-events-auto px-4 py-2 bg-gray-800 text-copper border border-copper rounded-lg hover:bg-gray-700 transition-colors"
			>
				{showDebug ? 'Hide Debug' : 'Show Debug'}
			</button>
		</div>

		<!-- Metrics Display -->
		<MetricsDisplay
			{currentVelocity}
			{peakVelocity}
			{reps}
			phase={currentPhase}
			{power}
			{work}
		/>

		<!-- Debug Overlay -->
		{#if showDebug}
			<DebugOverlay data={debugData} />
		{/if}

		<!-- Calibration Overlay -->
		{#if isCalibrating}
			<div class="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
				<div class="text-center">
					<div class="text-4xl font-bold text-copper mb-4">CALIBRATING</div>
					<div class="text-xl text-gray-300">Stand tall, hold still</div>
					<div class="mt-6 w-64 h-2 bg-gray-700 rounded-full overflow-hidden">
						<div
							class="h-full bg-copper transition-all duration-100"
							style="width: {calibrationProgress * 100}%"
						></div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Status Text -->
		{#if !calibration.getData() && !isCalibrating}
			<div class="absolute bottom-20 left-0 right-0 text-center">
				<button
					onclick={startCalibration}
					class="pointer-events-auto px-8 py-4 bg-copper text-black font-bold rounded-lg hover:bg-copper/80 transition-colors text-xl"
				>
					Start Calibration
				</button>
			</div>
		{/if}

		{#if calibration.getData() && !stateMachine.isActive()}
			<div class="absolute bottom-20 left-0 right-0 text-center">
				<div class="text-xl text-gray-300 mb-4">Ready to track. Start moving!</div>
				<button
					onclick={recalibrate}
					class="pointer-events-auto px-6 py-3 bg-gray-800 border border-copper text-copper rounded-lg hover:bg-gray-700 transition-colors"
				>
					Recalibrate
				</button>
			</div>
		{/if}
	</div>
</div>
