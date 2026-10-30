// Emphasis-zoom envelope for talking-head reels (idea from louisedesadeleer/add-zooms, MIT).
// The whole clip is ONE zoom(t) curve: each event gives its own zoom, the result is max(1, all).
//   punch    {type:"punch", t, peak, hold}            hard cut in on the word, hold, hard cut out
//   ratchet  {type:"ratchet", steps:[[t,peak],...], hold}  listicle: each item cuts one level deeper
//   kenburns {type:"kenburns", t0, t1, peak}           the ONLY smooth move: slow push over an insight line
// Taste: punch 1.18-1.30, kenburns <= 1.14, leave most lines at 1.0, never past ~1.35.

export type ZoomEvent =
	| { type: "punch"; t: number; peak: number; hold?: number; label?: string }
	| { type: "ratchet"; steps: [number, number][]; hold?: number; label?: string }
	| { type: "kenburns"; t0: number; t1: number; peak: number; label?: string }
	| { type: "ramp"; t0: number; t1: number; peak: number; hold?: number; label?: string }
	| { type: "drop"; t: number; peak: number; dur?: number; label?: string };

const KB_RELEASE = 0.5; // Ken Burns glides back out over this many seconds

const eventZoom = (e: ZoomEvent, t: number): number => {
	if (e.type === "punch") return t >= e.t && t < e.t + (e.hold ?? 0.5) ? e.peak : 1;
	if (e.type === "ramp") {
		const hold = e.hold ?? 0.4;
		if (t < e.t0 || t >= e.t1 + hold) return 1;
		if (t >= e.t1) return e.peak;
		const u = (t - e.t0) / Math.max(0.001, e.t1 - e.t0);
		return 1 + (e.peak - 1) * u * u * u; // accelerating dive
	}
	if (e.type === "drop") {
		const dur = e.dur ?? 0.5;
		if (t < e.t || t >= e.t + dur) return 1;
		const u = (t - e.t) / dur;
		return 1 + (e.peak - 1) * Math.pow(1 - u, 3); // fast settle
	}
	if (e.type === "ratchet") {
		const hold = e.hold ?? 0.45;
		const last = e.steps[e.steps.length - 1];
		if (t < e.steps[0][0] || t >= last[0] + hold) return 1;
		let z = 1;
		for (const [at, peak] of e.steps) if (t >= at) z = peak;
		return z;
	}
	if (t < e.t0 || t >= e.t1 + KB_RELEASE) return 1;
	if (t <= e.t1) return 1 + (e.peak - 1) * ((t - e.t0) / Math.max(0.001, e.t1 - e.t0));
	const out = (t - e.t1) / KB_RELEASE;
	return 1 + (e.peak - 1) * (1 - out * out * (3 - 2 * out)); // smoothstep release
};

export const zoomAt = (events: ZoomEvent[], t: number): number =>
	events.reduce((z, e) => Math.max(z, eventZoom(e, t)), 1);

// Old Reel4 data: punch times cycling through fixed levels, each level held until the next punch.
export const zoomsFromPunches = (times: number[], levels = [1.12, 1, 1.18, 1.06]): ZoomEvent[] =>
	times.flatMap((t, i) => {
		const peak = levels[i % levels.length];
		const hold = (times[i + 1] ?? Infinity) - t;
		return peak > 1 ? [{ type: "punch" as const, t, peak, hold }] : [];
	});
