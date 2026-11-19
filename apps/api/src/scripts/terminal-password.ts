export type PasswordInput = NodeJS.ReadableStream & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};
export type PasswordOutput = { write(text: string): unknown };

export class PasswordInputCancelled extends Error {
  constructor() { super("Leitura da senha cancelada."); this.name = "PasswordInputCancelled"; }
}

// Lê senhas tecla a tecla, sem readline. Em TTY usa modo raw e mostra um * por caractere;
// fora de TTY (pipe, testes) lê a linha sem eco. O estado entre leituras fica aqui:
// o que chegou depois de um Enter é guardado para a próxima leitura, e um \n logo após \r
// é consumido como o mesmo Enter (\r\n), mesmo que chegue em outro bloco de dados.
export function createPasswordReader(input: PasswordInput, output: PasswordOutput, onInterrupt: () => void) {
  input.setEncoding("utf8");
  let pending = "", skipLineFeed = false, ended = false;
  input.on("end", () => { ended = true; });

  return function readPassword(prompt: string): Promise<string> {
    const tty = input.isTTY === true && typeof input.setRawMode === "function";
    const wasRaw = input.isRaw === true;
    // Modo raw antes do prompt: nada digitado depois de ver o prompt é ecoado, e Ctrl+C chega como tecla.
    if (tty) input.setRawMode!(true);
    output.write(prompt);
    const typed: string[] = [];
    let escape = false, done = false;

    return new Promise<string>((resolve, reject) => {
      const finish = (action: () => void) => {
        done = true;
        input.removeListener("data", onData); input.removeListener("end", onEnd); input.pause();
        if (tty) input.setRawMode!(wasRaw);
        action();
      };
      const consume = (text: string) => {
        const keys = [...text];
        for (let index = 0; index < keys.length && !done; index++) {
          const key = keys[index]!;
          if (skipLineFeed) { skipLineFeed = false; if (key === "\n") continue; }
          if (escape) { if (/[A-Za-z~]/.test(key)) escape = false; continue; } // setas e outras sequências ESC
          if (key === "\r" || key === "\n") {
            skipLineFeed = key === "\r";
            pending = keys.slice(index + 1).join("");
            output.write("\n");
            finish(() => resolve(typed.join("")));
          } else if (key === "\x03") {
            output.write("\n");
            finish(() => { onInterrupt(); reject(new PasswordInputCancelled()); });
          } else if (key === "\x7f" || key === "\b") {
            if (typed.pop() !== undefined && tty) output.write("\b \b");
          } else if (key === "\x1b") {
            escape = true;
          } else if (key >= " ") {
            typed.push(key);
            if (tty) output.write("*");
          }
        }
      };
      const onData = (chunk: string | Buffer) => consume(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      const onEnd = () => finish(() => (typed.length ? resolve(typed.join("")) : reject(new PasswordInputCancelled())));

      const leftover = pending; pending = "";
      consume(leftover);
      if (done) return;
      if (ended) { onEnd(); return; }
      input.on("data", onData); input.on("end", onEnd); input.resume();
    });
  };
}
