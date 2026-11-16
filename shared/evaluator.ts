import type { Card, Rank } from './poker.ts';

const RANK_VALUE: Record<Rank, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

export interface EvaluatedHand {
  score: number; // Higher is better
  name: string;
}

function evaluate5(cards: Card[]): EvaluatedHand {
  const values = cards.map((c) => RANK_VALUE[c.rank]).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const isFlush = suits.every((s) => s === suits[0]);

  // Check straight (including A-2-3-4-5 wheel)
  const uniqueVals = Array.from(new Set(values));
  let isStraight = false;
  let straightHigh = 0;
  if (uniqueVals.length === 5) {
    if (uniqueVals[0] - uniqueVals[4] === 4) {
      isStraight = true;
      straightHigh = uniqueVals[0];
    } else if (
      uniqueVals[0] === 14 &&
      uniqueVals[1] === 5 &&
      uniqueVals[2] === 4 &&
      uniqueVals[3] === 3 &&
      uniqueVals[4] === 2
    ) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  const counts = new Map<number, number>();
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const groups = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0] - a[0];
  });

  const encode = (category: number, tiebreakers: number[]): number => {
    let score = category * 1e10;
    for (let i = 0; i < tiebreakers.length; i++) {
      score += tiebreakers[i] * Math.pow(15, 4 - i);
    }
    return score;
  };

  if (isFlush && isStraight) {
    return {
      score: encode(8, [straightHigh]),
      name: straightHigh === 14 ? 'Escalera Real' : 'Escalera de Color',
    };
  }
  if (groups[0][1] === 4) {
    return {
      score: encode(7, [groups[0][0], groups[1][0]]),
      name: 'Póker',
    };
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return {
      score: encode(6, [groups[0][0], groups[1][0]]),
      name: 'Full House',
    };
  }
  if (isFlush) {
    return {
      score: encode(5, values),
      name: 'Color',
    };
  }
  if (isStraight) {
    return {
      score: encode(4, [straightHigh]),
      name: 'Escalera',
    };
  }
  if (groups[0][1] === 3) {
    return {
      score: encode(3, [groups[0][0], groups[1][0], groups[2][0]]),
      name: 'Trío',
    };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return {
      score: encode(2, [groups[0][0], groups[1][0], groups[2][0]]),
      name: 'Doble Pareja',
    };
  }
  if (groups[0][1] === 2) {
    return {
      score: encode(1, [groups[0][0], groups[1][0], groups[2][0], groups[3][0]]),
      name: 'Pareja',
    };
  }
  return {
    score: encode(0, values),
    name: 'Carta Alta',
  };
}

export function evaluateBestHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) {
    return { score: 0, name: 'Incompleta' };
  }
  if (cards.length === 5) {
    return evaluate5(cards);
  }
  let best: EvaluatedHand = { score: -1, name: '' };
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            const res = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (res.score > best.score) {
              best = res;
            }
          }
        }
      }
    }
  }
  return best;
}

export function evaluateCurrentHand(holeCards: Card[], communityCards: Card[]): string {
  const all = [...holeCards, ...communityCards];
  if (all.length === 0) return '';
  if (all.length >= 5) {
    return evaluateBestHand(all).name;
  }
  const counts = new Map<Rank, number>();
  for (const c of all) {
    counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  }
  const freqs = Array.from(counts.values()).sort((a, b) => b - a);
  if (freqs[0] === 4) return 'Póker';
  if (freqs[0] === 3) return 'Trío';
  if (freqs[0] === 2 && freqs[1] === 2) return 'Doble Pareja';
  if (freqs[0] === 2) return holeCards.length === 2 && communityCards.length === 0 ? 'Pareja de Mano' : 'Pareja';
  return 'Carta Alta';
}
