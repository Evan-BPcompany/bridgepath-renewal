import readline from 'readline';
import { Writable } from 'stream';

export interface Prompter {
  // Rejects with Error('INPUT_CLOSED') if the input ends or the user presses Ctrl+C.
  ask(question: string, options?: { hidden?: boolean }): Promise<string>;
  close(): void;
}

export interface PrompterStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  terminal?: boolean;
}

// Reads lines from a terminal. With { hidden: true } what the user types is never written
// to the output (no echo), which is how passwords are read.
export function createPrompter(streams: PrompterStreams): Prompter {
  const { input, output } = streams;
  let muted = false;
  let closed = false;
  let rejectPending: ((error: Error) => void) | null = null;

  // readline echoes typed characters to this stream; muting it hides them.
  const echo = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) {
        output.write(chunk, encoding as BufferEncoding);
      }
      callback();
    }
  });

  const rl = readline.createInterface({
    input,
    output: echo,
    terminal: streams.terminal ?? true
  });

  rl.on('close', () => {
    closed = true;
    rejectPending?.(new Error('INPUT_CLOSED'));
  });

  rl.on('SIGINT', () => {
    rl.close();
  });

  return {
    ask(question, options = {}) {
      return new Promise<string>((resolve, reject) => {
        if (closed) {
          reject(new Error('INPUT_CLOSED'));
          return;
        }

        const hidden = options.hidden === true;
        output.write(question);
        muted = hidden;
        rejectPending = reject;

        rl.question('', answer => {
          muted = false;
          rejectPending = null;
          if (hidden) {
            output.write('\n');
          }
          resolve(answer);
        });
      });
    },
    close() {
      rl.close();
    }
  };
}
