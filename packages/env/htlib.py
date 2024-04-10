import asyncio
import json

class VirtualTerminal:
    def __init__(self, binary='/bin/bash', binary_args=None, size='120x40', **exec_kwargs):
        self.binary = binary
        self.binary_args = binary_args or []
        self.size = size
        self.exec_kwargs = exec_kwargs
        self.process = None

    async def start(self):
        try:
            cmd = ['vt', '--size', self.size, self.binary] + self.binary_args
            self.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **self.exec_kwargs
            )
            # Optionally, check if the process has indeed started (PID is assigned)
            if self.process.pid is None:
                print("Subprocess failed to start.")
                self.process = None
            else:
                print(f"Subprocess started successfully with PID {self.process.pid}")
        except Exception as e:
            print(f"Failed to start the subprocess: {e}")
            self.process = None

    async def send_stdin(self, command):
        if self.process:
            self.process.stdin.write((json.dumps(command) + '\n').encode())
            await self.process.stdin.drain()

    async def getView(self):
        await self.send_stdin({"type": "getView"})
        output = await self.process.stdout.readline()
        return json.loads(output.decode())

    async def resize(self, cols, rows):
        await self.send_stdin({"type": "resize", "cols": cols, "rows": rows})

    async def input(self, text):
        await self.send_stdin({"type": "input", "payload": text})

    async def close(self):
        if self.process:
            self.process.terminate()
            await self.process.wait()
        print("Subprocess with pid ", self.process.pid, " terminated.")

# Example usage
async def main():
    vterm = VirtualTerminal()
    await vterm.start()
    await vterm.input("echo Hello, world!")
    await asyncio.sleep(0.01)
    view = await vterm.getView()
    print(view)
    await vterm.close()

if __name__ == "__main__":
    asyncio.run(main())
