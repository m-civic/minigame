import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { apiUrl, apiFetch } from '../src/lib/api';
import type { Puzzle, Token } from '../src/types/game';
import { cleanGuess, stemWord } from '../src/utils/stemmer';
import {
  calculateAccuracy,
  checkWinCondition,
  evaluateGuessInPuzzle,
  findFreeHintCandidate,
  findTitleHintCandidate
} from '../src/utils/game-rules';
import { DocumentToken } from '../src/components/document/DocumentToken';

const puzzle: Puzzle = JSON.parse(readFileSync('public/puzzles/today.json', 'utf8'));

test('API URL uporabi javno runtime konfiguracijo brez podvajanja /api', () => {
  vi.stubGlobal('window', { __MINIGAME_CONFIG__: { apiBaseUrl: 'https://backend.example.test/api/' } });
  try {
    expect(apiUrl('/api/game/today?sessionId=123')).toBe('https://backend.example.test/api/game/today?sessionId=123');
  } finally { vi.unstubAllGlobals(); }
});

test('API klic ohrani glavo Authorization in vsebino zahteve', async () => {
  vi.stubGlobal('window', { __MINIGAME_CONFIG__: { apiBaseUrl: 'https://backend.example.test/api' } });
  const mocked = vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch', mocked);
  const init = { method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: '{"word":"physics"}' };
  try {
    await apiFetch('/api/game/guess', init);
    expect(mocked).toHaveBeenCalledWith('https://backend.example.test/api/game/guess', init);
  } finally { vi.unstubAllGlobals(); }
});

test('brez runtime konfiguracije uporabi VITE_API_BASE_URL', () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://env-backend.example.test/api');
  try { expect(apiUrl('/api/auth/login')).toBe('https://env-backend.example.test/api/auth/login'); }
  finally { vi.unstubAllEnvs(); }
});

test('glavni namig izbere preostalo besedo naslova in po razkritju vseh ni na voljo', () => {
  const multiWordPuzzle: Puzzle = JSON.parse(readFileSync('public/puzzles/puzzle-1.json', 'utf8'));
  const titleWords = multiWordPuzzle.titleTokens.filter(token => token.type === 'word' && !token.isStopWord);
  expect(titleWords).toHaveLength(2);

  const revealedIds = new Set([titleWords[0].id]);
  expect(findTitleHintCandidate(multiWordPuzzle, revealedIds)).toBe(titleWords[1].canonical);

  revealedIds.add(titleWords[1].id);
  expect(findTitleHintCandidate(multiWordPuzzle, revealedIds)).toBeNull();
});

describe('Frontend: normalizacija in obstoječi scenariji logike igre', () => {
  // Primeri iz scripts/test-game-logic.mjs; zdaj se preverijo vsi pričakovani koreni.
  test.each([
    ['ACTS', 'act'], ['acting', 'act'], ['acted', 'act'],
    ['Gravitational', 'gravitate'], ['orbits', 'orbit'], ['orbiting', 'orbit']
  ])('normalizira in določi koren %s → %s', (word, expected) => {
    expect(stemWord(cleanGuess(word))).toBe(expected);
  });

  test('odstrani nečrkovne znake in poenoti velikost črk', () => {
    expect(cleanGuess('  PHYSICS!123 ')).toBe('physics');
    expect(cleanGuess('12345')).toBe('');
  });

  test('razkrije dejanske zadetke iz članka, brez zadetka naslova', () => {
    const result = evaluateGuessInPuzzle(puzzle, 'physics', stemWord('physics'), new Set());
    expect(result.hits).toBeGreaterThan(0);
    expect(result.newlyRevealedIds).toHaveLength(result.hits);
    expect(result.isTitleHit).toBe(false);
  });

  test('neznana beseda ne razkrije žetonov', () => {
    const result = evaluateGuessInPuzzle(puzzle, 'zzzzunknown', 'zzzzunknown', new Set());
    expect(result.hits).toBe(0);
    expect(result.allMatchingIds).toEqual([]);
  });

  test('ponovljeno ugibanje ne šteje že razkritih žetonov kot novih', () => {
    const first = evaluateGuessInPuzzle(puzzle, 'mass', stemWord('mass'), new Set());
    expect(first.hits).toBeGreaterThan(0);
    const second = evaluateGuessInPuzzle(puzzle, 'mass', stemWord('mass'), new Set(first.newlyRevealedIds));
    expect(second.hits).toBe(0);
    expect(second.allMatchingIds).toEqual(first.allMatchingIds);
  });

  test('naslov gravity zaključi igro šele po razkritju', () => {
    expect(checkWinCondition(new Set(), puzzle)).toBe(false);
    const result = evaluateGuessInPuzzle(puzzle, 'gravity', stemWord('gravity'), new Set());
    expect(result.isTitleHit).toBe(true);
    expect(checkWinCondition(new Set(result.newlyRevealedIds), puzzle)).toBe(true);
  });

  test('glavni namig ni na voljo pri enobesednem naslovu', () => {
    expect(findTitleHintCandidate(puzzle, new Set())).toBeNull();
  });

  test('osnovni namig izbere besedo in po razkritju vsega vrne null', () => {
    expect(findFreeHintCandidate(puzzle, new Set())).toEqual(expect.any(String));
    const allBodyIds = puzzle.sections.flatMap(section =>
      section.paragraphs.flatMap(paragraph => paragraph.tokens.map(token => token.id))
    );
    expect(findFreeHintCandidate(puzzle, new Set(allBodyIds))).toBeNull();
  });

  test('natančnost brez poskusov je nič', () => {
    expect(calculateAccuracy(0, 0)).toBe(0);
  });

  test('natančnost se zaokroži na cel odstotek', () => {
    expect(calculateAccuracy(2, 3)).toBe(67);
  });
});

describe('Frontend: prikaz žetona React', () => {
  const token: Token = {
    id: 7, type: 'word', text: 'Mass', canonical: 'mass', stem: 'mass',
    length: 4, isRevealed: false
  };
  const renderToken = (isRevealed: boolean, isJustRevealed = false) => renderToStaticMarkup(
    <DocumentToken token={token} isRevealed={isRevealed}
      isJustRevealed={isJustRevealed} isActiveHighlight={false} isCurrentFocus={false} />
  );

  test('skrita beseda izpiše štiri bloke in ne besedila rešitve', () => {
    const html = renderToken(false);
    expect(html).toContain('████');
    expect(html).not.toContain('Mass');
    expect(html).not.toContain('data-canonical');
  });

  test('razkrita beseda izpiše izvirno besedilo', () => {
    const html = renderToken(true);
    expect(html).toContain('Mass');
    expect(html).toContain('token-revealed');
  });

  test('pravkar razkrita beseda dobi razred animacije', () => {
    expect(renderToken(true, true)).toContain('token-just-revealed');
  });
});
