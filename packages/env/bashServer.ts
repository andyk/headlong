import { createServer, Socket } from 'net';
import { IPty, spawn } from 'node-pty'; // Import spawn from node-pty

const bashServerPort = Number(process.env.BASH_SERVER_PORT) || 3031;

interface Shell {
  proc: IPty;
  history: string;
}

interface Env {
  shells: { [id: string]: Shell };
  activeShellID: string | null;
}

const env: Env = {
  shells: {},
  activeShellID: null,
};

const server = createServer();

const sockets: Socket[] = [];

function writeToSockets(msg: string) {
  sockets.forEach((socket) => {
    socket.write(msg);
  });
}

function newShell(payload: any) {
  const { shellID, shellPath = '/bin/bash', shellArgs = [] } = payload;
  const id = shellID || `shell-${Math.random().toString(36).substring(7)}`;

  // Using node-pty to spawn the shell
  env.shells[id] = {
    proc: spawn(shellPath, shellArgs, {
      name: 'xterm-color',
      cwd: process.cwd(),
      env: process.env,
    }),
    history: '',
  };
  env.activeShellID = id;

  writeToSockets(`observation: created shell with ID ${id} and made it active shell.`);

  // Relay messages from the subprocess to the socket
  env.shells[id].proc.onData((data) => {
    writeToSockets(`observation: shell ${id}:\n${data}`);
  });

  env.shells[id].proc.onExit(({ exitCode, signal }) => {
    writeToSockets(`observation: shell '${id}' exited with code ${exitCode}, signal ${signal}.`);
    // Cleanup shell from env.shells when it exits
    delete env.shells[id];
    if (env.activeShellID === id) {
      env.activeShellID = null; // Reset active shell ID if the exited shell was active
    }
  });
}

function runCommand(payload: any) {
  if (!env.activeShellID) {
    writeToSockets('observation: there are no shells open.');
    return;
  }
  const { command } = payload;
  env.shells[env.activeShellID].proc.write(`${command}\n`);
}

function switchToShell(payload: any) {
  const { id } = payload;
  if (env.shells[id]) {
    env.activeShellID = id;
    writeToSockets(`observation: switched to shell '${id}'.`);
  } else {
    writeToSockets(`observation: shell '${id}' does not exist.`);
  }
}

function whichShellActive() {
  if (!env.activeShellID) {
    writeToSockets('observation: there are no shells open.');
  } else {
    writeToSockets(`observation: active shell is '${env.activeShellID}'.`);
  }
}

server.on('connection', (socket) => {
  console.log('bashServer: client connected');
  sockets.push(socket);

  socket.on('data', (data) => {
    console.log('received:', data.toString());
    const msg = JSON.parse(data.toString());
    const { type, payload = {} } = msg;
    switch (type) {
      case 'newShell':
        newShell(payload);
        break;
      case 'runCommand':
        runCommand(payload);
        break;
      case 'switchToShell':
        switchToShell(payload);
        break;
      case 'whichShellActive':
        whichShellActive();
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

server.listen(bashServerPort, () => {
  console.log(`bashServer listening on port ${bashServerPort}`);
});

console.log("done running listen. registering process.on('SIGTERM')");
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received. Shutting down...');
  process.exit(0);
});
