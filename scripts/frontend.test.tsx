import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
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

// Nameren neuspeh za demonstracijo obveznega CI preverjanja pri zaščiti veje main.
test('RIRS: namerno neuspešen test za demonstracijo zaščite veje main', () => {
  expect(true).toBe(false);
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
