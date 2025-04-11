import { ReactElement } from 'react';
import MediaDeviceHandler from '../MediaDeviceHandler';

type VideoProps = {
    stream: MediaStream|null;
    width: number;
    height: number;
    volume: number;
};

export default () => {
    const video = document.createElement('video');
    video.autoplay = false;
    video.controls = false;

    return ({ stream, width, height, volume }: VideoProps) => {
        video.width = width;
        video.height = height;
        video.volume = volume / 100;
        if (video.srcObject !== stream) {
            if(video.srcObject instanceof MediaStream) {
                MediaDeviceHandler.stop(video.srcObject);
            }
            video.srcObject = stream;
            if(stream) video.play();
            else video.pause();
        }

        return video;
    };
}
