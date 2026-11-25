import { describe, expect, test, vi } from 'vitest';
import type { StoredGameSession, StoredPuzzle } from '../backend/src/lib/store';
import { cleanGuess, stemWord } from '../backend/src/utils/stemmer';
import { maskPuzzleForClient, checkServerWinCondition } from '../backend/src/utils/masking';
import { buildTokenPayloadFromText, parseSafeWikipediaUrl } from '../backend/src/utils/wiki-importer';
import { processSessionGuess, selectTitleHintWord } from '../backend/src/utils/game-engine';
import { runAcceptanceTests } from './test-acceptance-criteria';

const puzzle: StoredPuzzle = {
  id: 'test-puzzle', puzzleNumber: 99, title: 'Albert Einstein',
  wikipediaUrl: 'https://en.wikipedia.org/wiki/Albert_Einstein', difficulty: 'MEDIUM',
  status: 'PUBLISHED', releaseDate: '2026-10-01', createdBy: null, createdAt: new Date('2026-10-01'),
  content: buildTokenPayloadFromText('Albert Einstein', 'Einstein studied physics and physics explains nature.')
};

describe('Backend: preverjanje besed, maskiranje in namigi', () => {
  test.each(['ACTS', 'acting', 'acted'])('strežniški koren %s je act', word => {
    expect(stemWord(cleanGuess(word))).toBe('act');
  });

  test('pred zmago skrije naslov, URL in korene skritih besed', () => {
    const masked = maskPuzzleForClient(puzzle, new Set(), false);
    expect(masked.wikipediaTitle).toBe('[CLASSIFIED]');
    expect(masked.wikipediaUrl).toBe('');
    expect(masked.titleTargetWords).toEqual([]);
    for (const token of masked.titleTokens.filter(t => t.type === 'word' && !t.isStopWord)) {
      expect(token.text).toMatch(/^█+$/);
      expect(token.canonical).toBeUndefined();
      expect(token.stem).toBeUndefined();
    }
  });

  test('ob zmagi razkrije izvirni naslov in povezavo', () => {
    const revealed = maskPuzzleForClient(puzzle, new Set(), true);
    expect(revealed.wikipediaTitle).toBe('Albert Einstein');
    expect(revealed.wikipediaUrl).toBe(puzzle.wikipediaUrl);
    expect(revealed.titleTokens.filter(t => t.type === 'word').map(t => t.text)).toEqual(['Albert', 'Einstein']);
  });

  test('delno razkrit naslov še ni zmaga', () => {
    const first = puzzle.content.tokenData.titleTokens.find(t => t.type === 'word')!;
    expect(checkServerWinCondition(puzzle, new Set([first.id]))).toBe(false);
  });

  test('vse ciljne besede naslova pomenijo zmago', () => {
    const ids = puzzle.content.tokenData.titleTokens.filter(t => t.type === 'word').map(t => t.id);
    expect(checkServerWinCondition(puzzle, new Set(ids))).toBe(true);
  });

  test('glavni namig izbere še skrito ciljno besedo', () => {
    const titleWords = puzzle.content.tokenData.titleTokens.filter(t => t.type === 'word');
    const result = selectTitleHintWord(puzzle, new Set([titleWords[0].id]));
    expect(result.word).toBe('einstein');
  });

  test('glavni namig po razkritju celotnega naslova ni na voljo', () => {
    const ids = puzzle.content.tokenData.titleTokens.map(t => t.id);
    expect(selectTitleHintWord(puzzle, new Set(ids)).word).toBeNull();
  });

  test('dvojnik ne poveča števila poskusov in zadetkov v seji', async () => {
    const session: StoredGameSession = {
      id: 'test-session', userId: null, puzzleId: puzzle.id, status: 'IN_PROGRESS',
      guessesCount: 0, hitsCount: 0, hintsUsed: 0, basicHintsUsed: 0, titleHintUsed: false,
      revealedTokenIds: [], durationSeconds: 0, startedAt: new Date(), completedAt: null, guessLogs: []
    };
    const first = await processSessionGuess(session, puzzle, 'physics', stemWord('physics'));
    expect(first.hits).toBe(2);
    const second = await processSessionGuess(session, puzzle, 'physics', stemWord('physics'));
    expect(second.alreadyGuessed).toBe(true);
    expect(session.guessesCount).toBe(1);
    expect(session.hitsCount).toBe(1);
    expect(session.guessLogs).toHaveLength(1);
  });
});

describe('Backend: Wikipedia URL', () => {
  test('sprejme HTTPS povezavo do članka na Wikipediji', () => {
    expect(parseSafeWikipediaUrl('https://en.wikipedia.org/wiki/Alan_Turing')).toEqual({
      host: 'en.wikipedia.org', titleSlug: 'Alan_Turing'
    });
  });

  test.each([
    'http://127.0.0.1:8080/internal',
    'http://en.wikipedia.org/wiki/Physics',
    'https://en.wikipedia.org.evil.example/wiki/Physics',
    'https://en.wikipedia.org/wiki/'
  ])('zavrne neustrezen naslov %s', url => {
    expect(parseSafeWikipediaUrl(url)).toBeNull();
  });
});

test('Backend: obstoječi integracijski API scenariji', async () => {
  const realFetch = globalThis.fetch;
  const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
  // Nadomestimo le zunanje omrežje; HTTP do dejanskega Express API ostane nespremenjen.
  vi.stubGlobal('fetch', (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://en.wikipedia.org/w/api.php?')) {
      return Promise.resolve(Response.json({ query: { pages: { '1': {
        title: 'Quantum mechanics',
        extract: 'Quantum mechanics describes the physics of particles. Particles exhibit quantum properties.'
      } } } }));
    }
    return realFetch(input, init);
  });
  try {
    await runAcceptanceTests();
  } finally {
    vi.unstubAllGlobals();
    random.mockRestore();
  }
});
