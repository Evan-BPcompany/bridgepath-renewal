import { PassThrough, Writable } from 'stream';
import { createPrompter } from '../utils/terminalPrompt';

function setup() {
  const input = new PassThrough();
  const written: string[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      written.push(chunk.toString());
      callback();
    }
  });
  const prompter = createPrompter({ input, output, terminal: true });

  return { input, prompter, shown: () => written.join('') };
}

describe('Terminal prompter', () => {
  it('shows the question and echoes what is typed for visible input', async () => {
    const { input, prompter, shown } = setup();

    const answer = prompter.ask('Admin username: ');
    input.write('master\n');

    expect(await answer).toBe('master');
    expect(shown()).toContain('Admin username: ');
    expect(shown()).toContain('master');
    prompter.close();
  });

  it('never writes hidden input to the output', async () => {
    const { input, prompter, shown } = setup();

    const answer = prompter.ask('Password: ', { hidden: true });
    input.write('Sup3r-Secret-Passw0rd!\n');

    expect(await answer).toBe('Sup3r-Secret-Passw0rd!');
    expect(shown()).toContain('Password: ');
    expect(shown()).not.toContain('Sup3r');
    expect(shown()).not.toContain('Secret');
    expect(shown()).not.toContain('*');
    prompter.close();
  });

  it('keeps multi-byte (Korean) passwords intact and hidden', async () => {
    const { input, prompter, shown } = setup();

    const answer = prompter.ask('Password: ', { hidden: true });
    input.write('비밀번호-Abc123\n');

    expect(await answer).toBe('비밀번호-Abc123');
    expect(shown()).not.toContain('비밀');
    prompter.close();
  });

  it('echoes again for the next visible question after a hidden one', async () => {
    const { input, prompter, shown } = setup();

    const hidden = prompter.ask('Password: ', { hidden: true });
    input.write('hidden-value-1A\n');
    await hidden;

    const visible = prompter.ask('Name: ');
    input.write('visible-name\n');
    await visible;

    expect(shown()).not.toContain('hidden-value');
    expect(shown()).toContain('visible-name');
    prompter.close();
  });

  it('honours the backspace key', async () => {
    const { input, prompter } = setup();

    const answer = prompter.ask('Password: ', { hidden: true });
    input.write('abcX\u007f\n');

    expect(await answer).toBe('abc');
    prompter.close();
  });

  it('answers several questions in a row', async () => {
    const { input, prompter } = setup();

    const first = prompter.ask('A: ');
    input.write('one\n');
    expect(await first).toBe('one');

    const second = prompter.ask('B: ', { hidden: true });
    input.write('two\n');
    expect(await second).toBe('two');
    prompter.close();
  });

  it('rejects with INPUT_CLOSED when the prompt is closed while waiting', async () => {
    const { prompter } = setup();

    const answer = prompter.ask('Password: ', { hidden: true });
    prompter.close();

    await expect(answer).rejects.toThrow('INPUT_CLOSED');
  });

  it('rejects with INPUT_CLOSED when the user presses Ctrl+C', async () => {
    const { input, prompter } = setup();

    const answer = prompter.ask('Password: ', { hidden: true });
    input.write('\u0003');

    await expect(answer).rejects.toThrow('INPUT_CLOSED');
    prompter.close();
  });

  it('rejects immediately when asked after it was closed', async () => {
    const { prompter } = setup();
    prompter.close();

    await expect(prompter.ask('Late: ')).rejects.toThrow('INPUT_CLOSED');
  });
});
