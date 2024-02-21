import net from 'net';
import readline from 'readline';

const bashServerPort = Number(process.env.BASH_SERVER_PORT) || 3031;

const client = net.createConnection({ port: bashServerPort }, () => {
    console.log('connected to bashServer on port ', bashServerPort);
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

client.on('data', (data) => {
    console.log(data.toString());
});

function askQuestion() {
    rl.question('Enter command type (n, c, s, w, e) and args (if any):\n', (input) => {
        try {
            if (input === '') {
                askQuestion();
                return;
            }
            const [commandType, ...args] = input.split(' ');
            let msg;
            if (commandType === 'newShell' || commandType === 'n') {
                msg = args.length === 1 ?
                    {type: 'newShell', payload: {shellID: args[0]}}
                :
                    msg = {type: 'newShell', payload: {}};
            } else if (commandType === 'runCommand' || commandType === 'c') {
                msg = {type: 'runCommand', payload: {command: new String(args.join(' '))}};
            } else if (commandType === 'switchToShell' || commandType === 's') {
                msg = {type: 'switchToShell', payload: {id: args}};
            } else if (commandType === 'whichShellActive' || commandType === 'w') {
                msg = {type: 'whichShellActive', payload: {}};
            } else if (commandType === 'exit' || commandType === 'e') {
                process.exit(0);
            } else { 
                console.log("unrecognized command type: ", commandType);
                askQuestion();
                return;
            }
            client.write(JSON.stringify(msg));
            console.log("wrote to bashServer: ", JSON.stringify(msg));
        } catch(e) {
            console.log("error parsing input and sending it to bashServer: ", e);
        }
        askQuestion();
    });
}

askQuestion();

// Listen for SIGTERM signal
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received. Shutting down...');
    // Perform any cleanup operations here
    process.exit(0);
});
