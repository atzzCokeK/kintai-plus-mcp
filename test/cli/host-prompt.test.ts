import { describe, expect, it } from 'vitest';
import { API_HOSTS } from '../../src/api/endpoint.ts';
import { HOST_SELECT_MESSAGE, hostSelectChoices } from '../../src/cli/host-prompt.ts';

describe('hostSelectChoices', () => {
  it('既知の接続先を並べ、atnd.ak4.jp を既定として示す', () => {
    const choices = hostSelectChoices();
    expect(choices.map((choice) => choice.value)).toEqual([...API_HOSTS]);
    expect(choices.map((choice) => choice.label)).toEqual([...API_HOSTS]);
    expect(HOST_SELECT_MESSAGE).toContain('↑/↓ で移動');
    expect(HOST_SELECT_MESSAGE).toContain('Enter で決定');
    expect(choices[0]?.hint).toContain('https://atnd.ak4.jp/');
    expect(choices[0]?.hint).toContain('（既定）');
    expect(choices[1]?.hint).toContain('https://atnd-awj.ak4.jp/');
    expect(choices[1]?.hint).not.toContain('既定');
  });
});
