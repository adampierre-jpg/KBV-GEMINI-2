<script lang="ts">
	interface TrailPoint {
		x: number;
		y: number;
		opacity: number;
	}

	interface Props {
		points: TrailPoint[];
	}

	let { points }: Props = $props();
</script>

<svg class="absolute inset-0 w-full h-full pointer-events-none">
	{#if points.length > 1}
		{#each points.slice(0, -1) as point, i}
			{@const nextPoint = points[i + 1]}
			<line
				x1={point.x}
				y1={point.y}
				x2={nextPoint.x}
				y2={nextPoint.y}
				stroke="#b87333"
				stroke-width="3"
				stroke-linecap="round"
				opacity={point.opacity * 0.7}
			/>
		{/each}
	{/if}

	<!-- Current point -->
	{#if points.length > 0}
		{@const current = points[points.length - 1]}
		<circle
			cx={current.x}
			cy={current.y}
			r="6"
			fill="#b87333"
			opacity="0.9"
		/>
	{/if}
</svg>

<style>
	svg {
		filter: drop-shadow(0 0 4px rgba(184, 115, 51, 0.5));
	}
</style>
