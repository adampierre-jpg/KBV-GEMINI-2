<script lang="ts">
	interface DebugData {
		nearFloor: boolean;
		elbowStraight: boolean;
		hipsHinged: boolean;
		movingUp: boolean;
		lockoutHold: boolean;
		elbowAngle: number;
		hipAngle: number;
	}

	interface Props {
		data: DebugData;
	}

	let { data }: Props = $props();

	function getStatusColor(condition: boolean): string {
		return condition ? 'text-green-400' : 'text-red-400';
	}

	function getStatusIcon(condition: boolean): string {
		return condition ? '✓' : '✗';
	}
</script>

<div class="absolute bottom-6 left-0 right-0 pointer-events-none">
	<div class="max-w-4xl mx-auto bg-gradient-to-br from-gray-900/90 to-gray-800/80 backdrop-blur-sm rounded-xl p-6 border border-copper/30 shadow-2xl">
		<div class="text-copper text-sm uppercase tracking-wider mb-4 font-bold">Debug Dashboard</div>

		<div class="grid grid-cols-5 gap-4 text-sm font-mono">
			<!-- Condition Checks -->
			<div class="text-center">
				<div class={getStatusColor(data.nearFloor) + ' text-2xl font-bold'}>
					{getStatusIcon(data.nearFloor)}
				</div>
				<div class="text-gray-400 text-xs mt-1">Near Floor</div>
			</div>

			<div class="text-center">
				<div class={getStatusColor(data.elbowStraight) + ' text-2xl font-bold'}>
					{getStatusIcon(data.elbowStraight)}
				</div>
				<div class="text-gray-400 text-xs mt-1">Elbow Straight</div>
				<div class="text-gray-500 text-xs">{data.elbowAngle.toFixed(0)}°</div>
			</div>

			<div class="text-center">
				<div class={getStatusColor(data.hipsHinged) + ' text-2xl font-bold'}>
					{getStatusIcon(data.hipsHinged)}
				</div>
				<div class="text-gray-400 text-xs mt-1">Hips Hinged</div>
				<div class="text-gray-500 text-xs">{data.hipAngle.toFixed(0)}°</div>
			</div>

			<div class="text-center">
				<div class={getStatusColor(data.movingUp) + ' text-2xl font-bold'}>
					{getStatusIcon(data.movingUp)}
				</div>
				<div class="text-gray-400 text-xs mt-1">Moving Up</div>
			</div>

			<div class="text-center">
				<div class={getStatusColor(data.lockoutHold) + ' text-2xl font-bold'}>
					{getStatusIcon(data.lockoutHold)}
				</div>
				<div class="text-gray-400 text-xs mt-1">Lockout Hold</div>
			</div>
		</div>
	</div>
</div>

<style>
	/* Copper skeleton overlay would be drawn on canvas in actual implementation */
</style>
