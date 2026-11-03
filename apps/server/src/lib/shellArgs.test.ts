import { expect, test } from 'bun:test';
import { parseShellArgs } from './shellArgs';

test('splits on any run of whitespace', () => {
  expect(parseShellArgs('  -v   --range 1-5\t--no-mtime\n')).toEqual(['-v', '--range', '1-5', '--no-mtime']);
  expect(parseShellArgs('')).toEqual([]);
  expect(parseShellArgs('   ')).toEqual([]);
});

test('single and double quotes group words and are dropped', () => {
  expect(parseShellArgs(`--filter "width > 1000" -o 'directory=["a b"]'`)).toEqual([
    '--filter',
    'width > 1000',
    '-o',
    'directory=["a b"]',
  ]);
  expect(parseShellArgs(`"" ''`)).toEqual(['', '']);
});

test('a quoted part joins the text around it into one argument', () => {
  expect(parseShellArgs('--range="1-5"')).toEqual(['--range=1-5']);
  expect(parseShellArgs(`-o base-directory="/media/my pics"/x`)).toEqual(['-o', 'base-directory=/media/my pics/x']);
  expect(parseShellArgs(`it"'"s`)).toEqual([`it's`]);
});

test('an unclosed quote runs to the end of the input', () => {
  expect(parseShellArgs('--filter "width > 1000')).toEqual(['--filter', 'width > 1000']);
});
