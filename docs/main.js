"use strict";
(() => {
  // src/BinaryCode.ts
  var BinaryCode = class extends Uint8Array {
    static fromHex(hex) {
      const bytes = new this(hex.length / 2);
      for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
      }
      return bytes;
    }
    static fromBase64(base64) {
      const binaryString = atob(base64);
      const bytes = new this(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes;
    }
    static fromBase64Url(base64url) {
      const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
      const padding = "=".repeat((4 - base64.length % 4) % 4);
      return this.fromBase64(base64 + padding);
    }
    static fromText(text) {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(text);
      return new this(bytes);
    }
    toHex() {
      return Array.from(this).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    toBase64() {
      return btoa(String.fromCharCode(...this));
    }
    toBase64Url() {
      const base64 = this.toBase64();
      return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    toText() {
      const decoder = new TextDecoder();
      return decoder.decode(this);
    }
  };

  // src/serviceWorker.ts
  async function initiateServiceWorker(global) {
    listenEvents(global, {
      async push(ev) {
        console.log("Caught Push Notification", ev);
        const payload = ev.data?.text() || "No payload";
        await global.registration.showNotification("Test Push Notification", {
          body: payload
        });
      },
      async install(ev) {
        console.log("SW installed", ev);
        global.skipWaiting();
      },
      async activate(ev) {
        console.log("SW activated", ev);
        await global.clients.claim();
      }
    });
  }
  var ServiceWorkerEvents = [
    "activate",
    "fetch",
    "install",
    "message",
    "messageerror",
    "notificationclick",
    "notificationclose",
    "push",
    "pushsubscriptionchange",
    "error",
    "languagechange",
    "offline",
    "online",
    "rejectionhandled",
    "unhandledrejection"
  ];
  function listenEvents(global, workerListener) {
    ServiceWorkerEvents.forEach((event) => {
      const eventListener = workerListener[event];
      if (!eventListener) return;
      global.addEventListener(event, (ev) => {
        const result = eventListener(ev);
        if ("waitUntil" in ev && result instanceof Promise) {
          ev.waitUntil(result);
        }
      });
    });
  }

  // src/window.ts
  async function registerDOM(window) {
    window.document.addEventListener("DOMContentLoaded", setDoms);
    Object.defineProperty(window, "subscribeNitification", { value: subscribeNitification });
    Object.defineProperty(window, "currentSubscription", { value: currentSubscription });
    Object.defineProperty(window, "unscribeNotification", { value: unscribeNotification });
  }
  async function subscribeNitification(applicationServerKey) {
    if (Notification.permission === "default") {
      const permission = await Notification.requestPermission();
    }
    if (Notification.permission !== "granted") {
      console.error("Permission denied");
      return;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      console.error("Service worker not registered");
      return;
    }
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });
    const key = subscription.getKey("p256dh");
    const auth = subscription.getKey("auth");
    const p256dh = key ? btoa(String.fromCharCode.apply(null, [...new Uint8Array(key)])) : "";
    const authKey = auth ? btoa(String.fromCharCode.apply(null, [...new Uint8Array(auth)])) : "";
    const endpoint = subscription.endpoint;
    console.log("Subscription:", JSON.stringify({
      endpoint,
      keys: {
        p256dh,
        auth: authKey
      }
    }, null, 4));
  }
  async function currentSubscription() {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      console.error("Service worker not registered");
      return;
    }
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      console.error("No subscription found");
      return;
    }
    const p256dh = new BinaryCode(subscription.getKey("p256dh") ?? []).toBase64();
    const authKey = new BinaryCode(subscription.getKey("auth") ?? []).toBase64();
    const serverKey = new BinaryCode(subscription.options.applicationServerKey ?? []).toBase64Url();
    console.log("Current Subscription:", {
      serverKey,
      endpoint: subscription.endpoint,
      expirationTime: subscription.expirationTime,
      keys: {
        p256dh,
        auth: authKey
      }
    });
  }
  async function unscribeNotification() {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      console.error("Service worker not registered");
      return;
    }
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      console.error("No subscription found");
      return;
    }
    await subscription.unsubscribe();
    console.log("Unsubscribed", subscription);
  }
  function setDoms() {
    const video = document.createElement("video");
    video.width = 1920;
    video.height = 1080;
    video.autoplay = false;
    video.controls = false;
    video.volume = 1;
    document.body.append(video);
    const button = document.createElement("button");
    button.innerText = "start";
    button.style.display = "block";
    document.body.append(button);
    button.addEventListener("click", async () => {
      document.body.removeChild(button);
      await captureStream();
      await enumerateDevices();
      await captureStream();
    }, { once: true });
    const volume = document.createElement("input");
    volume.type = "range";
    volume.min = "0";
    volume.max = "100";
    volume.value = "100";
    volume.addEventListener("change", () => {
      video.volume = Number(volume.value) / 100;
    });
    document.body.append(volume);
    const videoSelect = document.createElement("select");
    const audioSelect = document.createElement("select");
    const fullScreen = document.createElement("button");
    fullScreen.innerText = "fullScreen";
    fullScreen.addEventListener("click", () => document.querySelector("video")?.requestFullscreen());
    async function enumerateDevices() {
      const devices = await navigator.mediaDevices.enumerateDevices();
      devices.filter((d) => d.kind === "videoinput" && d.deviceId !== "default" && d.deviceId !== "communications").forEach((device) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.innerText = device.label;
        videoSelect.append(option);
      });
      document.body.append(videoSelect);
      videoSelect.value = "";
      videoSelect.addEventListener("change", captureStream);
      devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "default" && d.deviceId !== "communications").forEach((device) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.innerText = device.label;
        audioSelect.append(option);
      });
      document.body.append(audioSelect);
      audioSelect.value = "";
      audioSelect.addEventListener("change", captureStream);
      document.body.append(fullScreen);
      if (localStorage.videoDevice) videoSelect.value = localStorage.videoDevice;
      if (localStorage.audioDevice) audioSelect.value = localStorage.audioDevice;
    }
    async function captureStream() {
      const videoDevice = videoSelect.value || void 0;
      const audioDevice = audioSelect.value || void 0;
      if (video.srcObject instanceof MediaStream) {
        video.srcObject.getTracks().forEach((track) => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: videoDevice,
          width: 1920,
          height: 1080
        },
        audio: {
          deviceId: audioDevice,
          suppressLocalAudioPlayback: false,
          echoCancellation: false,
          noiseSuppression: false,
          latency: 0
        }
      });
      video.srcObject = stream;
      await video.play();
      if (videoDevice) localStorage.videoDevice = videoDevice;
      if (audioDevice) localStorage.audioDevice = audioDevice;
    }
  }

  // src/main.ts
  Object.defineProperty(globalThis, "BinaryCode", { value: BinaryCode });
  var env = globalThis;
  if ("Window" in env && env instanceof Window) {
    registerDOM(env);
    const scriptSrc = document.currentScript?.src;
    globalThis.navigator.serviceWorker.register(scriptSrc);
  }
  if ("ServiceWorkerGlobalScope" in env && env instanceof ServiceWorkerGlobalScope) {
    initiateServiceWorker(env);
  }
})();
//# sourceMappingURL=main.js.map
