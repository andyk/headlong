import { spawn } from 'child_process';
import net from 'net';
import { maybeMultipartFormRequestOptions } from 'openai/uploads';

const bashServerPort = Number(process.env.BASH_SERVER_PORT) || 3031;

interface Env {
    shells: {
        [id: string]: {
            proc: any,
            history: string
        }
    };
    activeShellID: string | null;
}

const env: Env = {
    shells: {},
    activeShellID: null
};

const server = net.createServer();

const sockets: net.Socket[] = [];

function writeToSockets(msg: string) {
    for (const socket of sockets) {
        socket.write(msg);
    }
}

function newShell(payload: any) {
    const {
        shellID = undefined, shellPath = "/bin/bash", shellArgs = []
    } = payload;
    const id = shellID ? shellID : "shell-" + Math.random().toString(36).substring(7);
    const augmentedShellArgs = [
        '--rcfile',
        './.bashrc',
        ...shellArgs,
        "-i"
    ];
    console.log("calling spawn with: ", shellPath, augmentedShellArgs);
    env.shells[id] = {
        proc: spawn(
            `${shellPath}`,
            augmentedShellArgs,
            { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] }
        ),
        history: ''
    };
    env.activeShellID = id;
    env.shells[id].proc.stdin?.write('\n');
    writeToSockets(`observation: created shell with ID ${id} and made it active shell.`);

    // Relay messages from the subprocess to the socket
    env.shells[id].proc.stdout?.on('data', (data) => {
        console.log(`observation: shell ${id}:\n` + data);
        writeToSockets(`observation: shell ${id}:\n` + data);
    });
    env.shells[id].proc.stderr?.on('data', (data) => {
        console.log(`observation: shell ${id}:\n` + data);
        writeToSockets(`observation: shell ${id}:\n` + data);
    });
    env.shells[id].proc.on('exit', (data) => {
        console.log(`observation: shell '${id}' exited.`);
        writeToSockets(`observation: shell '${id}' exited.`);
        //TODO: mark shell as exited in env.shells
    });
    env.shells[id].proc.on('close', (signal) => {
        console.log(`observation: shell '${id}' terminated due to receipt of signal ${signal}`);
        writeToSockets(`observation: shell '${id}' terminated due to receipt of signal ${signal}`);
    });
}

function runCommand(payload: any) {
    if (env.activeShellID === null) {
        writeToSockets("observation: there are no shells open");
    } else {
        const { command } = payload;
        env.shells[env.activeShellID].proc.stdin?.write(command + '\n');
    }
}

function switchToShell(payload: any) {
    const { id } = payload;
    if (id in env.shells) {
        env.activeShellID = id;
        writeToSockets(`observation: switched to shell '${id}'`);
    } else {
        writeToSockets(`observation: shell '${id}' does not exist`);
    }
}

function whichShellActive(payload: any) {
    if (env.activeShellID === null) {
        writeToSockets(`observation: there are no shells open`);
    } else {
        writeToSockets(`observation: active shell is '${env.activeShellID}'`);
    }
}

server.on('connection', (socket) => {
    console.log('bashServer: client connected')
    sockets.push(socket);
    // Relay messages from the socket to the subprocess
    socket.on('data', (data) => {
        console.log("received: ", data.toString());
        const msg = JSON.parse(data.toString());
        const { type, payload = {} } = msg;
        if (type === 'newShell') {
            newShell(payload);
        } else if (type === 'runCommand') {
            runCommand(payload);
        } else if (type === 'switchToShell') {
            switchToShell(payload);
        } else if (type === 'whichShellActive') {
            whichShellActive(payload);
        } else {
            console.log("received unrecognized type from client: ", type);
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

console.log("done running listen. registering process.on('SIGTERM')")
// Listen for SIGTERM signal
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received. Shutting down...');
    // Perform any cleanup operations here
    process.exit(0);
});
