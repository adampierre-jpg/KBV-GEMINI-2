<script lang="ts">
	import type { SnatchPhase } from '$lib/core/SnatchStateMachine';

	interface Props {
		currentVelocity: number;
		peakVelocity: number;
		reps: number;
		phase: SnatchPhase;
		power: number;
		work: number;
	}

	let { currentVelocity, peakVelocity, reps, phase, power, work }: Props = $props();
</script>

<div class="absolute top-20 left-6 pointer-events-none">
	<div class="bg-gradient-to-br from-gray-900/90 to-gray-800/80 backdrop-blur-sm rounded-xl p-6 border border-gray-700/50 shadow-2xl">
		<!-- Primary Metrics -->
		<div class="space-y-4">
			<!-- Velocity -->
			<div>
				<div class="text-gray-400 text-sm uppercase tracking-wider mb-1">Velocity</div>
				<div class="text-copper font-mono text-5xl font-bold">
					{currentVelocity.toFixed(2)}
					<span class="text-2xl text-gray-400 ml-1">m/s</span>
				</div>
			</div>

			<!-- Peak Velocity -->
			<div>
				<div class="text-gray-400 text-sm uppercase tracking-wider mb-1">Peak</div>
				<div class="text-copper/70 font-mono text-3xl font-bold">
					{peakVelocity.toFixed(2)}
					<span class="text-lg text-gray-400 ml-1">m/s</span>
				</div>
			</div>

			<!-- Divider -->
			<div class="h-px bg-gray-700"></div>

			<!-- Secondary Metrics -->
			<div class="grid grid-cols-2 gap-4 text-sm">
				<div>
					<div class="text-gray-500 uppercase tracking-wider mb-1">Reps</div>
					<div class="text-gray-200 font-mono text-2xl font-bold">{reps}</div>
				</div>

				<div>
					<div class="text-gray-500 uppercase tracking-wider mb-1">Phase</div>
					<div class="text-gray-300 font-mono text-xs truncate">{phase}</div>
				</div>

				<div>
					<div class="text-gray-500 uppercase tracking-wider mb-1">Power</div>
					<div class="text-gray-200 font-mono text-lg">
						{power.toFixed(0)}
						<span class="text-xs text-gray-500">W</span>
					</div>
				</div>

				<div>
					<div class="text-gray-500 uppercase tracking-wider mb-1">Work</div>
					<div class="text-gray-200 font-mono text-lg">
						{work.toFixed(0)}
						<span class="text-xs text-gray-500">J</span>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
