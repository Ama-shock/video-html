import { ReactElement } from 'react';

type VolumeProps = {
    volume: number;
    onChange: (volume: number)=>void;
};

export default ({ volume, onChange }: VolumeProps) => (
    <input
        type='range'
        min={0}
        max={100}
        step={1}
        value={volume}
        onChange={(ev)=>onChange(Number(ev.target.value))}
        />
);
