

type CaptureProps = {
    audio?: string;
    video?: string;
    width: number;
    height: number;
};

export default class MediaDeviceHandler {
    static async accessPermission() : Promise<boolean> {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            this.stop(stream);
            return true;
        } catch (err) {
            console.error(err);
            return false;
        }
    }

    static async enumerate() {
        const detected = await navigator.mediaDevices.enumerateDevices();
        const selectable = detected.filter(({ deviceId })=> !['default', 'communications', ''].includes(deviceId));
        const videos = selectable.filter(({ kind })=> kind === 'videoinput');
        const audios = selectable.filter(({ kind })=> kind === 'audioinput');
        return { videos, audios };
    } 

    static async capture({ audio, video, width, height }: CaptureProps) : Promise<MediaStream> {
        return navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: video,
                width: width,
                height: height
            },
            audio: {
                deviceId: audio,
                suppressLocalAudioPlayback: false,
                echoCancellation: false,
                noiseSuppression: false,
                latency: 0
            }
        });
    }

    static stop(stream: MediaStream) : void {
        stream.getTracks().forEach(track=>track.stop());
    }
}