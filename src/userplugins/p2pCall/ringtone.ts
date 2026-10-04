/*
 * P2PCall — звук вызова (двухтональный сигнал раз в 2 с)
 */
let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

function beep(ac: AudioContext) {
    const t = ac.currentTime;
    for (const [freq, at] of [[880, 0], [660, 0.25]] as const) {
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.15, t + at);
        gain.gain.exponentialRampToValueAtTime(0.001, t + at + 0.22);
        osc.connect(gain).connect(ac.destination);
        osc.start(t + at);
        osc.stop(t + at + 0.23);
    }
}

export function startRingtone() {
    stopRingtone();
    ctx = new AudioContext();
    beep(ctx);
    timer = setInterval(() => ctx && beep(ctx), 2000);
}

export function stopRingtone() {
    clearInterval(timer);
    timer = undefined;
    ctx?.close().catch(() => { });
    ctx = null;
}
