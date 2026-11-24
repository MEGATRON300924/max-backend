import { describe, expect, it } from 'vitest';
import { ApiError } from '../middleware/errors.js';
import { mimeTypeForPath, normalizeProjectPath } from './projects.js';

describe('MAX project file paths', () => {
  it('normalizes Windows separators and a leading current-directory segment', () => {
    expect(normalizeProjectPath('.\\src\\pages\\index.html')).toBe('src/pages/index.html');
  });

  it('preserves valid nested relative paths and dotfiles', () => {
    expect(normalizeProjectPath('public/.well-known/security.txt')).toBe('public/.well-known/security.txt');
  });

  it.each(['../secrets.txt', 'src/../../secret', '/etc/passwd', 'C:\\Windows\\win.ini', 'src\\..\\secret', ''])(
    'rejects unsafe path %s',
    path => {
      expect(() => normalizeProjectPath(path)).toThrow(ApiError);
    }
  );

  it('maps common web project extensions to safe preview MIME types', () => {
    expect(mimeTypeForPath('index.html')).toBe('text/html');
    expect(mimeTypeForPath('assets/site.css')).toBe('text/css');
    expect(mimeTypeForPath('scripts/app.js')).toBe('text/javascript');
    expect(mimeTypeForPath('unknown.data')).toBe('text/plain');
  });
});
