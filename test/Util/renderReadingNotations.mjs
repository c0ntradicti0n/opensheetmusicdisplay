// ESM wrapper: fork child process running .cjs to avoid Node 24 ESM→CJS bug.
import { fork } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const child = fork(join(__dirname, "renderReadingNotations.cjs"), process.argv.slice(2), { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
