import { spawn, ChildProcessWithoutNullStreams } from "child_process";

const HT_BINARY = "ht";
const HT_SIZE_FLAG = "--size";

interface VirtualTerminalConfig {
    size?: string;
    binary?: string;
    binaryArgs?: string[];
    spawnOptions?: object;
}

export class VirtualTerminal {
    private size: string;
    private binary: string;
    private binaryArgs: string[];
    private spawnOptions: object | undefined;
    private process: ChildProcessWithoutNullStreams | null = null;

    constructor(config: VirtualTerminalConfig = {}) {
        this.size = config.size || "120x40";
        this.binary = config.binary || "/bin/bash";
        this.binaryArgs = config.binaryArgs || [];
        this.spawnOptions = config.spawnOptions || undefined;
    }

    async start(): Promise<this> {
        const cmd = [HT_BINARY, HT_SIZE_FLAG, this.size, this.binary, ...this.binaryArgs];
        this.process = spawn(cmd[0], cmd.slice(1), this.spawnOptions);

        this.process.on("error", (err) => {
            console.error(`Failed to start subprocess: ${err}. make sure `);
            this.process = null;
        });

        if (this.process.pid) {
            console.log(`Subprocess started successfully with PID ${this.process.pid}`);
        } else {
            console.log("Subprocess failed to start.");
        }
        return this;
    }

    async sendStdin(stdinText: string): Promise<void> {
        if (this.process && !this.process.stdin.destroyed) {
            this.process.stdin.write(stdinText);
        }
    }

    async sendCommand(command: object): Promise<void> {
        await this.sendStdin(JSON.stringify(command) + "\r");
    }

    async getView(): Promise<string> {
        // a view should come back in as an object {view: <viewpane screenshot as string>}
        await this.sendCommand({ "type": "getView" });
        // throw errror if process is null
        if (this.process === null) {
            throw new Error("Process is not running.");
        }
        else {
            const data = await new Promise<string>(resolve => {
                this.process!.stdout.once("data", resolve);
            });
            const parsedReply = JSON.parse(data);
            if (!("view" in parsedReply)) {
                throw new Error("View not found in reply.");
            }
            return parsedReply["view"];
        }
    }

    async resize(cols: number, rows: number): Promise<void> {
        await this.sendCommand({ "type": "resize", cols, rows });
    }

    async input(text: string): Promise<void> {
        await this.sendCommand({ "type": "input", "payload": text });
    }

    async close(): Promise<void> {
        if (this.process) {
            this.process.kill();
            console.log(`Subprocess with pid ${this.process.pid} terminated.`);
        }
    }

    async onExit(callback: (args: {exitCode: number | null, signal: NodeJS.Signals | null}) => void): Promise<void> {
        if (this.process) {
            this.process.on("exit", callback);
        }
    }
}

//// Example usage
//(async () => {
//    const vterm = new VirtualTerminal();
//    await vterm.start();
//    await vterm.input("nano\n");
//    setTimeout(async () => {
//        console.log(await vterm.getView());
//        await vterm.close();
//    }, 200); // setTimeout to ensure command execution before getView
//})();
