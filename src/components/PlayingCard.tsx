import { motion } from 'framer-motion';
import type { Card } from '../../shared/poker.ts';

interface PlayingCardProps {
  card?: Card;
  hidden?: boolean;
  small?: boolean;
  index?: number;
  isCommunity?: boolean;
  highlighted?: boolean;
  fanAngle?: number;
  dealFromTop?: boolean;
}

const SUIT_SYMBOL: Record<Card['suit'], string> = {
  spades: '♠',
  hearts: '♥',
  diamonds: '♦',
  clubs: '♣',
};

export function PlayingCard({
  card,
  hidden = false,
  small = false,
  index = 0,
  isCommunity = false,
  highlighted = false,
  fanAngle = 0,
  dealFromTop = false,
}: PlayingCardProps) {
  const sizeClasses = small ? 'w-12 h-[68px] text-xs rounded-lg' : 'w-16 h-24 text-base rounded-xl';
  const isRed = card && (card.suit === 'hearts' || card.suit === 'diamonds');
  const showFace = !hidden && Boolean(card);

  return (
    <motion.div
      initial={{
        opacity: 0,
        y: dealFromTop || isCommunity ? -70 : -28,
        scale: 0.7,
        rotate: 0,
        rotateY: showFace ? 180 : 0,
      }}
      animate={{
        opacity: 1,
        y: highlighted ? -6 : 0,
        scale: 1,
        rotate: fanAngle,
        rotateY: 0,
      }}
      exit={{ opacity: 0, scale: 0.8, y: 12 }}
      transition={{
        type: 'spring',
        stiffness: 260,
        damping: 22,
        delay: index * 0.09,
      }}
      style={{ transformStyle: 'preserve-3d', perspective: 1000 }}
      className={`${sizeClasses} relative select-none shadow-lg border transition-shadow ${
        !showFace
          ? 'bg-gradient-to-br from-indigo-900 via-slate-900 to-indigo-950 border-indigo-400/30'
          : highlighted
          ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400 shadow-[0_0_22px_rgba(251,191,36,0.55)]'
          : 'bg-zinc-50 border-zinc-200'
      } flex flex-col justify-between p-1.5 font-bold`}
    >
      {!showFace || !card ? (
        <div className="w-full h-full rounded-md border border-indigo-300/20 flex items-center justify-center">
          <div className="w-5 h-5 rounded-full border border-indigo-400/30 bg-indigo-500/10" />
        </div>
      ) : (
        <>
          <div className={`leading-none ${isRed ? 'text-rose-600' : 'text-zinc-900'}`}>
            <div>{card.rank}</div>
            <div className="text-[0.85em]">{SUIT_SYMBOL[card.suit]}</div>
          </div>
          <div
            className={`self-center leading-none ${small ? 'text-lg' : 'text-2xl'} ${
              isRed ? 'text-rose-600' : 'text-zinc-900'
            }`}
          >
            {SUIT_SYMBOL[card.suit]}
          </div>
          <div className={`leading-none self-end rotate-180 ${isRed ? 'text-rose-600' : 'text-zinc-900'}`}>
            <div>{card.rank}</div>
          </div>
        </>
      )}
    </motion.div>
  );
}
