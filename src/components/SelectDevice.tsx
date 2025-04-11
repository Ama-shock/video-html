import { ReactElement } from 'react';

type SelectDeviceProps = {
    devices: MediaDeviceInfo[];
    current: string;
    onChange: (pick: string)=>void;
};

export default ({ devices, current, onChange }: SelectDeviceProps) => (
    <select onChange={(ev)=>onChange(ev.target.value)}>
        { devices.map(
            device => (
                <option
                    value={device.deviceId}
                    selected={device.deviceId === current}
                    >{ device.label }
                </option>
            )
        ) }
    </select>
);
