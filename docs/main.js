document.addEventListener('DOMContentLoaded', ()=>{ 
    const video = document.createElement('video');
    video.width = 1920;
    video.height = 1080;
    video.autoplay = false;
    video.controls = false;
    video.volume = 1;
    document.body.append(video);

    const button = document.createElement('button');
    button.innerText = 'start';
    button.style.display = 'block';
    document.body.append(button);
    button.addEventListener('click', async () => {
        document.body.removeChild(button);
        await captureStream();
        await enumerateDevices();
        await captureStream();
    }, { once: true });
    

    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = 0;
    volume.max = 100;
    volume.value = 100;
    volume.addEventListener('change', ()=>{
        video.volume = volume.value / 100;
    });
    document.body.append(volume);
    
    const videoSelect = document.createElement('select');
    const audioSelect = document.createElement('select');

    const fullScreen = document.createElement('button');
    fullScreen.innerText = 'fullScreen';
    fullScreen.addEventListener('click', () => document.querySelector('video').requestFullscreen() );
    
    async function enumerateDevices() {
        const devices = await navigator.mediaDevices.enumerateDevices();

        devices.filter(d=>d.kind === 'videoinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
            .forEach(device=>{
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.innerText = device.label;
                videoSelect.append(option);
            });
        document.body.append(videoSelect);
        videoSelect.value = '';
        videoSelect.addEventListener('change', captureStream);

        devices.filter(d=>d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
            .forEach(device=>{
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.innerText = device.label;
                audioSelect.append(option);
            });
        document.body.append(audioSelect);
        audioSelect.value = '';
        audioSelect.addEventListener('change', captureStream);

        document.body.append(fullScreen);
        
        if(localStorage.videoDevice) videoSelect.value = localStorage.videoDevice;
        if(localStorage.audioDevice) audioSelect.value = localStorage.audioDevice;
    } 

    async function captureStream() {
        const videoDevice = videoSelect.value || undefined;
        const audioDevice = audioSelect.value || undefined;
        video.srcObject?.getTracks().forEach(track=>track.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                deviceId: { exact: videoDevice },
                width: 1920,
                height: 1080
            },
            audio: {
                deviceId: { exact: audioDevice },
                suppressLocalAudioPlayback: false,
                echoCancellation: false,
                noiseSuppression: false,
                latency: 0
            }
        });

        video.srcObject = stream;
        await video.play();

        if(videoDevice) localStorage.videoDevice = videoDevice;
        if(audioDevice) localStorage.audioDevice = audioDevice;
    }

});
