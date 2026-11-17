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
  cards: Card[];
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
      cards,
    };
  }
  if (groups[0][1] === 4) {
    return {
      score: encode(7, [groups[0][0], groups[1][0]]),
      name: 'Póker',
      cards,
    };
  }
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return {
      score: encode(6, [groups[0][0], groups[1][0]]),
      name: 'Full House',
      cards,
    };
  }
  if (isFlush) {
    return {
      score: encode(5, values),
      name: 'Color',
      cards,
    };
  }
  if (isStraight) {
    return {
      score: encode(4, [straightHigh]),
      name: 'Escalera',
      cards,
    };
  }
  if (groups[0][1] === 3) {
    return {
      score: encode(3, [groups[0][0], groups[1][0], groups[2][0]]),
      name: 'Trío',
      cards,
    };
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    return {
      score: encode(2, [groups[0][0], groups[1][0], groups[2][0]]),
      name: 'Doble Pareja',
      cards,
    };
  }
  if (groups[0][1] === 2) {
    return {
      score: encode(1, [groups[0][0], groups[1][0], groups[2][0], groups[3][0]]),
      name: 'Pareja',
      cards,
    };
  }
  return {
    score: encode(0, values),
    name: 'Carta Alta',
    cards,
  };
}

export function evaluateBestHand(cards: Card[]): EvaluatedHand {
  if (cards.length < 5) {
    return { score: 0, name: 'Incompleta', cards: [] };
  }
  if (cards.length === 5) {
    return evaluate5(cards);
  }
  let best: EvaluatedHand = { score: -1, name: '', cards: [] };
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

export function evaluateBotHandStrength(holeCards: Card[], communityCards: Card[]): number {
  if (holeCards.length < 2) return 0.2;
  if (communityCards.length === 0) {
    const v1 = RANK_VALUE[holeCards[0].rank];
    const v2 = RANK_VALUE[holeCards[1].rank];
    const high = Math.max(v1, v2);
    const low = Math.min(v1, v2);
    const suited = holeCards[0].suit === holeCards[1].suit;
    const connected = Math.abs(v1 - v2) <= 2;
    if (v1 === v2) {
      return Math.min(0.95, 0.55 + (high / 14) * 0.4);
    }
    let strength = 0.15 + ((high + low) / 28) * 0.45;
    if (high >= 12) strength += 0.1;
    if (suited) strength += 0.08;
    if (connected) strength += 0.05;
    return Math.min(0.88, Math.max(0.15, strength));
  }
  const best = evaluateBestHand([...holeCards, ...communityCards]);
  const category = Math.floor(best.score / 1e10);
  const categoryStrength = [0.25, 0.48, 0.65, 0.76, 0.83, 0.88, 0.93, 0.96, 0.98];
  return categoryStrength[category] ?? 0.25;
}
