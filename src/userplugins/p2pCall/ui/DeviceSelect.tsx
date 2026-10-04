import { Select, useEffect, useState } from "@webpack/common";

export function DeviceSelect({ kind, value, onChange }: { kind: MediaDeviceKind; value: string; onChange(v: string): void; }) {
    const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
    const [selected, setSelected] = useState(value);
    useEffect(() => {
        navigator.mediaDevices.enumerateDevices().then(d => setDevices(d.filter(x => x.kind === kind)));
    }, [kind]);
    const options = [
        { label: "По умолчанию", value: "default" },
        ...devices.filter(d => d.deviceId !== "default").map(d => ({ label: d.label || d.deviceId.slice(0, 8), value: d.deviceId })),
    ];
    return (
        <Select
            options={options}
            isSelected={v => v === selected}
            select={v => { setSelected(v); onChange(v); }}
            serialize={String}
        />
    );
}
