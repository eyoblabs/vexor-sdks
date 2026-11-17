import { stdout } from 'node:process';

const letters = {
  V: ['█   █', '█   █', '█   █', ' █ █ ', '  █  '],
  E: ['█████', '█    ', '████ ', '█    ', '█████'],
  X: ['█   █', ' █ █ ', '  █  ', ' █ █ ', '█   █'],
  O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
  R: ['████ ', '█   █', '████ ', '█ █  ', '█  ██'],
};

const copper = '\u001b[38;2;237;103;15m';
const peach = '\u001b[38;2;244;176;132m';
const reset = '\u001b[0m';

export function colorize(value) {
  if (!stdout.isTTY || process.env.NO_COLOR || process.env.TERM === 'dumb') return value;
  return `${copper}${value}${reset}`;
}

export async function printBrand(label = 'VIDEO INFRASTRUCTURE') {
  const word = Array.from({ length: 5 }, (_, row) =>
    ['V', 'E', 'X', 'O', 'R'].map((letter) => letters[letter][row]).join('  '),
  );
  if (stdout.isTTY) {
    const useColor = !process.env.NO_COLOR && process.env.TERM !== 'dumb';
    for (let index = 0; index < word.length; index += 1) {
      const shade = useColor ? (index === 0 ? copper : peach) : '';
      stdout.write(`${shade}${word[index]}${useColor ? reset : ''}\n`);
      await new Promise((resolve) => setTimeout(resolve, 24));
    }
    const blocks = ['▰   ', '▰▰  ', '▰▰▰ ', '▰▰▰▰'];
    for (const blocksFrame of blocks) {
      stdout.write(`\r${useColor ? copper : ''}${blocksFrame}${useColor ? reset : ''}`);
      await new Promise((resolve) => setTimeout(resolve, 24));
    }
    stdout.write(`\r${colorize('▰▰▰▰')}  ${label}\n\n`);
    return;
  }
  for (const line of word) stdout.write(`${line}\n`);
  stdout.write(`▰▰▰▰  ${label}\n\n`);
}

export function pixelFrame(index) {
  const frames = ['▖', '▘', '▝', '▗'];
  return colorize(frames[index % frames.length]);
}
