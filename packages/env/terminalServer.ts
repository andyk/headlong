import { createServer, Socket } from 'net';
import { VirtualTerminal } from './htlib';
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env["OPENROUTER_API_KEY"],
})

//import { throttle } from 'lodash';

const REFRESH_RATE = 2000; // in milliseconds

const terminalServerPort = Number(process.env.BASH_SERVER_PORT) || 3031;

interface TermApp {
  windows: { [id: string]: VirtualTerminal };
  activeWindowID: string | null;
}

const termApp: TermApp = {
  windows: {},
  activeWindowID: null,
};

const server = createServer();

const sockets: Socket[] = [];

function writeToSockets(msg: string) {
  sockets.forEach((socket) => {
    socket.write(msg);
  });
}

async function newWindow(payload: any): Promise<void> {
  const { windowID, shellPath: shellPath = '/bin/bash', shellArgs: shellArgs = [] } = payload;
  const id = windowID || `window-${Math.random().toString(36).substring(7)}`;

  const vt = new VirtualTerminal({
    binary: shellPath,
    binaryArgs: shellArgs,
    spawnOptions: {
      cwd: process.cwd(),
      env: process.env,
    }
  })
  termApp.windows[id] = await vt.start();
  termApp.activeWindowID = id;

  writeToSockets(`observation: created window with ID ${id} and made it active window.`);

  termApp.windows[id].onExit(({ exitCode, signal }) => {
    writeToSockets(`observation: window '${id}' exited with code ${exitCode}, signal ${signal}.`);
    // Cleanup window from env.windows when it exits
    delete termApp.windows[id];
    if (termApp.activeWindowID === id) {
      termApp.activeWindowID = null; // Reset active window ID if the exited window was active
    }
  });
}

function typeInput(payload: any) {
  if (!termApp.activeWindowID) {
    writeToSockets('observation: there are no windows open.');
    return;
  }
  let { input } = payload;
  if (input === undefined) {
    console.log('input is undefined. you must provide an input argument');
    return;
  }
  // Dynamically convert escaped sequences to actual characters
  // This replaces instances of "\\x" with "\x" to properly interpret the escape sequence
  input = input.replace(/\\x([0-9A-Fa-f]{2})/g, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  console.log("writing input to active window: ", input);
  termApp.windows[termApp.activeWindowID].input(input);
  // sleep for 10ms and then call await lookAtActiveWindow()
  setTimeout(async () => {
    await lookAtActiveWindow();
  }, 10);
}

async function pressKeyboardKeys(payload: any) {
  if (!termApp.activeWindowID) {
    writeToSockets('observation: there are no windows open. Opening a new window...');
    newWindow({});
    return;
  }
  const { keys } = payload;
  const joinedKeys = (keys as string[]).join(',');
  const prompt = "convert the following keyboard key combo into the appropriate ascii character expressed as a hex string: [" + joinedKeys + ". just print the hex string (e.g., \\x...) and nothing else."
  const command = await openai.chat.completions.create({
    model: "openai/gpt-4o",
    messages: [
      { role: "user", content: prompt }
    ],
  })
  await termApp.windows[termApp.activeWindowID].input(`${command}\n`);
}

function switchToWindow(payload: any) {
  const { id } = payload;
  if (termApp.windows[id]) {
    termApp.activeWindowID = id;
    writeToSockets(`observation: switched to window '${id}'.`);
  } else {
    writeToSockets(`observation: window '${id}' does not exist.`);
  }
}

function whichWindowActive() {
  if (!termApp.activeWindowID) {
    writeToSockets('observation: there are no windows open.');
  } else {
    writeToSockets(`observation: active window is '${termApp.activeWindowID}'.`);
  }
}

function listWindows() {
  const windowIDs = Object.keys(termApp.windows);
  if (windowIDs.length === 0) {
    writeToSockets('observation: there are no windows open.');
  } else {
    writeToSockets(`observation: open windows: ${windowIDs.join(', ')}`);
  }
}

async function lookAtActiveWindow() {
  const windowIDs = Object.keys(termApp.windows);
  if (windowIDs.length === 0) {
    console.log('observation: there are no windows open.');
  } else if (termApp.activeWindowID === null || termApp.activeWindowID === undefined) {
    console.log('observation: there is no active window.');
  } else {
    // Send the history of the active window to the socket.
    const activeWindow = termApp.windows[termApp.activeWindowID];
    writeToSockets(`observation: window ${termApp.activeWindowID}:\n${await activeWindow.getView()}`);
  }
}

server.on('connection', (socket) => {
  console.log('terminalerver: client connected');
  sockets.push(socket);

  socket.on('data', (data) => {
    console.log('received:', data.toString());
    const msg = JSON.parse(data.toString());
    console.log("JSON parsed msg received: ", msg)
    const { type, payload = {} } = msg;
    switch (type) {
      case 'newWindow':
        newWindow(payload);
        break;
      case 'pressKeyboardKeys':
        pressKeyboardKeys(payload);
        break;
      case 'writeToStdin':
        typeInput(payload);
        break;
      case 'switchToWindow':
        switchToWindow(payload);
        break;
      case 'whichWindowActive':
        whichWindowActive();
        break;
      case 'lookAtActiveWindow':
        lookAtActiveWindow();
        break;
      case 'listWindows':
        listWindows();
        break;
      default:
        console.log('received unrecognized type from client:', type);
    }
  });

  socket.on('close', () => {
    console.log('a client disconnected');
    const index = sockets.indexOf(socket);
    if (index !== -1) {
      sockets.splice(index, 1);
    }
  });
});

server.listen(terminalServerPort, () => {
  console.log(`terminalServer listening on port ${terminalServerPort}`);
});

console.log("done running listen. registering process.on('SIGTERM')");
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Shutting down...');
  process.exit(0);
});
