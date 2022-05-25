const AndroidRemote = require('androidtv-remote').AndroidRemote;
const RemoteKeyCode = require('androidtv-remote').RemoteKeyCode;
const RemoteDirection = require('androidtv-remote').RemoteDirection;
const PubNub = require('pubnub');
const Readline = require('readline');
const fs = require('fs');
const http = require('http');

require('dotenv').config()

const line = Readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const pubnub = new PubNub({
    publishKey: process.env.PUBNUB_PUBLISH_KEY,
    subscribeKey: process.env.PUBNUB_SUBSCRIBE_KEY,
    uuid: process.env.PUBNUB_UUID,
});

const host = process.env.TV_HOST || '192.168.1.163';
const options = {
    pairing_port: 6467,
    remote_port: 6466,
    name: 'androidtv-remote',
    cert: getCert(),
}

const androidRemote = new AndroidRemote(host, options);

androidRemote.on('secret', () => {
    line.question("Code : ", async (code) => {
        androidRemote.sendCode(code);
    });
});

androidRemote.on('current_app', (current_app) => {
    console.debug("Current App : " + current_app);
});

// const keys = [
//     RemoteKeyCode.KEYCODE_DPAD_UP,
//     RemoteKeyCode.KEYCODE_DPAD_DOWN,
//     RemoteKeyCode.KEYCODE_DPAD_LEFT,
//     RemoteKeyCode.KEYCODE_DPAD_RIGHT,
//     RemoteKeyCode.KEYCODE_DPAD_CENTER,
//     RemoteKeyCode.KEYCODE_VOLUME_UP,
//     RemoteKeyCode.KEYCODE_VOLUME_DOWN,
//     RemoteKeyCode.KEYCODE_POWER,
//     RemoteKeyCode.KEYCODE_ENTER,
//     RemoteKeyCode.KEYCODE_SEARCH,
//     RemoteKeyCode.KEYCODE_VOLUME_MUTE,
// ];

const listener = {
    message: async function (messageEvent) {
        const { channel, message } = messageEvent;
        switch (channel) {
            case 'keypad_navigation':
                remoteNamigation(message.direction, message.count);
                break;
            case 'keypad_select':
                remoteSelect();
                break;
            case 'remote_input':
                remoteInput(message.number);
                break;
            case 'power_controller':
                remotePower(message.powerState);
                break;
        }
    }
};

let powered = false;
androidRemote.on('powered', (powerState) => {
    powered = powerState;
});

androidRemote.on('ready', async () => {
    const cert = await androidRemote.getCertificate();
    storeCert(cert);

    pubnub.subscribe({
        channels: ['keypad_navigation', 'keypad_select', 'remote_input', 'power_controller'],
    });

    pubnub.removeListener(listener)
    pubnub.addListener(listener);
});

function getCert() {
    try {
        const rawData = fs.readFileSync('cert.json', 'utf8');
        return JSON.parse(rawData);
    } catch (err) {
        return {};
    }
}

function storeCert(cert) {
    try {
        fs.writeFileSync('cert.json', JSON.stringify(cert));
    } catch (err) {
        console.error(err);
    }
}

const remoteInput = async (number) => {
    androidRemote.sendKey(RemoteKeyCode.KEYCODE_HOME, RemoteDirection.SHORT);
    await new Promise(resolve => setTimeout(resolve, 1000));
    androidRemote.sendKey(RemoteKeyCode.KEYCODE_HOME, RemoteDirection.SHORT);
    await new Promise(resolve => setTimeout(resolve, 300));
    androidRemote.sendKey(RemoteKeyCode.KEYCODE_DPAD_UP, RemoteDirection.SHORT);
    await new Promise(resolve => setTimeout(resolve, 100));
    androidRemote.sendKey(RemoteKeyCode.KEYCODE_DPAD_UP, RemoteDirection.SHORT);
    await new Promise(resolve => setTimeout(resolve, 100));
    androidRemote.sendKey(RemoteKeyCode.KEYCODE_DPAD_RIGHT, RemoteDirection.SHORT);
    await new Promise(resolve => setTimeout(resolve, 100));
    androidRemote.sendKey(RemoteKeyCode.KEYCODE_DPAD_RIGHT, RemoteDirection.SHORT);
    await new Promise(resolve => setTimeout(resolve, 100));
    androidRemote.sendKey(RemoteKeyCode.KEYCODE_DPAD_CENTER, RemoteDirection.SHORT);
    await new Promise(resolve => setTimeout(resolve, 300));
    for (let i = 1; i < number; i++) {
        androidRemote.sendKey(RemoteKeyCode.KEYCODE_DPAD_DOWN, RemoteDirection.SHORT);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    androidRemote.sendKey(RemoteKeyCode.KEYCODE_DPAD_CENTER, RemoteDirection.SHORT);
}

const remoteNamigation = async (direction, count) => {
    const keyCodes = {
        up: RemoteKeyCode.KEYCODE_DPAD_UP,
        down: RemoteKeyCode.KEYCODE_DPAD_DOWN,
        left: RemoteKeyCode.KEYCODE_DPAD_LEFT,
        right: RemoteKeyCode.KEYCODE_DPAD_RIGHT,
        back: RemoteKeyCode.KEYCODE_BACK,
    };
    if (!keyCodes[direction]) {
        return;
    }
    for (let i = 0; i < count; i++) {
        androidRemote.sendKey(keyCodes[direction], RemoteDirection.SHORT);
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

const remoteSelect = () => {
    androidRemote.sendKey(RemoteKeyCode.KEYCODE_DPAD_CENTER, RemoteDirection.SHORT);
}

const remotePower = (powerState) => {
    if ((powered === false && powerState === 'ON') || (powered === true && powerState === 'OFF')) {
        androidRemote.sendKey(RemoteKeyCode.KEYCODE_POWER, RemoteDirection.SHORT);
    }
}

const started = androidRemote.start();

const requestListener = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const buffers = [];

    for await (const chunk of req) {
        buffers.push(chunk);
    }

    const data = Buffer.concat(buffers).toString();
    let json = {};
    try {
        json = JSON.parse(data);
        console.log(json);
    } catch (error) {
        console.error(error);
        res.writeHead(400);
        res.end({ error });
    }

    const { powerState } = json;

    const result = await pubnub.publish({
        channel: 'power_controller',
        message: { powerState },
    });

    console.log(result);

    res.writeHead(200);
    res.end(JSON.stringify(result));
};

const server = http.createServer(requestListener);

const serverPort = 3000;
const serverHost = '0.0.0.0';

server.listen(serverPort, serverHost, () => {
    console.log(`Server is running on http://${serverHost}:${serverPort}`);
});
